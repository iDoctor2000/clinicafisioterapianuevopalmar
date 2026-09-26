/**
 * Ámbito por trabajador: qué clases (y alumnos, avisos, horarios y estadísticas)
 * alcanzan los permisos de un trabajador.
 *
 *  - CENTRO: todo el centro, según sus permisos.
 *  - SUS_CLASES: solo las clases que imparte (clase.monitorId === trabajador).
 *
 * La `Sesion` de trabajador puede traer `ambito`; si no lo trae (por ejemplo la
 * sesión de la demo se construye solo con permisos y rol), se resuelve desde la
 * ficha del trabajador en la instantánea. Un ADMIN siempre es CENTRO.
 *
 * Estas funciones son puras y las usan tanto los comandos (para rechazar) como
 * las pantallas (para filtrar). En Supabase la misma regla vive en
 * `supabase/migrations/0005_ambito.sql` (RLS y RPC).
 */
import type { Ambito, Aviso, Clase, Cliente, Id, PlantillaClase, Sesion } from './types';

/** Mensaje único de bloqueo cuando se intenta actuar sobre una clase ajena. */
export const MENSAJE_CLASE_AJENA = 'Esta clase no es tuya.';
export const MENSAJE_CLIENTE_AJENO = 'Este cliente no es alumno de tus clases.';
export const MENSAJE_AVISO_LIMITADO = 'Con tu ámbito solo puedes enviar avisos a los alumnos de tus clases.';
export const MENSAJE_HORARIO_LIMITADO = 'Con tu ámbito no puedes modificar los horarios.';
export const MENSAJE_CLASE_EXTRA_LIMITADA = 'Con tu ámbito no puedes crear clases extraordinarias.';
export const MENSAJE_SOLO_ADMIN_EQUIPO = 'Solo el administrador puede gestionar el equipo.';

/** Lo mínimo de la instantánea que necesita este módulo (evita depender de data/db). */
export interface DatosAmbito {
  trabajadores: { id: Id; rol: 'ADMIN' | 'MONITOR' | 'RECEPCION'; ambito: Ambito }[];
  clases: Clase[];
  reservas: { claseId: Id; clienteId: Id }[];
}

/** Ámbito efectivo de la sesión. Clientes y sesiones nulas no tienen ámbito. */
export function ambitoDe(db: Pick<DatosAmbito, 'trabajadores'>, sesion: Sesion | null): Ambito | null {
  if (!sesion || sesion.tipo !== 'TRABAJADOR') return null;
  if (sesion.rol === 'ADMIN') return 'CENTRO';
  if (sesion.ambito) return sesion.ambito;
  const t = db.trabajadores.find((x) => x.id === sesion.trabajadorId);
  if (t?.rol === 'ADMIN') return 'CENTRO';
  return t?.ambito ?? 'CENTRO';
}

/** true si el trabajador solo alcanza sus propias clases. */
export function limitadoASusClases(db: Pick<DatosAmbito, 'trabajadores'>, sesion: Sesion | null): boolean {
  return ambitoDe(db, sesion) === 'SUS_CLASES';
}

/** ¿La clase está dentro del ámbito del trabajador? (un cliente nunca gestiona clases). */
export function puedeGestionarClase(db: Pick<DatosAmbito, 'trabajadores'>, sesion: Sesion | null, clase: Pick<Clase, 'monitorId'>): boolean {
  const ambito = ambitoDe(db, sesion);
  if (!ambito || sesion?.tipo !== 'TRABAJADOR') return false;
  return ambito === 'CENTRO' || clase.monitorId === sesion.trabajadorId;
}

/** Clases dentro del ámbito: todas (CENTRO) o solo las que imparte (SUS_CLASES). */
export function alcanceClases(db: Pick<DatosAmbito, 'trabajadores' | 'clases'>, sesion: Sesion | null): Clase[] {
  if (!limitadoASusClases(db, sesion) || sesion?.tipo !== 'TRABAJADOR') return db.clases;
  return db.clases.filter((c) => c.monitorId === sesion.trabajadorId);
}

