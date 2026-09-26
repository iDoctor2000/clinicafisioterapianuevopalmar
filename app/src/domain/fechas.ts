import {
  addDays,
  addMonths,
  differenceInMinutes,
  eachDayOfInterval,
  format,
  getISODay,
  isAfter,
  isBefore,
  parse,
  parseISO,
  startOfISOWeek,
  endOfISOWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { ConfigCentro, DiaSemana, HoraHHmm, ISODate } from './types';

/** Convierte fecha + hora locales a un Date (hora local del dispositivo). */
export function aFechaHora(fecha: ISODate, hora: HoraHHmm): Date {
  return parse(`${fecha} ${hora}`, 'yyyy-MM-dd HH:mm', new Date());
}

export function aISODate(d: Date): ISODate {
  return format(d, 'yyyy-MM-dd');
}

export function hoyISO(ahora: Date = new Date()): ISODate {
  return aISODate(ahora);
}

export function diaSemanaDe(fecha: ISODate): DiaSemana {
  return getISODay(parseISO(fecha)) as DiaSemana;
}

export function minutosHasta(fecha: ISODate, hora: HoraHHmm, ahora: Date): number {
  return differenceInMinutes(aFechaHora(fecha, hora), ahora);
}

export function esDiaCierre(fecha: ISODate, config: Pick<ConfigCentro, 'diasCierre'>): boolean {
  return config.diasCierre.some((d) => d.fecha === fecha);
}

export function diasEntre(desde: ISODate, hasta: ISODate): ISODate[] {
  if (isAfter(parseISO(desde), parseISO(hasta))) return [];
  return eachDayOfInterval({ start: parseISO(desde), end: parseISO(hasta) }).map(aISODate);
}

export function sumarDias(fecha: ISODate, dias: number): ISODate {
  return aISODate(addDays(parseISO(fecha), dias));
}

export function sumarMeses(fecha: ISODate, meses: number): ISODate {
  return aISODate(addMonths(parseISO(fecha), meses));
}

/** Lunes de la semana ISO a la que pertenece la fecha. */
export function inicioSemana(fecha: ISODate): ISODate {
  return aISODate(startOfISOWeek(parseISO(fecha)));
}

export function finSemana(fecha: ISODate): ISODate {
  return aISODate(endOfISOWeek(parseISO(fecha)));
}

export function mismaSemana(a: ISODate, b: ISODate): boolean {
  return inicioSemana(a) === inicioSemana(b);
}

export function estaEntre(fecha: ISODate, desde: ISODate, hasta: ISODate): boolean {
  return fecha >= desde && fecha <= hasta;
}

export function esPasada(fecha: ISODate, hora: HoraHHmm, ahora: Date): boolean {
  return isBefore(aFechaHora(fecha, hora), ahora);
}

export const DIAS_SEMANA_LABEL: Record<DiaSemana, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

export const DIAS_SEMANA_CORTO: Record<DiaSemana, string> = {
  1: 'L',
  2: 'M',
  3: 'X',
  4: 'J',
  5: 'V',
  6: 'S',
  7: 'D',
};

/** "jueves 18 de septiembre" */
export function fechaLarga(fecha: ISODate): string {
  return format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es });
}

/** "jue 18 sep" */
export function fechaCorta(fecha: ISODate): string {
  return format(parseISO(fecha), 'EEE d MMM', { locale: es });
}

export function mesLargo(fecha: ISODate): string {
  return format(parseISO(fecha), 'MMMM yyyy', { locale: es });
}

export function horaFin(hora: HoraHHmm, duracionMin: number): HoraHHmm {
  const [h, m] = hora.split(':').map(Number);
  const total = h * 60 + m + duracionMin;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
