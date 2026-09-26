import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Sesion } from '@/domain/types';
import { DB_VERSION, dbVacio, type Db } from './db';
import { crearSeed } from './seed';
import * as comandos from './comandos';
import { generarClasesPendientes, type Ctx, type Resultado } from './comandos';
import type { ArgsComando, NombreComando, ValorComando } from './tiposComandos';
import { hayServidor } from './supabase/cliente';
import { cargarDb } from './supabase/cargar';
import { ejecutarRemoto } from './supabase/comandos';
import * as auth from './supabase/auth';
import { activarTiempoReal } from './supabase/tiempoReal';
import { invocarEnvioPush } from './supabase/push';

export type Modo = 'DEMO' | 'SUPABASE';

interface Estado {
  /** DEMO: datos en memoria/localStorage. SUPABASE: datos del servidor (no se persisten en el navegador). */
  modo: Modo;
  db: Db;
  sesion: Sesion | null;
  /** Solo SUPABASE: usuario autenticado (aunque no esté dado de alta como cliente/trabajador). */
  usuarioAuth: auth.UsuarioAuth | null;
  /** Solo SUPABASE: carga inicial en curso. */
  cargando: boolean;
  /** Solo SUPABASE: error de la carga inicial (la UI ofrece "Reintentar"). */
  errorCarga: string | null;
  /** Solo SUPABASE: el usuario ha llegado desde el enlace de "he olvidado mi contraseña". */
  recuperandoContrasena: boolean;
  /** Último resultado de un comando (para avisos en pantalla). */
  ultimoError: string | null;
  /** Arranque (una vez, al montar la app): en SUPABASE restaura la sesión y carga los datos. */
  arrancar: () => Promise<void>;
  /** Solo DEMO: entra como el usuario indicado sin contraseña. */
  iniciarSesion: (userId: string) => void;
  /** Solo SUPABASE. */
  iniciarSesionEmail: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  crearCuentaEmail: (email: string, password: string) => Promise<{ ok: true; pendienteConfirmar: boolean } | { ok: false; error: string }>;
  cerrarSesion: () => Promise<void>;
  /** Solo SUPABASE: vuelve a leer la instantánea del servidor. */
  recargar: () => Promise<void>;
  terminarRecuperacionContrasena: () => void;
  /**
   * Ejecuta un comando. Siempre devuelve una promesa (en DEMO resuelta al instante);
   * en SUPABASE resuelve después de recargar los datos, así la UI ya ve el estado fresco.
   */
  ejecutar: <K extends NombreComando>(nombre: K, args: ArgsComando<K>) => Promise<Resultado<ValorComando<K>>>;
  reiniciarDemo: () => void;
  mantenimientoDiario: () => void;
}

const STORAGE_KEY = 'np-pilates-demo-v1';
const MODO: Modo = hayServidor() ? 'SUPABASE' : 'DEMO';

