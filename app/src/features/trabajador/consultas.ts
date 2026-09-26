/** Consultas puras de la zona trabajador (sin efectos, sin React). */
import { format, parseISO, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Actividad, Clase, Cliente, Contrato, DiaSemana, Id, ISODate, PlantillaClase, Reserva, Tarifa, Trabajador } from '@/domain/types';
import type { Db } from '@/data/db';
import { contratoActivoDe, recuperacionesDisponiblesDe, tarifaDe, vistaClase, type ClaseVista } from '@/data/selectores';
import { aISODate, diasEntre, esPasada, estaEntre, inicioSemana, sumarDias } from '@/domain/fechas';

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export interface ResumenCliente {
  cliente: Cliente;
  contrato: Contrato | null;
  tarifa: Tarifa | null;
  recuperaciones: number;
}

export function resumenCliente(db: Db, cliente: Cliente, hoy: ISODate): ResumenCliente {
  const contrato = contratoActivoDe(db, cliente.id, hoy);
  return { cliente, contrato, tarifa: tarifaDe(db, contrato), recuperaciones: recuperacionesDisponiblesDe(db, cliente.id, hoy).length };
}

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Busca por nombre, apellidos, DNI o teléfono (sin acentos, sin espacios en el teléfono). */
export function buscarClientes(db: Db, texto: string, soloActivos: boolean): Cliente[] {
  const q = normalizar(texto);
  const qTel = q.replace(/\s+/g, '');
  return db.clientes
    .filter((c) => !soloActivos || c.activo)
    .filter((c) => {
      if (!q) return true;
      const nombre = normalizar(`${c.nombre} ${c.apellidos}`);
      return nombre.includes(q) || normalizar(c.dni).includes(q) || (qTel.length > 0 && c.telefono.replace(/\s+/g, '').includes(qTel));
    })
    .sort((a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, 'es'));
}

export interface HistorialAsistencia {
  asistidas: number;
  faltas: number;
  canceladas: number;
  recuperables: number;
  noRecuperables: number;
  porCentro: number;
}

export function historialAsistencia(db: Db, clienteId: Id): HistorialAsistencia {
  const h: HistorialAsistencia = { asistidas: 0, faltas: 0, canceladas: 0, recuperables: 0, noRecuperables: 0, porCentro: 0 };
  for (const r of db.reservas) {
    if (r.clienteId !== clienteId) continue;
    if (r.estado === 'RESERVADA') {
      if (r.asistencia === 'ASISTE') h.asistidas += 1;
      if (r.asistencia === 'NO_ASISTE') h.faltas += 1;
    } else {
      h.canceladas += 1;
      if (r.estado === 'CANCELADA_RECUPERABLE') h.recuperables += 1;
      if (r.estado === 'CANCELADA_NO_RECUPERABLE') h.noRecuperables += 1;
      if (r.estado === 'CANCELADA_CENTRO') h.porCentro += 1;
    }
  }
  return h;
}

export function contratosDeCliente(db: Db, clienteId: Id): Contrato[] {
  return db.contratos.filter((c) => c.clienteId === clienteId).sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));
}

export function plantillaVista(db: Db, plantillaId: Id): { plantilla: PlantillaClase; actividad: Actividad | null; monitor: Trabajador | null } | null {
  const plantilla = db.plantillas.find((p) => p.id === plantillaId);
  if (!plantilla) return null;
  return { plantilla, actividad: db.actividades.find((a) => a.id === plantilla.actividadId) ?? null, monitor: db.trabajadores.find((t) => t.id === plantilla.monitorId) ?? null };
}

// ---------------------------------------------------------------------------
// Clases y calendario
// ---------------------------------------------------------------------------

export function diasDeSemana(fecha: ISODate): ISODate[] {
  const lunes = inicioSemana(fecha);
  return diasEntre(lunes, sumarDias(lunes, 6));
}

export function clasesPorDiaDeSemana(db: Db, fecha: ISODate): { fecha: ISODate; clases: ClaseVista[] }[] {
  return diasDeSemana(fecha).map((f) => ({
    fecha: f,
    clases: db.clases.filter((c) => c.fecha === f).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)).map((c) => vistaClase(db, c)),
  }));
}

export function clasesSueltasDe(vista: ClaseVista): number {
  return vista.reservas.filter((r) => r.estado === 'RESERVADA' && r.origen === 'CLASE_SUELTA').length;
}

/** Clases programadas de la misma actividad en los próximos 14 días (para proponer alternativa). */
export function alternativasPara(db: Db, clase: Clase, hoy: ISODate): ClaseVista[] {
  const hasta = sumarDias(hoy, 14);
  return db.clases
    .filter((c) => c.id !== clase.id && c.actividadId === clase.actividadId && c.estado === 'PROGRAMADA' && estaEntre(c.fecha, hoy, hasta))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio))
    .map((c) => vistaClase(db, c));
}

/** Clases programadas próximas (para selectores de avisos y reservas). */
export function clasesProximas(db: Db, hoy: ISODate, dias = 14): ClaseVista[] {
  const hasta = sumarDias(hoy, dias);
  return db.clases
    .filter((c) => c.estado === 'PROGRAMADA' && estaEntre(c.fecha, hoy, hasta))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio))
    .map((c) => vistaClase(db, c));
}

