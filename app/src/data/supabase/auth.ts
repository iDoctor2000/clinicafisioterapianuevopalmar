/**
 * Autenticación con Supabase Auth (email + contraseña) y resolución de la
 * `Sesion` de la app a partir del usuario autenticado.
 */
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import type { Sesion } from '@/domain/types';
import type { Db } from '../db';
import { mensajeError, servidor } from './cliente';

export interface UsuarioAuth {
  id: string;
  email: string;
}

const deUser = (u: User | null | undefined): UsuarioAuth | null => (u ? { id: u.id, email: u.email ?? '' } : null);

/** Traduce los errores habituales de Supabase Auth a mensajes claros. */
export function mensajeErrorAuth(e: unknown): string {
  const msg = mensajeError(e);
  if (/invalid login credentials|invalid_credentials|invalid email or password/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Tu correo aún no está confirmado. Revisa tu bandeja de entrada.';
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(msg)) return 'Demasiados intentos. Espera unos minutos y vuelve a probarlo.';
  if (/password should be at least|weak_password/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/user not found/i.test(msg)) return 'No existe ninguna cuenta con ese email.';
  if (/already registered|already been registered|user_already_exists/i.test(msg)) return 'Ya existe una cuenta con ese email. Entra con tu contraseña o usa "He olvidado mi contraseña".';
  if (/signups? not allowed|signup_disabled/i.test(msg)) return 'El registro está desactivado. Pídelo en recepción.';
  return msg;
}

export async function iniciarSesionEmail(email: string, password: string): Promise<{ ok: true; usuario: UsuarioAuth } | { ok: false; error: string }> {
  try {
    const { data, error } = await servidor().auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: mensajeErrorAuth(error) };
    const usuario = deUser(data.user);
    return usuario ? { ok: true, usuario } : { ok: false, error: 'No se ha podido iniciar sesión.' };
  } catch (e) {
    return { ok: false, error: mensajeErrorAuth(e) };
  }
}

/**
 * Primera vez: la persona crea su contraseña con el email que dio en recepción.
 * Si el proyecto no exige confirmar el correo, devuelve el usuario ya autenticado;
 * si la exige, devuelve `pendienteConfirmar` y hay que abrir el correo.
 */
export async function crearCuenta(email: string, password: string): Promise<
  { ok: true; usuario: UsuarioAuth | null; pendienteConfirmar: boolean } | { ok: false; error: string }
> {
  try {
    const { data, error } = await servidor().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: urlApp() } });
    if (error) return { ok: false, error: mensajeErrorAuth(error) };
    // Con "confirm email" activado, Supabase devuelve un usuario sin sesión (o con identities vacías si ya existía).
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return { ok: false, error: 'Ya existe una cuenta con ese email. Entra con tu contraseña o usa "He olvidado mi contraseña".' };
    }
    if (!data.session) return { ok: true, usuario: null, pendienteConfirmar: true };
    return { ok: true, usuario: deUser(data.user), pendienteConfirmar: false };
  } catch (e) {
    return { ok: false, error: mensajeErrorAuth(e) };
  }
}

export async function cerrarSesion(): Promise<void> {
  try {
    await servidor().auth.signOut();
  } catch (e) {
    console.warn('[supabase] Error al cerrar sesión:', mensajeError(e));
  }
}

/** URL de la app (sin hash) a la que volverá el enlace del correo de recuperación. */
export function urlApp(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export async function enviarRecuperacionContrasena(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await servidor().auth.resetPasswordForEmail(email.trim(), { redirectTo: urlApp() });
    return error ? { ok: false, error: mensajeErrorAuth(error) } : { ok: true };
  } catch (e) {
    return { ok: false, error: mensajeErrorAuth(e) };
  }
}

/** Cambia la contraseña del usuario autenticado (tras el enlace de recuperación). */
export async function cambiarContrasena(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await servidor().auth.updateUser({ password });
    return error ? { ok: false, error: mensajeErrorAuth(error) } : { ok: true };
  } catch (e) {
    return { ok: false, error: mensajeErrorAuth(e) };
  }
}

/** Usuario con sesión guardada en el navegador (null si no hay). */
export async function usuarioActual(): Promise<UsuarioAuth | null> {
  const { data, error } = await servidor().auth.getSession();
  if (error) throw error;
  return deUser(data.session?.user);
}

/**
 * Resuelve la `Sesion` de la app: primero trabajadores por user_id, luego clientes.
 * Devuelve null si el usuario autenticado no está dado de alta en el centro.
 */
export function sesionDesdeUsuario(usuario: UsuarioAuth, db: Db): Sesion | null {
  const t = db.trabajadores.find((x) => x.userId === usuario.id);
  if (t) return { tipo: 'TRABAJADOR', userId: usuario.id, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
  const c = db.clientes.find((x) => x.userId === usuario.id);
  if (c) return { tipo: 'CLIENTE', userId: usuario.id, clienteId: c.id, nombre: c.nombre };
  return null;
}

export type EventoAuth = 'ENTRADA' | 'SALIDA' | 'RECUPERACION_CONTRASENA' | 'OTRO';

/**
 * Suscripción a los cambios de autenticación. La callback se invoca fuera del
 * callback interno de Supabase (setTimeout) para no bloquear su cola de auth.
 */
export function suscribirAuth(cb: (evento: EventoAuth, usuario: UsuarioAuth | null) => void): () => void {
  const { data } = servidor().auth.onAuthStateChange((evento: AuthChangeEvent, sesion: Session | null) => {
    const tipo: EventoAuth =
      evento === 'SIGNED_IN' ? 'ENTRADA' : evento === 'SIGNED_OUT' ? 'SALIDA' : evento === 'PASSWORD_RECOVERY' ? 'RECUPERACION_CONTRASENA' : 'OTRO';
    setTimeout(() => cb(tipo, deUser(sesion?.user)), 0);
  });
  return () => data.subscription.unsubscribe();
}
