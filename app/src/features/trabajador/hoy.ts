/**
 * "El día de hoy" del equipo: lo que hay hoy en el centro y lo que conviene mirar, en una sola
 * pantalla. Todo son consultas de solo lectura sobre la instantánea (la `db` ya recortada al
 * ámbito del trabajador y sin finanzas si no las ve): no cambia ningún dato.
 */
import type { Db } from '@/data/db';
import { vistaClase, type ClaseVista } from '@/data/selectores';
import type { Cliente, Clase, Contrato, Id, ISODate } from '@/domain/types';
import { aFechaHora, esPasada, horaFin, sumarDias } from '@/domain/fechas';
import { esCumpleanos } from '@/domain/logros';
import { claseVisibleEnCalendario, listaEsperaDeClase } from './consultas';

export type MomentoClase = 'PROXIMA' | 'EN_CURSO' | 'TERMINADA' | 'CANCELADA';

export interface ClaseDeHoy {
  vista: ClaseVista;
  momento: MomentoClase;
  /** Alumnos en lista de espera. */
  enEspera: number;
  /** Terminada, con alumnos y sin ninguna asistencia marcada (misma regla que el resumen nocturno). */
  sinLista: boolean;
}

/** Alumnos con plaza (reserva en pie) en la clase. */
function conPlaza(vista: ClaseVista) {
  return vista.reservas.filter((r) => r.estado === 'RESERVADA');
}

/** Terminada, con alumnos y sin ninguna asistencia marcada. */
export function faltaPasarLista(vista: ClaseVista, ahora: Date): boolean {
  const { clase } = vista;
  if (clase.estado !== 'PROGRAMADA') return false;
  if (aFechaHora(clase.fecha, horaFin(clase.horaInicio, clase.duracionMin)) > ahora) return false;
  const plaza = conPlaza(vista);
  return plaza.length > 0 && plaza.every((r) => r.asistencia === 'PENDIENTE');
}

function momentoDe(clase: Clase, ahora: Date): MomentoClase {
  if (clase.estado === 'CANCELADA') return 'CANCELADA';
  if (aFechaHora(clase.fecha, horaFin(clase.horaInicio, clase.duracionMin)) <= ahora) return 'TERMINADA';
  return esPasada(clase.fecha, clase.horaInicio, ahora) ? 'EN_CURSO' : 'PROXIMA';
}

/** Clases de un día tal como salen en el calendario, con su momento, lista de espera y si falta pasar lista. */
export function clasesDeDia(db: Db, fecha: ISODate, ahora: Date): ClaseDeHoy[] {
  return db.clases
    .filter((c) => c.fecha === fecha && claseVisibleEnCalendario(db, c))
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    .map((c) => {
      const vista = vistaClase(db, c);
      return { vista, momento: momentoDe(c, ahora), enEspera: c.estado === 'CANCELADA' ? 0 : listaEsperaDeClase(db, c.id).length, sinLista: faltaPasarLista(vista, ahora) };
    });
}

/** La clase que está dándose ahora o, si no hay ninguna, la siguiente de hoy. */
export function claseDestacada(clases: ClaseDeHoy[]): ClaseDeHoy | null {
  return clases.find((c) => c.momento === 'EN_CURSO') ?? clases.find((c) => c.momento === 'PROXIMA') ?? null;
}

export interface CifrasDia {
  clases: number;
  /** Plazas ocupadas en las clases programadas. */
  alumnos: number;
  plazasLibres: number;
  completas: number;
  enEspera: number;
}

export function cifrasDia(clases: ClaseDeHoy[]): CifrasDia {
  const prog = clases.filter((c) => c.momento !== 'CANCELADA');
  return {
    clases: prog.length,
    alumnos: prog.reduce((s, c) => s + c.vista.ocupadas, 0),
    plazasLibres: prog.reduce((s, c) => s + Math.max(0, c.vista.libres), 0),
    completas: prog.filter((c) => c.vista.ocupadas >= c.vista.clase.plazas).length,
    enEspera: prog.reduce((s, c) => s + c.enEspera, 0),
  };
}

// ---------------------------------------------------------------------------
// Alumnos a los que hay que tener un detalle en clase
// ---------------------------------------------------------------------------

/** Días sin venir a partir de los cuales se dice "vuelve tras N semanas". */
export const DIAS_PARA_VUELVE = 21;
/** Un alumno dado de alta hace menos de esto y sin clases anteriores es "nuevo". */
export const DIAS_ALUMNO_NUEVO = 30;

export type Detalle =
  | { tipo: 'CUMPLE' }
  | { tipo: 'NUEVO' }
  | { tipo: 'VUELVE'; semanas: number };

/** Última clase hecha (reserva en pie, sin "No asiste", clase no cancelada) antes de `fecha`. */
function ultimaClaseAntes(db: Db, clienteId: Id, fecha: ISODate, clasesPorId: Map<Id, Clase>): ISODate | null {
  let ultima: ISODate | null = null;
  for (const r of db.reservas) {
    if (r.clienteId !== clienteId || r.estado !== 'RESERVADA' || r.asistencia === 'NO_ASISTE') continue;
    const c = clasesPorId.get(r.claseId);
    if (!c || c.estado === 'CANCELADA' || c.fecha >= fecha) continue;
    if (!ultima || c.fecha > ultima) ultima = c.fecha;
  }
  return ultima;
}

function diasEntreFechas(desde: ISODate, hasta: ISODate): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);
}

/**
 * Por cada alumno con plaza en la clase, los detalles que conviene saber al recibirle:
 * cumple años hoy, es nuevo (alta reciente y es su primera clase) o vuelve tras unas semanas sin venir.
 */
