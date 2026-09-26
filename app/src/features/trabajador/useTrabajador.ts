import { useCallback, useMemo } from 'react';
import { useStore } from '@/data/store';
import { tienePermiso, type Ambito, type Clase, type Permiso, type Sesion, type Trabajador } from '@/domain/types';
import { ambitoDe, puedeGestionarClase, recortarAlAmbito } from '@/domain/ambito';
import type { Db } from '@/data/db';

export type SesionTrabajador = Extract<Sesion, { tipo: 'TRABAJADOR' }>;

/**
 * Acceso cómodo a los datos y permisos del trabajador con sesión iniciada.
 *
 * `db` ya viene recortada al ámbito del trabajador: con SUS_CLASES solo contiene
 * sus clases y franjas, las reservas de esas clases, sus alumnos y los avisos que
 * le conciernen. `dbCompleta` es la instantánea sin recortar (para distinguir
 * "no existe" de "no es tuya").
 */
export function useTrabajador(): {
  db: Db;
  dbCompleta: Db;
  sesion: SesionTrabajador;
  trabajador: Trabajador | null;
  puede: (permiso: Permiso) => boolean;
  esAdmin: boolean;
  ambito: Ambito;
  /** true si el ámbito es SUS_CLASES. */
  limitado: boolean;
  gestionaClase: (clase: Pick<Clase, 'monitorId'>) => boolean;
  ejecutar: ReturnType<typeof useStore.getState>['ejecutar'];
} {
  const dbCompleta = useStore((s) => s.db);
  const sesionBase = useStore((s) => s.sesion) as SesionTrabajador;
  const ejecutar = useStore((s) => s.ejecutar);
  const trabajador = dbCompleta.trabajadores.find((t) => t.id === sesionBase?.trabajadorId) ?? null;
  const ambito = ambitoDe(dbCompleta, sesionBase) ?? 'CENTRO';
  const sesion = useMemo<SesionTrabajador>(() => (sesionBase ? { ...sesionBase, ambito } : sesionBase), [sesionBase, ambito]);
  const db = useMemo(() => recortarAlAmbito(dbCompleta, sesion), [dbCompleta, sesion]);
  const puede = useCallback((p: Permiso) => tienePermiso(sesion, p), [sesion]);
  const gestionaClase = useCallback((clase: Pick<Clase, 'monitorId'>) => puedeGestionarClase(dbCompleta, sesion, clase), [dbCompleta, sesion]);
  return { db, dbCompleta, sesion, trabajador, puede, esAdmin: sesion?.rol === 'ADMIN', ambito, limitado: ambito === 'SUS_CLASES', gestionaClase, ejecutar };
}
