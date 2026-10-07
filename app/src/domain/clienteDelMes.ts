/**
 * Premio "Cliente del mes" y "Reto del mes". Lógica pura.
 *
 * Reto del mes: hacer las clases de tu tarifa durante el mes (clases por semana × 4).
 * Cliente del mes: la app propone a los más CONSTANTES del mes anterior, por este orden:
 *   1. Han cumplido el reto.
 *   2. Más semanas distintas con clase (no vale concentrarlo todo en una semana).
 *   3. Más clases respecto a lo que les toca por tarifa.
 *   4. Más clases y, si siguen empatados, más minutos.
 * Quien ganó en los 3 meses anteriores va al final, para que el premio vaya rotando.
 * La última palabra es siempre del administrador.
 */
import type { Id, ISODate, PremioMes } from './types';
import { NOMBRE_MES, type ClaseHecha } from './logros';

/** Semanas que cuenta el reto. */
export const SEMANAS_RETO = 4;
/** Meses en los que quien ha ganado no vuelve a salir arriba. */
export const MESES_SIN_REPETIR = 3;

/** Primer día del mes de una fecha (AAAA-MM-01). */
export function inicioMes(fecha: ISODate): ISODate {
  return `${fecha.slice(0, 7)}-01`;
}

/** Primer día del mes anterior. */
export function mesAnterior(fecha: ISODate): ISODate {
  const a = Number(fecha.slice(0, 4));
  const m = Number(fecha.slice(5, 7));
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
}

/** Último día del mes. */
export function finMes(mes: ISODate): ISODate {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(dias).padStart(2, '0')}`;
}

/** "septiembre" / "septiembre de 2026". */
export function nombreMes(mes: ISODate, conAnio = false): string {
  const n = NOMBRE_MES[Number(mes.slice(5, 7)) - 1] ?? '';
  return conAnio ? `${n} de ${mes.slice(0, 4)}` : n;
}

/** Clases del reto del mes según las clases por semana de la tarifa. */
export function objetivoReto(cupoSemanal: number): number {
  return Math.max(1, Math.round(cupoSemanal)) * SEMANAS_RETO;
}

export interface RetoMes {
  mes: ISODate;
  hechas: number;
  objetivo: number;
  cumplido: boolean;
}

/** Progreso del reto del mes en curso a partir de las clases hechas del alumno. */
export function retoDelMes(clases: ClaseHecha[], hoy: ISODate, cupoSemanal: number): RetoMes {
  const mes = inicioMes(hoy);
  const hechas = clases.filter((c) => c.fecha.startsWith(mes.slice(0, 8))).length;
  const objetivo = objetivoReto(cupoSemanal);
  return { mes, hechas, objetivo, cumplido: hechas >= objetivo };
}

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

/** Lo que hizo cada alumno en el mes (actividad_del_mes en SQL). */
export interface ActividadMes {
  clienteId: Id;
  clases: number;
  minutos: number;
  /** Semanas distintas con al menos una clase. */
  semanas: number;
}

export interface Candidato extends ActividadMes {
  objetivo: number;
  retoCumplido: boolean;
  /** Mes en el que ganó hace poco (va al final de la lista), o null. */
  ganoEn: ISODate | null;
}

export function ordenarCandidatos(
  actividad: ActividadMes[],
  opts: { mes: ISODate; cupoDe: (clienteId: Id) => number; premios: PremioMes[] },
): Candidato[] {
  // Meses "recientes": los MESES_SIN_REPETIR anteriores al premiado.
  const recientes = new Set<ISODate>();
  let m = opts.mes;
  for (let i = 0; i < MESES_SIN_REPETIR; i++) { m = mesAnterior(m); recientes.add(m); }
  const ganoEn = new Map<Id, ISODate>();
  for (const p of opts.premios) if (recientes.has(p.mes) && !ganoEn.has(p.clienteId)) ganoEn.set(p.clienteId, p.mes);

  const lista: Candidato[] = actividad.filter((a) => a.clases > 0).map((a) => {
    const objetivo = objetivoReto(opts.cupoDe(a.clienteId));
    return { ...a, objetivo, retoCumplido: a.clases >= objetivo, ganoEn: ganoEn.get(a.clienteId) ?? null };
  });
  return lista.sort((a, b) =>
    Number(!!a.ganoEn) - Number(!!b.ganoEn)
    || Number(b.retoCumplido) - Number(a.retoCumplido)
    || b.semanas - a.semanas
    || b.clases / b.objetivo - a.clases / a.objetivo
    || b.clases - a.clases
    || b.minutos - a.minutos);
}

/** "12 clases en 4 semanas · reto cumplido". */
export function motivoCandidato(c: Candidato): string {
  const partes = [`${c.clases} ${c.clases === 1 ? 'clase' : 'clases'} en ${c.semanas} ${c.semanas === 1 ? 'semana' : 'semanas'}`];
  partes.push(c.retoCumplido ? 'reto cumplido' : `reto: ${c.clases} de ${c.objetivo}`);
  return partes.join(' · ');
}

// ---------------------------------------------------------------------------
// Premio en curso y textos
// ---------------------------------------------------------------------------

/** El premio que se muestra este mes: el del mes anterior. */
export function premioVigente(premios: PremioMes[], hoy: ISODate): PremioMes | null {
  const mes = mesAnterior(hoy);
  return premios.find((p) => p.mes === mes) ?? null;
}

/** Aviso que recibe el ganador (con notificación en el móvil). */
export function avisoGanador(nombre: string, mes: ISODate, clases: number): { titulo: string; cuerpo: string } {
  return {
    titulo: `🏆 ¡Premio al cliente del mes de ${nombreMes(mes)}!`,
    cuerpo: `¡Enhorabuena, ${nombre}! Por tu constancia en ${nombreMes(mes)} (${clases} ${clases === 1 ? 'clase' : 'clases'}), el premio al cliente del mes es para ti. Todo el equipo de Nuevo Palmar te da las gracias. Abre la app para verlo 🎉`,
  };
}