export function detallesDeClase(db: Db, vista: ClaseVista): Map<Id, Detalle[]> {
  const fecha = vista.clase.fecha;
  const clasesPorId = new Map(db.clases.map((c) => [c.id, c]));
  const r = new Map<Id, Detalle[]>();
  for (const reserva of conPlaza(vista)) {
    const cliente = db.clientes.find((c) => c.id === reserva.clienteId);
    if (!cliente) continue;
    const lista: Detalle[] = [];
    if (esCumpleanos(cliente.fechaNacimiento, fecha)) lista.push({ tipo: 'CUMPLE' });
    const ultima = ultimaClaseAntes(db, cliente.id, fecha, clasesPorId);
    if (!ultima) {
      if (cliente.altaEl && diasEntreFechas(cliente.altaEl, fecha) <= DIAS_ALUMNO_NUEVO) lista.push({ tipo: 'NUEVO' });
    } else {
      const dias = diasEntreFechas(ultima, fecha);
      if (dias >= DIAS_PARA_VUELVE) lista.push({ tipo: 'VUELVE', semanas: Math.floor(dias / 7) });
    }
    if (lista.length) r.set(cliente.id, lista);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Para mirar
// ---------------------------------------------------------------------------

/** Clases ya terminadas de los últimos `dias` días (hoy incluido) con alumnos y sin pasar lista, de la más reciente a la más antigua. */
export function clasesSinPasarLista(db: Db, ahora: Date, hoy: ISODate, dias = 7): ClaseVista[] {
  const desde = sumarDias(hoy, -dias);
  return db.clases
    .filter((c) => c.estado === 'PROGRAMADA' && c.fecha >= desde && c.fecha <= hoy)
    .map((c) => vistaClase(db, c))
    .filter((v) => faltaPasarLista(v, ahora))
    .sort((a, b) => b.clase.fecha.localeCompare(a.clase.fecha) || b.clase.horaInicio.localeCompare(a.clase.horaInicio));
}

export interface FijoSinPlaza {
  cliente: Cliente;
  contrato: Contrato;
  vista: ClaseVista;
  /** Puesto en la lista de espera de esa clase (null si no está apuntado). */
  posicion: number | null;
}

/**
 * Alumnos de horario fijo que no tienen plaza en una clase de su franja de los próximos `dias` días
 * (hoy incluido, solo clases que aún no han empezado). No cuenta las que el propio alumno canceló ni
 * las de fuera de las fechas de su contrato. Es lo mismo que el resumen nocturno llama "sin plaza
 * en una clase suya porque está completa".
 */
export function fijosSinPlaza(db: Db, ahora: Date, hoy: ISODate, dias = 7): FijoSinPlaza[] {
  const hasta = sumarDias(hoy, dias - 1);
  const r: FijoSinPlaza[] = [];
  for (const contrato of db.contratos) {
    if (contrato.estado !== 'ACTIVO' || contrato.modalidad !== 'FIJO' || contrato.franjasFijas.length === 0) continue;
    const cliente = db.clientes.find((c) => c.id === contrato.clienteId);
    if (!cliente?.activo) continue;
    const franjas = new Set(contrato.franjasFijas.map((f) => f.plantillaId));
    for (const clase of db.clases) {
      if (!clase.plantillaId || !franjas.has(clase.plantillaId) || clase.estado !== 'PROGRAMADA') continue;
      if (clase.fecha < hoy || clase.fecha > hasta || clase.fecha < contrato.fechaInicio || clase.fecha > contrato.fechaFin) continue;
      if (esPasada(clase.fecha, clase.horaInicio, ahora)) continue;
      // Cualquier fila suya en la clase (con plaza o cancelada por él) significa que no es "sin plaza".
      if (db.reservas.some((x) => x.claseId === clase.id && x.clienteId === cliente.id)) continue;
      const espera = listaEsperaDeClase(db, clase.id).find((e) => e.entrada.clienteId === cliente.id);
      r.push({ cliente, contrato, vista: vistaClase(db, clase), posicion: espera?.posicion ?? null });
    }
  }
  return r.sort((a, b) => a.vista.clase.fecha.localeCompare(b.vista.clase.fecha) || a.vista.clase.horaInicio.localeCompare(b.vista.clase.horaInicio) || a.cliente.apellidos.localeCompare(b.cliente.apellidos, 'es'));
}

/** Agrupa los "sin plaza" por alumno, en el orden de su primera clase afectada. */
export function agruparPorAlumno(lista: FijoSinPlaza[]): { cliente: Cliente; clases: FijoSinPlaza[] }[] {
  const grupos = new Map<Id, { cliente: Cliente; clases: FijoSinPlaza[] }>();
  for (const x of lista) {
    const g = grupos.get(x.cliente.id) ?? { cliente: x.cliente, clases: [] };
    g.clases.push(x);
    grupos.set(x.cliente.id, g);
  }
  return [...grupos.values()];
}

/** Alumnos dados de alta en los últimos `dias` días (hoy incluido), del más reciente al más antiguo. */
export function altasRecientes(db: Db, hoy: ISODate, dias = 7): Cliente[] {
  const desde = sumarDias(hoy, -(dias - 1));
  return db.clientes
    .filter((c) => c.activo && c.altaEl >= desde && c.altaEl <= hoy)
    .sort((a, b) => b.altaEl.localeCompare(a.altaEl) || a.apellidos.localeCompare(b.apellidos, 'es'));
}

/** "Buenos días" / "Buenas tardes" / "Buenas noches". */
export function saludo(ahora: Date): string {
  const h = ahora.getHours();
  if (h >= 6 && h < 14) return 'Buenos días';
  if (h >= 14 && h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}