export function monitores(db: Db): Trabajador[] {
  return db.trabajadores.filter((t) => t.esMonitor && t.activo);
}

export function nombreTrabajador(db: Db, userIdOTrabajadorId: Id): string {
  const t = db.trabajadores.find((x) => x.id === userIdOTrabajadorId || x.userId === userIdOTrabajadorId);
  if (t) return `${t.nombre} ${t.apellidos}`.trim();
  if (userIdOTrabajadorId === 'sistema') return 'Sistema';
  const c = db.clientes.find((x) => x.id === userIdOTrabajadorId || x.userId === userIdOTrabajadorId);
  return c ? `${c.nombre} ${c.apellidos}` : userIdOTrabajadorId;
}

export function plantillasPorDia(db: Db): Record<DiaSemana, PlantillaClase[]> {
  const r: Record<DiaSemana, PlantillaClase[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const p of [...db.plantillas].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))) r[p.diaSemana].push(p);
  return r;
}

/** Franjas fijas de una plantilla ocupadas por contratos activos de horario fijo. */
export function ocupacionFijaDePlantilla(db: Db, plantillaId: Id): number {
  return db.contratos.filter((c) => c.estado === 'ACTIVO' && c.modalidad === 'FIJO' && c.franjasFijas.some((f) => f.plantillaId === plantillaId)).length;
}

// ---------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------

export type FranjaHoraria = 'TODAS' | 'MANANA' | 'TARDE';

export interface FiltroEstadisticas {
  desde: ISODate;
  hasta: ISODate;
  actividadId: Id | null;
  franja: FranjaHoraria;
}

export interface Estadisticas {
  clientesActivos: number;
  altas: number;
  bajas: number;
  clasesImpartidas: number;
  clasesCanceladas: number;
  ocupacionMedia: number; // 0-100
  plazasLibres: number;
  asistencias: number;
  faltas: number;
  cancelaciones: { total: number; recuperables: number; noRecuperables: number; centro: number };
  recuperacionesUsadas: number;
  bonoUsadas: number;
  porActividad: { actividad: Actividad; clases: number; ocupadas: number; plazas: number; porcentaje: number }[];
  porHora: { hora: string; clases: number; ocupadas: number; plazas: number; porcentaje: number }[];
}

export function esManana(hora: string): boolean {
  return hora < '15:00';
}

function cumpleFiltro(c: Clase, filtro: FiltroEstadisticas): boolean {
  if (!estaEntre(c.fecha, filtro.desde, filtro.hasta)) return false;
  if (filtro.actividadId && c.actividadId !== filtro.actividadId) return false;
  if (filtro.franja === 'MANANA' && !esManana(c.horaInicio)) return false;
  if (filtro.franja === 'TARDE' && esManana(c.horaInicio)) return false;
  return true;
}

