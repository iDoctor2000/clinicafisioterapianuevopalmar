/**
 * Logros del alumno: medallas, cumpleaños y "Tu año en Pilates".
 * Lógica pura (sin estado) a partir de la lista de clases hechas del alumno.
 *
 * Una clase cuenta como "hecha" si la reserva sigue en pie (no cancelada), la clase no
 * se canceló, no se marcó "No asiste" y ya ha empezado. Así funciona aunque algún día
 * no se pase lista. La misma regla está en SQL (historial_clases, 0014).
 */
import type { Clase, HoraHHmm, Id, ISODate, Reserva } from './types';
import { aISODate, inicioSemana, sumarDias } from './fechas';

export interface ClaseHecha {
  fecha: ISODate;
  hora: HoraHHmm;
  duracionMin: number;
  actividadId: Id;
  monitorId: Id | null;
}

/** Clases hechas de un cliente a partir de los datos en memoria (demo). */
export function clasesHechasDe(reservas: Reserva[], clases: Clase[], clienteId: Id, ahora: Date, hastaFecha?: ISODate): ClaseHecha[] {
  const porId = new Map(clases.map((c) => [c.id, c]));
  const hoy = aISODate(ahora);
  const horaAhora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const r: ClaseHecha[] = [];
  for (const x of reservas) {
    if (x.clienteId !== clienteId || x.estado !== 'RESERVADA' || x.asistencia === 'NO_ASISTE') continue;
    const c = porId.get(x.claseId);
    if (!c || c.estado === 'CANCELADA') continue;
    if (hastaFecha ? c.fecha > hastaFecha : c.fecha > hoy || (c.fecha === hoy && c.horaInicio > horaAhora)) continue;
    r.push({ fecha: c.fecha, hora: c.horaInicio, duracionMin: c.duracionMin, actividadId: c.actividadId, monitorId: c.monitorId || null });
  }
  return r.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
}

// ---------------------------------------------------------------------------
// Rachas (semanas seguidas con al menos una clase)
// ---------------------------------------------------------------------------

/** Lunes de cada semana con clase, sin repetir y en orden. */
function semanasConClase(clases: ClaseHecha[]): ISODate[] {
  return Array.from(new Set(clases.map((c) => inicioSemana(c.fecha)))).sort();
}

/** Mayor número de semanas seguidas con al menos una clase. */
export function mejorRacha(clases: ClaseHecha[]): number {
  const semanas = semanasConClase(clases);
  let mejor = 0;
  let actual = 0;
  let anterior: ISODate | null = null;
  for (const s of semanas) {
    actual = anterior && sumarDias(anterior, 7) === s ? actual + 1 : 1;
    mejor = Math.max(mejor, actual);
    anterior = s;
  }
  return mejor;
}

// ---------------------------------------------------------------------------
// Medallas
// ---------------------------------------------------------------------------

export type IdMedalla =
  | 'primera' | 'c10' | 'c25' | 'c50' | 'c100' | 'c200'
  | 'semana-completa' | 'racha4' | 'racha12' | 'madrugador' | 'explorador' | 'aniversario';

export interface Medalla {
  id: IdMedalla;
  nombre: string;
  /** Qué hay que hacer para conseguirla. */
  descripcion: string;
  /** Icono (nombre de lucide-react, lo resuelve la interfaz). */
  icono: string;
}

export const MEDALLAS: Medalla[] = [
  { id: 'primera', nombre: 'Primera clase', descripcion: 'Tu primera clase en el centro.', icono: 'Sprout' },
  { id: 'c10', nombre: '10 clases', descripcion: 'Diez clases hechas.', icono: 'Star' },
  { id: 'c25', nombre: '25 clases', descripcion: 'Veinticinco clases hechas.', icono: 'Sparkles' },
  { id: 'c50', nombre: '50 clases', descripcion: 'Cincuenta clases hechas.', icono: 'Medal' },
  { id: 'c100', nombre: '100 clases', descripcion: 'Cien clases. ¡Enhorabuena!', icono: 'Trophy' },
  { id: 'c200', nombre: '200 clases', descripcion: 'Doscientas clases: eres de la casa.', icono: 'Crown' },
  { id: 'semana-completa', nombre: 'Semana completa', descripcion: 'Todas las clases de tu tarifa en una misma semana.', icono: 'CalendarCheck' },
  { id: 'racha4', nombre: 'Racha de 4 semanas', descripcion: 'Cuatro semanas seguidas sin faltar.', icono: 'Flame' },
  { id: 'racha12', nombre: 'Racha de 12 semanas', descripcion: 'Doce semanas seguidas sin faltar.', icono: 'Gem' },
  { id: 'madrugador', nombre: 'Madrugador/a', descripcion: 'Diez clases antes de las 10:00.', icono: 'Sunrise' },
  { id: 'explorador', nombre: 'Explorador/a', descripcion: 'Has probado tres actividades distintas.', icono: 'Compass' },
  { id: 'aniversario', nombre: 'Un año con nosotros', descripcion: 'Un año desde tu primera clase.', icono: 'Heart' },
];

