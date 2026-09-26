import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Sesion } from '@/domain/types';
import { DB_VERSION, type Db } from './db';
import { crearSeed } from './seed';
import * as comandos from './comandos';
import { generarClasesPendientes, type Ctx, type Resultado } from './comandos';

type Comandos = typeof comandos;
type NombreComando = {
  [K in keyof Comandos]: Comandos[K] extends (ctx: Ctx, args: infer _A) => Resultado<infer _R> ? K : never;
}[keyof Comandos];

interface Estado {
  db: Db;
  sesion: Sesion | null;
  /** Último resultado de un comando (para avisos en pantalla). */
  ultimoError: string | null;
  iniciarSesion: (userId: string) => void;
  cerrarSesion: () => void;
  ejecutar: <K extends NombreComando>(nombre: K, args: Parameters<Comandos[K]>[1]) => ReturnType<Comandos[K]>;
  reiniciarDemo: () => void;
  mantenimientoDiario: () => void;
}

const STORAGE_KEY = 'np-pilates-demo-v1';

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

export const useStore = create<Estado>()(
  persist(
    (set, get) => ({
      db: crearSeed(),
      sesion: null,
      ultimoError: null,
      iniciarSesion: (userId) => set({ sesion: sesionDeUsuario(get().db, userId) }),
      cerrarSesion: () => set({ sesion: null }),
      ejecutar: ((nombre, args) => {
        const { db, sesion } = get();
        if (!sesion) return { ok: false, error: 'Sesión no iniciada.' };
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
      reiniciarDemo: () => set({ db: crearSeed(), sesion: null }),
      mantenimientoDiario: () => set({ db: generarClasesPendientes(get().db, new Date()) }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: DB_VERSION,
      migrate: () => ({ db: crearSeed(), sesion: null, ultimoError: null }) as unknown as Estado,
      partialize: (s) => ({ db: s.db, sesion: s.sesion }) as Estado,
    },
  ),
);

export const useDb = () => useStore((s) => s.db);
export const useSesion = () => useStore((s) => s.sesion);