function sesionDeUsuario(db: Db, userId: string): Sesion | null {
  const u = db.usuarios.find((x) => x.id === userId);
  if (!u) return null;
  if (u.tipo === 'CLIENTE' && u.clienteId) {
    const c = db.clientes.find((x) => x.id === u.clienteId);
    if (!c) return null;
    return { tipo: 'CLIENTE', userId: u.id, clienteId: c.id, nombre: c.nombre };
  }
  if (u.tipo === 'TRABAJADOR' && u.trabajadorId) {
    const t = db.trabajadores.find((x) => x.id === u.trabajadorId);
    if (!t) return null;
    return { tipo: 'TRABAJADOR', userId: u.id, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
  }
  return null;
}

let detenerTiempoReal: (() => void) | null = null;
let detenerAuth: (() => void) | null = null;

/** Envía las notificaciones push de un aviso sin bloquear al usuario (la Edge Function `enviar-push`). */
function enviarPushDeAviso(avisoId: string): void {
  invocarEnvioPush({ avisoId })
    .then((r) => { if (r.fallidas > 0 || r.borradas > 0) console.warn('[push] Aviso enviado con incidencias:', r); })
    .catch((e) => console.warn('[push] No se han podido enviar las notificaciones del aviso:', e instanceof Error ? e.message : e));
}

/**
 * Solo SUPABASE: acciones que se disparan después de que un comando haya tenido éxito
 * (con la instantánea ya recargada). No bloquean ni afectan al resultado del comando.
 */
const despuesDe: { [K in NombreComando]?: (args: ArgsComando<K>, valor: ValorComando<K>, db: Db) => void } = {
  publicarAviso: (_args, aviso) => enviarPushDeAviso(aviso.id),
  cancelarClase: (args, valor, db) => {
    if (!args.avisar || valor.afectados === 0) return;
    // La RPC crea el aviso de cancelación: es el más reciente dirigido a esa clase.
    const aviso = db.avisos
      .filter((a) => a.destino.tipo === 'CLASE' && a.destino.claseId === args.claseId)
      .sort((a, b) => b.publicadoEl.localeCompare(a.publicadoEl))[0];
    if (aviso) enviarPushDeAviso(aviso.id);
    else console.warn('[push] No se ha encontrado el aviso de la clase cancelada; no se envían notificaciones.');
  },
};

const crearEstado: StateCreator<Estado> = (set, get) => {
  /** SUPABASE: carga la instantánea y resuelve la sesión del usuario autenticado. */
  const cargarYResolver = async (usuario: auth.UsuarioAuth | null): Promise<void> => {
    if (!usuario) {
      set({ usuarioAuth: null, sesion: null, db: dbVacio() });
      return;
    }
    const db = await cargarDb();
    set({ db, usuarioAuth: usuario, sesion: auth.sesionDesdeUsuario(usuario, db), errorCarga: null });
  };

  const activarEscucha = () => {
    if (detenerTiempoReal) return;
    detenerTiempoReal = activarTiempoReal(() => {
      if (get().usuarioAuth) void get().recargar();
    });
  };
  const detenerEscucha = () => {
    detenerTiempoReal?.();
    detenerTiempoReal = null;
  };

  return {
    modo: MODO,
    db: MODO === 'DEMO' ? crearSeed() : dbVacio(),
    sesion: null,
    usuarioAuth: null,
    cargando: MODO === 'SUPABASE',
    errorCarga: null,
    recuperandoContrasena: false,
    ultimoError: null,

    arrancar: async () => {
      if (MODO === 'DEMO') {
        get().mantenimientoDiario();
        return;
      }
      set({ cargando: true, errorCarga: null });
      try {
        if (!detenerAuth) {
          detenerAuth = auth.suscribirAuth((evento, usuario) => {
            if (evento === 'RECUPERACION_CONTRASENA') set({ recuperandoContrasena: true });
            if (evento === 'SALIDA') {
              detenerEscucha();
              set({ usuarioAuth: null, sesion: null, db: dbVacio() });
            }
            // Sesión iniciada en otra pestaña (o desde el enlace de recuperación): cargar si aún no tenemos a ese usuario.
            if (evento === 'ENTRADA' && usuario && get().usuarioAuth?.id !== usuario.id) {
              set({ cargando: true });
              cargarYResolver(usuario)
                .then(activarEscucha)
                .catch((e) => set({ errorCarga: e instanceof Error ? e.message : String(e) }))
                .finally(() => set({ cargando: false }));
            }
          });
        }
        const usuario = await auth.usuarioActual();
        await cargarYResolver(usuario);
        if (usuario) activarEscucha();
        auth.limpiarUrlTrasAcceso();
      } catch (e) {
        set({ errorCarga: e instanceof Error ? e.message : String(e) });
      } finally {
        set({ cargando: false });
      }
    },

    iniciarSesion: (userId) => set({ sesion: sesionDeUsuario(get().db, userId) }),

    iniciarSesionEmail: async (email, password) => {
      const r = await auth.iniciarSesionEmail(email, password);
      if (!r.ok) return r;
      set({ cargando: true, errorCarga: null });
      try {
        await cargarYResolver(r.usuario);
        activarEscucha();
        return { ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        set({ errorCarga: error });
        return { ok: false, error };
      } finally {
        set({ cargando: false });
      }
    },

    crearCuentaEmail: async (email, password) => {
      const r = await auth.crearCuenta(email, password);
      if (!r.ok) return r;
      if (r.pendienteConfirmar || !r.usuario) return { ok: true, pendienteConfirmar: true };
      set({ cargando: true, errorCarga: null });
      try {
        await cargarYResolver(r.usuario);
        activarEscucha();
        return { ok: true, pendienteConfirmar: false };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        set({ errorCarga: error });
        return { ok: false, error };
      } finally {
        set({ cargando: false });
      }
    },

    cerrarSesion: async () => {
      if (MODO === 'SUPABASE') {
        detenerEscucha();
        await auth.cerrarSesion();
        set({ sesion: null, usuarioAuth: null, db: dbVacio(), recuperandoContrasena: false });
      } else {
        set({ sesion: null });
      }
    },

    recargar: async () => {
      if (MODO !== 'SUPABASE') return;
      const usuario = get().usuarioAuth;
      if (!usuario) return;
      try {
        await cargarYResolver(usuario);
      } catch (e) {
        console.warn('[supabase] No se han podido recargar los datos:', e);
      }
    },

    terminarRecuperacionContrasena: () => set({ recuperandoContrasena: false }),

    ejecutar: (async (nombre: NombreComando, args: unknown) => {
      const { db, sesion } = get();
      if (!sesion) return { ok: false, error: 'Sesión no iniciada.' };

      if (MODO === 'SUPABASE') {
        const rr = await ejecutarRemoto(nombre, args as never, sesion);
        if (!rr.ok) {
          set({ ultimoError: rr.error });
          return rr;
        }
        await get().recargar();
        const fresco = get().db;
        set({ ultimoError: null });
        const valor = rr.valor(fresco);
        try {
          (despuesDe[nombre] as ((a: unknown, v: unknown, db: Db) => void) | undefined)?.(args, valor, fresco);
        } catch (e) {
          console.warn(`[push] Error tras el comando ${nombre}:`, e);
        }
        return { ok: true, db: fresco, valor };
      }

      const fn = comandos[nombre] as (ctx: Ctx, a: unknown) => Resultado<unknown>;
      const r = fn({ db, sesion, ahora: new Date() }, args);
      if (r.ok) {
        set({ db: r.db, ultimoError: null });
        // Si la sesión es de un trabajador y se editó a sí mismo, refrescar permisos.
        if (sesion.tipo === 'TRABAJADOR') set({ sesion: sesionDeUsuario(r.db, sesion.userId) ?? sesion });
      } else {
        set({ ultimoError: r.error });
      }
      return r;
    }) as Estado['ejecutar'],

    reiniciarDemo: () => {
      if (MODO === 'DEMO') set({ db: crearSeed(), sesion: null });
    },

    // En SUPABASE el mantenimiento lo hace pg_cron en el servidor.
    mantenimientoDiario: () => {
      if (MODO === 'DEMO') set({ db: generarClasesPendientes(get().db, new Date()) });
    },
  };
};

/**
 * En DEMO la instantánea se persiste en localStorage. En SUPABASE no se guarda
 * nada en el navegador (datos personales y de salud): cada arranque recarga del servidor.
 */
export const useStore: UseBoundStore<StoreApi<Estado>> =
  MODO === 'DEMO'
    ? create<Estado>()(
        persist(crearEstado, {
          name: STORAGE_KEY,
          storage: createJSONStorage(() => localStorage),
          version: DB_VERSION,
          migrate: () => ({ db: crearSeed(), sesion: null, ultimoError: null }) as unknown as Estado,
          partialize: (s) => ({ db: s.db, sesion: s.sesion }) as Estado,
        }),
      )
    : create<Estado>()(crearEstado);

export const useDb = () => useStore((s) => s.db);
export const useSesion = () => useStore((s) => s.sesion);
export const useModo = () => useStore((s) => s.modo);