export interface EstadoMedalla {
  medalla: Medalla;
  conseguida: boolean;
  /** Progreso hacia la medalla (para "te quedan…"). */
  actual: number;
  objetivo: number;
  /** Fecha en la que se consiguió (si se conoce). */
  conseguidaEl: ISODate | null;
}

/** Texto de lo que falta: "Te quedan 3 clases". */
export function textoFalta(e: EstadoMedalla): string {
  const n = Math.max(0, e.objetivo - e.actual);
  switch (e.medalla.id) {
    case 'semana-completa': return `Haz ${e.objetivo === 1 ? 'tu clase' : `tus ${e.objetivo} clases`} de una semana`;
    case 'racha4': case 'racha12': return `Llevas ${e.actual} de ${e.objetivo} semanas`;
    case 'madrugador': return `Te ${n === 1 ? 'queda 1 clase' : `quedan ${n} clases`} de mañana`;
    case 'explorador': return `Te ${n === 1 ? 'queda 1 actividad' : `quedan ${n} actividades`} por probar`;
    case 'aniversario': return n === 1 ? 'Te queda 1 día' : `Te quedan ${n} días`;
    default: return `Te ${n === 1 ? 'queda 1 clase' : `quedan ${n} clases`}`;
  }
}

/**
 * Estado de todas las medallas.
 * @param cupoSemanal clases por semana de la tarifa (para "Semana completa"); 2 si no tiene tarifa semanal.
 */
