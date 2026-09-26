/** Consultas de solo lectura específicas de la zona cliente. */
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Actividad, Categoria, Contrato, Id, ISODate, ISOInstant, PlantillaClase, Recuperacion, Reserva, Tarifa, Trabajador } from '@/domain/types';
import { CATEGORIA_LABEL } from '@/domain/types';
import { evaluarReserva, sesionesPrevistas, type EvaluacionReserva } from '@/domain/rules';
import { aISODate, diasEntre, esPasada, fechaCorta, inicioSemana, sumarDias, DIAS_SEMANA_LABEL } from '@/domain/fechas';
import { indexar, type Db } from '@/data/db';
import { contratoActivoDe, recuperacionesDisponiblesDe, reservasDeCliente, tarifaDe, type ReservaVista } from '@/data/selectores';

/** Evalúa si el cliente puede reservar una clase, con los mismos datos que usa el comando `reservar`. */
export function evaluarReservaDe(db: Db, clienteId: Id, claseId: Id, ahora: Date): EvaluacionReserva {
  const clase = db.clases.find((c) => c.id === claseId);
  if (!clase) return { ok: false, codigo: 'CLASE_CANCELADA', motivo: 'La clase no existe.' };
  const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
  const contrato = contratoActivoDe(db, clienteId, clase.fecha);
  const tarifa = tarifaDe(db, contrato);
  const recuperaciones = recuperacionesDisponiblesDe(db, clienteId, aISODate(ahora));
  return evaluarReserva({
    ahora, config: db.config, contrato, tarifa, clase, actividad,
    reservasCliente: db.reservas.filter((r) => r.clienteId === clienteId),
    reservasClase: db.reservas.filter((r) => r.claseId === clase.id),
    recuperaciones, clasesPorId: indexar(db.clases), actividadesPorId: indexar(db.actividades),
  });
}

export function reservaActivaEn(db: Db, clienteId: Id, claseId: Id): Reserva | null {
  return db.reservas.find((r) => r.clienteId === clienteId && r.claseId === claseId && r.estado === 'RESERVADA') ?? null;
}

export function vistaReserva(db: Db, reserva: Reserva): ReservaVista {
  const clase = db.clases.find((c) => c.id === reserva.claseId)!;
  return { reserva, clase, actividad: db.actividades.find((a) => a.id === clase.actividadId)!, monitor: db.trabajadores.find((t) => t.id === clase.monitorId) ?? null };
}

/** Primera reserva activa cuya clase todavía no ha empezado. */
export function proximaReserva(db: Db, clienteId: Id, ahora: Date): ReservaVista | null {
  return reservasDeCliente(db, clienteId).find((v) => v.reserva.estado === 'RESERVADA' && !esPasada(v.clase.fecha, v.clase.horaInicio, ahora)) ?? null;
}

export function reservasFuturas(db: Db, clienteId: Id, ahora: Date): ReservaVista[] {
  return reservasDeCliente(db, clienteId).filter((v) => !esPasada(v.clase.fecha, v.clase.horaInicio, ahora));
}

export function reservasPasadas(db: Db, clienteId: Id, ahora: Date): ReservaVista[] {
  return reservasDeCliente(db, clienteId).filter((v) => esPasada(v.clase.fecha, v.clase.horaInicio, ahora)).reverse();
}

/** Categorías de actividad que cubre una tarifa. */
export function categoriasDeTarifa(tarifa: Tarifa | null): Categoria[] {
  if (!tarifa) return [];
  if (tarifa.tipo === 'BONO' && tarifa.bono) return [tarifa.bono.categoria];
  return tarifa.cupos.map((c) => c.categoria);
}

/** ¿La tarifa del cliente incluye esta actividad (sin contar recuperaciones)? */
export function actividadIncluida(tarifa: Tarifa | null, contrato: Contrato | null, actividad: Actividad): boolean {
  if (!tarifa || !contrato) return false;
  if (contrato.actividadesPermitidasIds.length > 0 && !contrato.actividadesPermitidasIds.includes(actividad.id)) return false;
  return categoriasDeTarifa(tarifa).includes(actividad.categoria);
}