export function calcularEstadisticas(db: Db, filtro: FiltroEstadisticas, ahora: Date): Estadisticas {
  const clases = db.clases.filter((c) => cumpleFiltro(c, filtro));
  const clasesIds = new Set(clases.map((c) => c.id));
  const impartidas = clases.filter((c) => c.estado === 'PROGRAMADA' && esPasada(c.fecha, c.horaInicio, ahora));
  const reservas = db.reservas.filter((r) => clasesIds.has(r.claseId));
  const ocupadasPorClase = new Map<Id, number>();
  for (const r of reservas) if (r.estado === 'RESERVADA') ocupadasPorClase.set(r.claseId, (ocupadasPorClase.get(r.claseId) ?? 0) + 1);

  let sumaPorc = 0;
  let libres = 0;
  for (const c of impartidas) {
    const oc = ocupadasPorClase.get(c.id) ?? 0;
    sumaPorc += c.plazas > 0 ? Math.min(1, oc / c.plazas) : 0;
    libres += Math.max(0, c.plazas - oc);
  }

  const cancel = { total: 0, recuperables: 0, noRecuperables: 0, centro: 0 };
  let asistencias = 0;
  let faltas = 0;
  let recUsadas = 0;
  let bonoUsadas = 0;
  for (const r of reservas) {
    if (r.estado === 'RESERVADA') {
      if (r.asistencia === 'ASISTE') asistencias += 1;
      if (r.asistencia === 'NO_ASISTE') faltas += 1;
      if (r.origen === 'RECUPERACION') recUsadas += 1;
      if (r.origen === 'BONO') bonoUsadas += 1;
    } else {
      cancel.total += 1;
      if (r.estado === 'CANCELADA_RECUPERABLE') cancel.recuperables += 1;
      if (r.estado === 'CANCELADA_NO_RECUPERABLE') cancel.noRecuperables += 1;
      if (r.estado === 'CANCELADA_CENTRO') cancel.centro += 1;
    }
  }

  const agrupar = <K,>(items: Clase[], clave: (c: Clase) => K) => {
    const m = new Map<K, { clases: number; ocupadas: number; plazas: number }>();
    for (const c of items) {
      const k = clave(c);
      const g = m.get(k) ?? { clases: 0, ocupadas: 0, plazas: 0 };
      g.clases += 1;
      g.ocupadas += ocupadasPorClase.get(c.id) ?? 0;
      g.plazas += c.plazas;
      m.set(k, g);
    }
    return m;
  };
  const baseOcupacion = impartidas.length > 0 ? impartidas : clases.filter((c) => c.estado === 'PROGRAMADA');
  const porAct = agrupar(baseOcupacion, (c) => c.actividadId);
  const porActividad = db.actividades
    .filter((a) => porAct.has(a.id))
    .map((a) => {
      const g = porAct.get(a.id)!;
      return { actividad: a, ...g, porcentaje: g.plazas ? Math.round((g.ocupadas / g.plazas) * 100) : 0 };
    })
    .sort((a, b) => b.porcentaje - a.porcentaje);
  const porH = agrupar(baseOcupacion, (c) => c.horaInicio);
  const porHora = Array.from(porH.entries())
    .map(([hora, g]) => ({ hora, ...g, porcentaje: g.plazas ? Math.round((g.ocupadas / g.plazas) * 100) : 0 }))
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const altas = db.clientes.filter((c) => estaEntre(c.altaEl, filtro.desde, filtro.hasta)).length
    + db.contratos.filter((c) => estaEntre(c.fechaInicio, filtro.desde, filtro.hasta) && !estaEntre(db.clientes.find((x) => x.id === c.clienteId)?.altaEl ?? '', filtro.desde, filtro.hasta)).length;
  const conActivo = new Set(db.contratos.filter((c) => c.estado === 'ACTIVO').map((c) => c.clienteId));
  const bajas = db.clientes.filter((c) => c.bajaEl && estaEntre(c.bajaEl, filtro.desde, filtro.hasta)).length
    + db.contratos.filter((c) => c.estado !== 'ACTIVO' && estaEntre(c.fechaFin, filtro.desde, filtro.hasta) && !conActivo.has(c.clienteId)).length;

  return {
    clientesActivos: db.clientes.filter((c) => c.activo).length,
    altas,
    bajas,
    clasesImpartidas: impartidas.length,
    clasesCanceladas: clases.filter((c) => c.estado === 'CANCELADA').length,
    ocupacionMedia: impartidas.length ? Math.round((sumaPorc / impartidas.length) * 100) : 0,
    plazasLibres: libres,
    asistencias,
    faltas,
    cancelaciones: cancel,
    recuperacionesUsadas: recUsadas,
    bonoUsadas,
    porActividad,
    porHora,
  };
}

export interface MesAsistencias {
  mes: ISODate;
  etiqueta: string;
  asistencias: number;
  faltas: number;
}

/** Asistencias y faltas por mes de los últimos N meses (incluido el actual). */
export function asistenciasMensuales(db: Db, ahora: Date, meses = 6, actividadId: Id | null = null): MesAsistencias[] {
  const clasesPorId = new Map(db.clases.map((c) => [c.id, c]));
  const salida: MesAsistencias[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = subMonths(ahora, i);
    const desde = aISODate(startOfMonth(d));
    const hasta = aISODate(endOfMonth(d));
    let asistencias = 0;
    let faltas = 0;
    for (const r of db.reservas) {
      if (r.estado !== 'RESERVADA') continue;
      const c = clasesPorId.get(r.claseId);
      if (!c || !estaEntre(c.fecha, desde, hasta)) continue;
      if (actividadId && c.actividadId !== actividadId) continue;
      if (r.asistencia === 'ASISTE') asistencias += 1;
      if (r.asistencia === 'NO_ASISTE') faltas += 1;
    }
    salida.push({ mes: desde, etiqueta: format(parseISO(desde), 'MMM', { locale: es }), asistencias, faltas });
  }
  return salida;
}

export function rangoMes(d: Date): { desde: ISODate; hasta: ISODate } {
  return { desde: aISODate(startOfMonth(d)), hasta: aISODate(endOfMonth(d)) };
}

// ---------------------------------------------------------------------------
// Reservas de un cliente
// ---------------------------------------------------------------------------

export function reservasDeClienteSeparadas(db: Db, clienteId: Id, ahora: Date): { proximas: Reserva[]; pasadas: Reserva[] } {
  const clases = new Map(db.clases.map((c) => [c.id, c]));
  const mias = db.reservas.filter((r) => r.clienteId === clienteId);
  const proximas = mias.filter((r) => { const c = clases.get(r.claseId); return c && !esPasada(c.fecha, c.horaInicio, ahora); });
  const pasadas = mias.filter((r) => { const c = clases.get(r.claseId); return c && esPasada(c.fecha, c.horaInicio, ahora); });
  const ord = (a: Reserva, b: Reserva) => { const ca = clases.get(a.claseId)!; const cb = clases.get(b.claseId)!; return ca.fecha.localeCompare(cb.fecha) || ca.horaInicio.localeCompare(cb.horaInicio); };
  return { proximas: proximas.sort(ord), pasadas: pasadas.sort((a, b) => -ord(a, b)) };
}
