import { useCallback } from 'react';
import { useStore } from '@/data/store';
import { tienePermiso, type Permiso, type Sesion, type Trabajador } from '@/domain/types';
import type { Db } from '@/data/db';

export type SesionTrabajador = Extract<Sesion, { tipo: 'TRABAJADOR' }>;

/** Acceso cómodo a los datos y permisos del trabajador con sesión iniciada. */
export function useTrabajador(): {
  db: Db;
  sesion: SesionTrabajador;
  trabajador: Trabajador | null;
  puede: (permiso: Permiso) => boolean;
  esAdmin: boolean;
  ejecutar: ReturnType<typeof useStore.getState>['ejecutar'];
} {
  const db = useStore((s) => s.db);
  const sesion = useStore((s) => s.sesion) as SesionTrabajador;
  const ejecutar = useStore((s) => s.ejecutar);
  const trabajador = db.trabajadores.find((t) => t.id === sesion?.trabajadorId) ?? null;
  const puede = useCallback((p: Permiso) => tienePermiso(sesion, p), [sesion]);
  return { db, sesion, trabajador, puede, esAdmin: sesion?.rol === 'ADMIN', ejecutar };
}
