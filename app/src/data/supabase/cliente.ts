/**
 * Cliente de Supabase. Solo se crea si el build lleva las variables
 * VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY; si no, la app funciona en modo demo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MENSAJE_DNI_REPETIDO } from './mensajes';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

/** true cuando la app está configurada contra un proyecto Supabase (modo producción). */
export function hayServidor(): boolean {
  return supabase !== null;
}

/** Cliente garantizado (lanza si no hay servidor: solo debe llamarse en modo SUPABASE). */
export function servidor(): SupabaseClient {
  if (!supabase) throw new Error('La app no está configurada con Supabase.');
  return supabase;
}

/** Convierte cualquier error (PostgREST, Auth, red) en un mensaje para el usuario. */
export function mensajeError(e: unknown): string {
  const msg = typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  if (!msg) return 'Se ha producido un error inesperado.';
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg)) {
    return 'No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
  }
  if (/jwt expired|invalid jwt|refresh token/i.test(msg)) return 'Tu sesión ha caducado. Vuelve a entrar.';
  // "permission denied for table X": la petición llegó sin sesión (rol anon, que no tiene permisos sobre ninguna tabla).
  if (/permission denied/i.test(msg)) return 'Tu sesión ha caducado. Vuelve a entrar.';
  // Datos repetidos (la base de datos no deja guardar dos iguales): se explica qué pasa y qué hacer.
  if (/duplicate key value/i.test(msg)) return MENSAJE_REPETIDO.find(([clave]) => msg.includes(clave))?.[1] ?? 'Ya existe un registro igual: revisa los datos antes de guardar.';
  return msg;
}

/** Restricciones de "no repetir" de la base de datos y el mensaje que ve la persona. */
const MENSAJE_REPETIDO: [string, string][] = [
  ['clientes_dni_unico', MENSAJE_DNI_REPETIDO],
  ['reservas_una_activa_por_cliente_clase', 'Ese alumno ya tiene plaza en esta clase.'],
  ['clases_plantilla_fecha_unica', 'Esa franja ya tiene una clase ese día.'],
  ['lista_espera', 'Ya está en la lista de espera de esta clase.'],
];