/** ¿Alguna recuperación disponible sirve para esta categoría? */
export function recuperacionCubre(recuperaciones: Recuperacion[], categoria: Categoria): boolean {
  return recuperaciones.some((r) => r.categoriasPermitidas.includes(categoria));
}

export interface FranjaVista {
  plantilla: PlantillaClase;
  actividad: Actividad;
  monitor: Trabajador | null;
}

/** Franjas del horario fijo del contrato, ordenadas por día y hora. */
export function horarioFijoDe(db: Db, contrato: Contrato | null): FranjaVista[] {
  if (!contrato || contrato.modalidad !== 'FIJO') return [];
  return contrato.franjasFijas
    .map((f) => db.plantillas.find((p) => p.id === f.plantillaId))
    .filter((p): p is PlantillaClase => !!p)
    .sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio))
    .map((plantilla) => ({
      plantilla,
      actividad: db.actividades.find((a) => a.id === plantilla.actividadId)!,
      monitor: db.trabajadores.find((t) => t.id === plantilla.monitorId) ?? null,
    }));
}

export function textoFranja(f: FranjaVista): string {
  return `${DIAS_SEMANA_LABEL[f.plantilla.diaSemana]} a las ${f.plantilla.horaInicio} · ${f.actividad.nombre}`;
}

/** Número de clases previstas en el periodo (solo horario fijo). */
export function clasesPrevistas(db: Db, contrato: Contrato | null): number | null {
  if (!contrato || contrato.modalidad !== 'FIJO') return null;
  return sesionesPrevistas(contrato, db.plantillas, db.config).total;
}

export function textoCategorias(categorias: Categoria[]): string {
  const nombres = categorias.map((c) => CATEGORIA_LABEL[c].toLowerCase());
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Formato de fechas amable
// ---------------------------------------------------------------------------

/** "30 de noviembre" */
export function diaMes(fecha: ISODate): string {
  return format(parseISO(fecha), "d 'de' MMMM", { locale: es });
}

/** "del 1 de agosto al 30 de noviembre" */
export function periodoTexto(contrato: Pick<Contrato, 'fechaInicio' | 'fechaFin'>): string {
  return `del ${diaMes(contrato.fechaInicio)} al ${diaMes(contrato.fechaFin)}`;
}

/** Primera letra en mayúscula ("lunes 28 de septiembre" → "Lunes 28 de septiembre"). */
export function cap(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "hoy", "ayer", "hace 3 días", "hace 2 semanas", "el mar 2 sep". */
export function fechaRelativa(instante: ISOInstant, ahora: Date = new Date()): string {
  const d = parseISO(instante);
  const dias = differenceInCalendarDays(ahora, d);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  if (dias < 30) {
    const semanas = Math.floor(dias / 7);
    return semanas === 1 ? 'hace 1 semana' : `hace ${semanas} semanas`;
  }
  return `el ${fechaCorta(aISODate(d))}`;
}

/** Días que faltan hasta una fecha (0 = hoy). */
export function diasHasta(fecha: ISODate, ahora: Date = new Date()): number {
  return differenceInCalendarDays(parseISO(fecha), ahora);
}

// ---------------------------------------------------------------------------
// Vista semanal del horario
// ---------------------------------------------------------------------------

/** Días de la semana (lunes-primero) de la fecha, acotados al rango [desde, hasta]. */
export function diasDeSemanaAcotados(fecha: ISODate, desde: ISODate, hasta: ISODate): ISODate[] {
  const lunes = inicioSemana(fecha);
  return diasEntre(lunes, sumarDias(lunes, 6)).filter((d) => d >= desde && d <= hasta);
}

/** "28 sep – 4 oct" */
export function textoSemana(fecha: ISODate): string {
  const lunes = inicioSemana(fecha);
  const domingo = sumarDias(lunes, 6);
  const f = (d: ISODate, patron: string) => format(parseISO(d), patron, { locale: es }).replace('.', '');
  if (lunes.slice(0, 7) === domingo.slice(0, 7)) return `${f(lunes, 'd')} – ${f(domingo, 'd MMM')}`;
  return `${f(lunes, 'd MMM')} – ${f(domingo, 'd MMM')}`;
}

/** "Lunes 28" */
export function diaConNumero(fecha: ISODate): string {
  return cap(format(parseISO(fecha), 'EEEE d', { locale: es }));
}
