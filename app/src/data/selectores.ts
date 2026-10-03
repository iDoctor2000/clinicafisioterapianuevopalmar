/** Consultas de solo lectura sobre la instantánea de datos. */
import type { Actividad, Clase, Cliente, Contrato, Id, ISODate, PortadaImagen, Recuperacion, Reserva, Tarifa, Trabajador } from '@/domain/types';
import { plazasLibres } from '@/domain/rules';
import { aISODate, estaEntre } from '@/domain/fechas';
import type { Db } from './db';

export interface ClaseVista {
  clase: Clase;
  actividad: Actividad;
  monitor: Trabajador | null;
  reservas: Reserva[];
  ocupadas: number;
  libres: number;
}

export function vistaClase(db: Db, clase: Clase): ClaseVista {
  const reservas = db.reservas.filter((r) => r.claseId === clase.id);
  const ocupadas = reservas.filter((r) => r.estado === 'RESERVADA').length;
  return {
    clase,
    actividad: db.actividades.find((a) => a.id === clase.actividadId)!,
    monitor: db.trabajadores.find((t) => t.id === clase.monitorId) ?? null,
    reservas,
    ocupadas,
    libres: plazasLibres(clase, reservas),
  };
}

export function clasesDelDia(db: Db, fecha: ISODate): ClaseVista[] {
  return db.clases
    .filter((c) => c.fecha === fecha)
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    .map((c) => vistaClase(db, c));
}

export function clasesEntre(db: Db, desde: ISODate, hasta: ISODate): ClaseVista[] {
  return db.clases
    .filter((c) => estaEntre(c.fecha, desde, hasta))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio))
    .map((c) => vistaClase(db, c));
}

export function contratoActivoDe(db: Db, clienteId: Id, fecha: ISODate = aISODate(new Date())): Contrato | null {
  return (
    db.contratos.find((c) => c.clienteId === clienteId && c.estado === 'ACTIVO' && c.fechaInicio <= fecha && c.fechaFin >= fecha) ??
    db.contratos.find((c) => c.clienteId === clienteId && c.estado === 'ACTIVO') ??
    null
  );
}

export function tarifaDe(db: Db, contrato: Contrato | null): Tarifa | null {
  return contrato ? db.tarifas.find((t) => t.id === contrato.tarifaId) ?? null : null;
}

export interface ReservaVista {
  reserva: Reserva;
  clase: Clase;
  actividad: Actividad;
  monitor: Trabajador | null;
}

export function reservasDeCliente(db: Db, clienteId: Id): ReservaVista[] {
  const clases = new Map(db.clases.map((c) => [c.id, c]));
  return db.reservas
    .filter((r) => r.clienteId === clienteId)
    .map((r) => {
      const clase = clases.get(r.claseId)!;
      return { reserva: r, clase, actividad: db.actividades.find((a) => a.id === clase.actividadId)!, monitor: db.trabajadores.find((t) => t.id === clase.monitorId) ?? null };
    })
    .sort((a, b) => a.clase.fecha.localeCompare(b.clase.fecha) || a.clase.horaInicio.localeCompare(b.clase.horaInicio));
}

export function recuperacionesDeCliente(db: Db, clienteId: Id): Recuperacion[] {
  return db.recuperaciones.filter((r) => r.clienteId === clienteId).sort((a, b) => b.creadaEl.localeCompare(a.creadaEl));
}

export function recuperacionesDisponiblesDe(db: Db, clienteId: Id, hoy: ISODate = aISODate(new Date())): Recuperacion[] {
  return db.recuperaciones.filter((r) => r.clienteId === clienteId && r.estado === 'DISPONIBLE' && r.caducaEl >= hoy);
}

export function avisosDeCliente(db: Db, clienteId: Id) {
  const leidos = new Set(db.lecturas.filter((l) => l.clienteId === clienteId).map((l) => l.avisoId));
  return db.avisos
    .filter((a) => a.destinatariosIds.includes(clienteId))
    .sort((a, b) => b.publicadoEl.localeCompare(a.publicadoEl))
    .map((aviso) => ({ aviso, leido: leidos.has(aviso.id) }));
}

export function avisosNoLeidos(db: Db, clienteId: Id): number {
  return avisosDeCliente(db, clienteId).filter((a) => !a.leido).length;
}

export function nombreCompleto(c: Pick<Cliente, 'nombre' | 'apellidos'> | Pick<Trabajador, 'nombre' | 'apellidos'> | null | undefined): string {
  return c ? `${c.nombre} ${c.apellidos}`.trim() : '';
}

export function clientePorId(db: Db, id: Id): Cliente | undefined {
  return db.clientes.find((c) => c.id === id);
}

export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

/** Fotos de la portada ordenadas por `orden` (y por fecha de creación a igualdad). */
export function portadaOrdenada(lista: PortadaImagen[]): PortadaImagen[] {
  return [...lista].sort((a, b) => a.orden - b.orden || a.creadoEl.localeCompare(b.creadoEl));
}

/** Fotos que ven los clientes en el carrusel: solo las activas, en orden. */
export function portadaVisible(db: Db): PortadaImagen[] {
  return portadaOrdenada(db.portada.filter((p) => p.activa));
}