export function calcularMedallas(clases: ClaseHecha[], opts: { cupoSemanal: number; hoy: ISODate }): EstadoMedalla[] {
  const ordenadas = [...clases].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  const total = ordenadas.length;
  const enLaN = (n: number): ISODate | null => (total >= n ? ordenadas[n - 1].fecha : null);
  const cupo = Math.max(1, opts.cupoSemanal);

  // Semana completa: primera semana con al menos `cupo` clases.
  const porSemana = new Map<ISODate, ClaseHecha[]>();
  for (const c of ordenadas) {
    const s = inicioSemana(c.fecha);
    porSemana.set(s, [...(porSemana.get(s) ?? []), c]);
  }
  let semanaCompletaEl: ISODate | null = null;
  let maxEnSemana = 0;
  for (const [, lista] of [...porSemana.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    maxEnSemana = Math.max(maxEnSemana, lista.length);
    if (!semanaCompletaEl && lista.length >= cupo) semanaCompletaEl = lista[cupo - 1].fecha;
  }

  // Rachas: fecha en la que se alcanzó por primera vez.
  const semanas = semanasConClase(ordenadas);
  let racha = 0;
  let mejor = 0;
  let anterior: ISODate | null = null;
  let racha4El: ISODate | null = null;
  let racha12El: ISODate | null = null;
  for (const s of semanas) {
    racha = anterior && sumarDias(anterior, 7) === s ? racha + 1 : 1;
    mejor = Math.max(mejor, racha);
    if (!racha4El && racha >= 4) racha4El = ordenadas.find((c) => inicioSemana(c.fecha) === s)!.fecha;
    if (!racha12El && racha >= 12) racha12El = ordenadas.find((c) => inicioSemana(c.fecha) === s)!.fecha;
    anterior = s;
  }

  const mananas = ordenadas.filter((c) => c.hora < '10:00');
  const actividades: Id[] = [];
  let explorador: ISODate | null = null;
  for (const c of ordenadas) {
    if (!actividades.includes(c.actividadId)) {
      actividades.push(c.actividadId);
      if (actividades.length === 3) explorador = c.fecha;
    }
  }
  const primera = ordenadas[0]?.fecha ?? null;
  const aniversarioEl = primera ? sumarDias(primera, 365) : null;
  const diasDesdePrimera = primera ? Math.round((Date.parse(opts.hoy) - Date.parse(primera)) / 86400000) : 0;

  const estado = (id: IdMedalla, actual: number, objetivo: number, conseguidaEl: ISODate | null): EstadoMedalla => ({
    medalla: MEDALLAS.find((m) => m.id === id)!, conseguida: conseguidaEl != null, actual: Math.min(actual, objetivo), objetivo, conseguidaEl,
  });
  return [
    estado('primera', total, 1, enLaN(1)),
    estado('c10', total, 10, enLaN(10)),
    estado('c25', total, 25, enLaN(25)),
    estado('c50', total, 50, enLaN(50)),
    estado('c100', total, 100, enLaN(100)),
    estado('c200', total, 200, enLaN(200)),
    estado('semana-completa', maxEnSemana, cupo, semanaCompletaEl),
    estado('racha4', mejor, 4, racha4El),
    estado('racha12', mejor, 12, racha12El),
    estado('madrugador', mananas.length, 10, mananas.length >= 10 ? mananas[9].fecha : null),
    estado('explorador', actividades.length, 3, explorador),
    estado('aniversario', primera ? Math.min(diasDesdePrimera, 365) : 0, 365, aniversarioEl && aniversarioEl <= opts.hoy ? aniversarioEl : null),
  ];
}

/** Cifras redondas que se celebran al pasar lista ("Hoy es la clase 100 de Carmen"). */
export const HITOS_CLASES = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

// ---------------------------------------------------------------------------
// Cumpleaños
// ---------------------------------------------------------------------------

/** ¿Es hoy su cumpleaños? Los nacidos el 29 de febrero lo celebran el 28 en años no bisiestos. */
export function esCumpleanos(fechaNacimiento: ISODate | null | undefined, hoy: ISODate): boolean {
  if (!fechaNacimiento) return false;
  const [, mN, dN] = fechaNacimiento.split('-');
  const [a, m, d] = hoy.split('-');
  if (mN === m && dN === d) return true;
  const bisiesto = (Number(a) % 4 === 0 && Number(a) % 100 !== 0) || Number(a) % 400 === 0;
  return mN === '02' && dN === '29' && !bisiesto && m === '02' && d === '28';
}

export const MENSAJE_CUMPLEANOS_POR_DEFECTO = 'Todo el equipo de Nuevo Palmar te desea un año lleno de salud y bienestar. ¡Que lo celebres a lo grande!';

// ---------------------------------------------------------------------------
// "Tu año en Pilates"
// ---------------------------------------------------------------------------

export interface ResumenAnual {
  anio: number;
  total: number;
  horas: number;
  actividadFavoritaId: Id | null;
  vecesActividadFavorita: number;
  actividadesDistintas: number;
  /** Hora más repetida ("09:30") y si es de mañanas o de tardes. */
  horaFavorita: HoraHHmm | null;
  deMananas: boolean;
  mejorRacha: number;
  monitorFavoritoId: Id | null;
  vecesMonitorFavorito: number;
  /** Mes con más clases (1-12). */
  mesTop: number | null;
  clasesMesTop: number;
}

function masRepetido<T>(valores: T[]): { valor: T | null; veces: number } {
  const n = new Map<T, number>();
  for (const v of valores) n.set(v, (n.get(v) ?? 0) + 1);
  let valor: T | null = null;
  let veces = 0;
  for (const [k, c] of n) if (c > veces) { valor = k; veces = c; }
  return { valor, veces };
}

export function resumenAnual(clases: ClaseHecha[], anio: number): ResumenAnual {
  const delAnio = clases.filter((c) => c.fecha.startsWith(`${anio}-`));
  const act = masRepetido(delAnio.map((c) => c.actividadId));
  const hora = masRepetido(delAnio.map((c) => c.hora));
  const mon = masRepetido(delAnio.map((c) => c.monitorId).filter((x): x is Id => !!x));
  const mes = masRepetido(delAnio.map((c) => Number(c.fecha.slice(5, 7))));
  const mananas = delAnio.filter((c) => c.hora < '14:00').length;
  return {
    anio,
    total: delAnio.length,
    horas: Math.round(delAnio.reduce((s, c) => s + c.duracionMin, 0) / 60),
    actividadFavoritaId: act.valor, vecesActividadFavorita: act.veces,
    actividadesDistintas: new Set(delAnio.map((c) => c.actividadId)).size,
    horaFavorita: hora.valor, deMananas: mananas * 2 >= delAnio.length,
    mejorRacha: mejorRacha(delAnio),
    monitorFavoritoId: mon.valor, vecesMonitorFavorito: mon.veces,
    mesTop: mes.valor, clasesMesTop: mes.veces,
  };
}

/** Mínimo de clases en el año para ver "Tu año en Pilates". */
export const MINIMO_CLASES_RESUMEN = 5;

/**
 * ¿Toca enseñar "Tu año en Pilates"? Ventana por defecto del 15/12 al 15/01 (MM-DD).
 * Devuelve el año del resumen (en enero, el del año anterior) o null si no toca.
 */
export function anioResumenVisible(hoy: ISODate, opts: { activo?: boolean; desde?: string; hasta?: string }): number | null {
  if (opts.activo === false) return null;
  const desde = /^\d{2}-\d{2}$/.test(opts.desde ?? '') ? opts.desde! : '12-15';
  const hasta = /^\d{2}-\d{2}$/.test(opts.hasta ?? '') ? opts.hasta! : '01-15';
  const anio = Number(hoy.slice(0, 4));
  const md = hoy.slice(5);
  if (desde <= hasta) return md >= desde && md <= hasta ? anio : null;
  // La ventana cruza el fin de año (lo normal: diciembre → enero).
  if (md >= desde) return anio;
  if (md <= hasta) return anio - 1;
  return null;
}

export const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
