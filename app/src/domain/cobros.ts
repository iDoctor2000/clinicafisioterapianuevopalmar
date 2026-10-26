/**
 * Cobros de los contratos: plan de cuotas al contratar, importes de la oferta trimestral
 * y avisos de pago pendiente. Lógica pura (sin estado), compartida por demo y Supabase.
 */
import type { ISODate, Oferta, Pago, Tarifa } from './types';
import { sumarMeses } from './fechas';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Una cuota propuesta antes de crear el contrato (editable en el formulario). */
export interface CuotaPlan {
  concepto: string;
  importeCentimos: number;
  venceEl: ISODate;
  /** Mes al que corresponde (día 1). */
  mes: ISODate;
}

/** Primer día del mes de una fecha. */
export function mesDe(fecha: ISODate): ISODate {
  return `${fecha.slice(0, 7)}-01`;
}

/** "Noviembre 2026". */
export function nombreMesAnio(mes: ISODate): string {
  const [a, m] = mes.split('-').map(Number);
  const n = MESES[m - 1] ?? '';
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${a}`;
}

/** "45 €", "45,50 €". */
export function euros(centimos: number | null | undefined): string {
  if (centimos == null) return '—';
  const e = centimos / 100;
  return `${e.toLocaleString('es-ES', { minimumFractionDigits: Number.isInteger(e) ? 0 : 2, maximumFractionDigits: 2 })} €`;
}

/** "45", "45,5", "45.50 €" → céntimos. Vacío o no numérico → null. */
export function aCentimos(texto: string): number | null {
  const limpio = texto.replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
  if (limpio === '') return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Céntimos → texto para un campo de formulario ("45" o "45,50"). */
export function aTextoEuros(centimos: number | null | undefined): string {
  if (centimos == null) return '';
  const e = centimos / 100;
  return Number.isInteger(e) ? String(e) : e.toFixed(2).replace('.', ',');
}

/**
 * Importes de la oferta trimestral leídos de la descripción de la tarifa, p. ej.
 * "Oferta trimestral: 45 € (mes 1), 45 € (mes 2), 0 € (mes 3)" → [4500, 4500, 0].
 * También entiende "90 € + 90 € + mes 3 gratis". null si la descripción no la indica.
 */
export function importesOfertaTrimestral(descripcion: string): number[] | null {
  const m = /oferta trimestral\s*:?\s*(.*?)(?:\.\s|\.$|$)/i.exec(descripcion);
  if (!m) return null;
  const tramo = m[1];
  const importes = Array.from(tramo.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*€/g)).map((x) => aCentimos(x[1]) ?? 0);
  if (/gratis/i.test(tramo) && importes.length < 3) importes.push(0);
  return importes.length >= 2 ? importes : null;
}

/** Importe mensual que se propone al contratar: el del primer mes de la oferta o el precio de la tarifa. */
export function importeSugerido(tarifa: Pick<Tarifa, 'precioCentimos' | 'descripcion'>, oferta: Oferta): number | null {
  if (oferta === 'TRIMESTRAL') {
    const t = importesOfertaTrimestral(tarifa.descripcion);
    if (t) return t[0];
  }
  return tarifa.precioCentimos ?? null;
}

/** Meses de cobro de un periodo: uno por cada mes que empieza antes del fin (mínimo 1, máximo 24). */
export function mesesDelPeriodo(inicio: ISODate, fin: ISODate): number {
  let n = 0;
  while (n < 24 && sumarMeses(inicio, n) < fin) n++;
  return Math.max(1, n);
}

/**
 * Mes natural al que corresponde el periodo de un mes de contrato que empieza en `inicio`: el mes en el
 * que cae la mitad del periodo. Así un contrato que empieza el 26 de octubre paga "Noviembre", y uno que
 * empieza el 6 de octubre paga "Octubre".
 */
export function mesDelPeriodo(inicio: ISODate, fin: ISODate): ISODate {
  const finPeriodo = sumarMeses(inicio, 1) < fin ? sumarMeses(inicio, 1) : fin;
  const a = new Date(`${inicio}T00:00:00Z`).getTime();
  const b = new Date(`${finPeriodo}T00:00:00Z`).getTime();
  const mitad = new Date(a + (b - a) / 2);
  return `${mitad.getUTCFullYear()}-${String(mitad.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Plan de cobros propuesto al crear un contrato.
 *  - Mensual: una cuota por cada mes de contrato, a nombre del mes natural que cubre (26 oct → "Noviembre");
 *    si dos periodos caen en el mismo mes natural (contrato de un mes y pocos días), se deja uno.
 *    Con la oferta trimestral, los importes de la oferta: 45 / 45 / 0…
 *  - Bono o clase suelta: un único cobro el día de inicio.
 * `importeCentimos` es el importe acordado (por mes o total); si es null se usa el de la tarifa.
 */
export function planDeCobros(args: {
  tarifa: Pick<Tarifa, 'tipo' | 'nombre' | 'precioCentimos' | 'descripcion'>;
  inicio: ISODate;
  fin: ISODate;
  oferta: Oferta;
  importeCentimos: number | null;
}): CuotaPlan[] {
  const { tarifa, inicio, fin, oferta } = args;
  const base = args.importeCentimos ?? tarifa.precioCentimos ?? 0;
  if (tarifa.tipo !== 'RECURRENTE') return [{ concepto: tarifa.nombre, importeCentimos: base, venceEl: inicio, mes: mesDe(inicio) }];
  const trimestral = oferta === 'TRIMESTRAL' ? importesOfertaTrimestral(tarifa.descripcion) : null;
  // Con la oferta trimestral, si el importe acordado se ha cambiado a mano, manda el importe acordado.
  const usarOferta = trimestral && (args.importeCentimos == null || args.importeCentimos === trimestral[0]);
  const cuotas: CuotaPlan[] = [];
  for (let k = 0; k < mesesDelPeriodo(inicio, fin); k++) {
    const venceEl = sumarMeses(inicio, k);
    const mes = mesDelPeriodo(venceEl, fin);
    if (cuotas.some((q) => q.mes === mes)) continue;
    cuotas.push({ concepto: nombreMesAnio(mes), importeCentimos: usarOferta ? trimestral[cuotas.length % trimestral.length] : base, venceEl, mes });
  }
  return cuotas;
}

/** Cuota sin cobrar cuya fecha ya ha llegado. */
export function pagoVencido(p: Pick<Pago, 'estado' | 'venceEl'>, hoy: ISODate): boolean {
  return p.estado === 'PENDIENTE' && p.venceEl != null && p.venceEl <= hoy;
}

/** Cobros vencidos sin cobrar de un cliente (para el aviso "Pago pendiente"). */
export function pagosVencidos(pagos: Pago[], clienteId: string, hoy: ISODate): Pago[] {
  return pagos.filter((p) => p.clienteId === clienteId && pagoVencido(p, hoy));
}