/** Franjas del horario dentro del ámbito. */
export function alcancePlantillas(db: Pick<DatosAmbito, 'trabajadores'> & { plantillas: PlantillaClase[] }, sesion: Sesion | null): PlantillaClase[] {
  if (!limitadoASusClases(db, sesion) || sesion?.tipo !== 'TRABAJADOR') return db.plantillas;
  return db.plantillas.filter((p) => p.monitorId === sesion.trabajadorId);
}

/**
 * Ids de los alumnos del trabajador: clientes con alguna reserva (en cualquier
 * estado) en una clase suya. Devuelve null cuando el ámbito es CENTRO (= todos).
 */
export function alumnosDe(db: DatosAmbito, sesion: Sesion | null): Set<Id> | null {
  if (!limitadoASusClases(db, sesion) || sesion?.tipo !== 'TRABAJADOR') return null;
  const mias = new Set(db.clases.filter((c) => c.monitorId === sesion.trabajadorId).map((c) => c.id));
  return new Set(db.reservas.filter((r) => mias.has(r.claseId)).map((r) => r.clienteId));
}

export function esAlumnoMio(db: DatosAmbito, sesion: Sesion | null, clienteId: Id): boolean {
  const alumnos = alumnosDe(db, sesion);
  return alumnos === null ? sesion?.tipo === 'TRABAJADOR' : alumnos.has(clienteId);
}

export function alcanceClientes(db: DatosAmbito & { clientes: Cliente[] }, sesion: Sesion | null): Cliente[] {
  const alumnos = alumnosDe(db, sesion);
  return alumnos === null ? db.clientes : db.clientes.filter((c) => alumnos.has(c.id));
}

/** Avisos visibles: los que publicó el trabajador o los dirigidos a una de sus clases. */
export function alcanceAvisos(db: DatosAmbito & { avisos: Aviso[] }, sesion: Sesion | null): Aviso[] {
  if (!limitadoASusClases(db, sesion) || sesion?.tipo !== 'TRABAJADOR') return db.avisos;
  const mias = new Set(db.clases.filter((c) => c.monitorId === sesion.trabajadorId).map((c) => c.id));
  return db.avisos.filter((a) => a.publicadoPor === sesion.userId || a.publicadoPor === sesion.trabajadorId || (a.destino.tipo === 'CLASE' && mias.has(a.destino.claseId)));
}

/**
 * Recorta una instantánea completa a lo que alcanza el trabajador. Con ámbito
 * CENTRO devuelve el mismo objeto (sin copiar). Con SUS_CLASES deja solo sus
 * clases y franjas, las reservas de esas clases, sus alumnos (con contratos y
 * recuperaciones) y los avisos que le conciernen. Trabajadores, actividades,
 * tarifas y configuración no se tocan.
 */
export function recortarAlAmbito<T extends DatosAmbito & {
  clientes: Cliente[]; plantillas: PlantillaClase[]; avisos: Aviso[];
  contratos: { clienteId: Id }[]; recuperaciones: { clienteId: Id }[]; lecturas: { clienteId: Id }[];
}>(db: T, sesion: Sesion | null): T {
  const alumnos = alumnosDe(db, sesion);
  if (alumnos === null) return db;
  const clases = alcanceClases(db, sesion);
  const clasesIds = new Set(clases.map((c) => c.id));
  return {
    ...db,
    clases,
    plantillas: alcancePlantillas(db, sesion),
    reservas: db.reservas.filter((r) => clasesIds.has(r.claseId)),
    clientes: db.clientes.filter((c) => alumnos.has(c.id)),
    contratos: db.contratos.filter((c) => alumnos.has(c.clienteId)),
    recuperaciones: db.recuperaciones.filter((r) => alumnos.has(r.clienteId)),
    lecturas: db.lecturas.filter((l) => alumnos.has(l.clienteId)),
    avisos: alcanceAvisos(db, sesion),
  };
}
