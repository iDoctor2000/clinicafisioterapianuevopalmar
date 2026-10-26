/**
 * Renovar de golpe los contratos mensuales que terminan (0028). Renovar = alargar el MISMO
 * contrato hasta la fecha elegida (conserva franjas, reservas, recuperaciones y datos de pago) y
 * crear el cobro de cada mes nuevo con su importe. Lógica pura, compartida por la demo y la pantalla.
 */
import type { Cliente, Contrato, ISODate, Pago, Tarifa } from './types';
import { sumarDias } from './fechas';
import { mesDe, nombreMesAnio } from './cobros';

/** Días antes del fin en que un contrato ya sale para renovar. */
export const DIAS_AVISO_RENOVACION = 14;

/** Último día del mes siguiente al de `fecha` (de cualquier día de octubre → 30 de noviembre). */
export function finDelMesSiguiente(fecha: ISODate): ISODate {
  const [a, m] = fecha.split('-').map(Number);
  const dias = new Date(Date.UTC(a, m + 1, 0)).getUTCDate(); // m (1-12) + 1 → día 0 del mes subsiguiente
  const anio = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dias).padStart(2, '0')}`;
}

/** Contratos que se pueden renovar hasta `hasta`: activos, de tarifa mensual, que terminan en los próximos días y antes de `hasta`. */
export function contratosParaRenovar(db: { contratos: Contrato[]; tarifas: Tarifa[]; clientes: Pick<Cliente, 'id' | 'activo'>[] }, hoy: ISODate, hasta: ISODate, dias = DIAS_AVISO_RENOVACION): Contrato[] {
  const limite = sumarDias(hoy, dias);
  // Los alumnos de baja no se renuevan (0031: al darlos de baja se cierra su contrato).
  const deBaja = new Set(db.clientes.filter((c) => !c.activo).map((c) => c.id));
  return db.contratos.filter((c) => {
    if (c.estado !== 'ACTIVO' || c.fechaFin >= hasta || c.fechaFin > limite || deBaja.has(c.clienteId)) return false;
    return db.tarifas.find((t) => t.id === c.tarifaId)?.tipo === 'RECURRENTE';
  });
}

/** Primer día de cada mes que empieza en [desde, hasta] (incluido `desde` aunque no sea día 1). */
function mesesNuevos(desde: ISODate, hasta: ISODate): ISODate[] {
  const r: ISODate[] = [];
  let d = desde;
  while (d <= hasta) {
    r.push(d);
    const [a, m] = d.split('-').map(Number);
    d = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  }
  return r;
}

/** Cobros que crea la renovación (igual que el servidor): uno por mes nuevo, si hay importe y no hay ya un cobro de ese alumno ese mes. */
export function cobrosDeRenovacion(contrato: Contrato, hasta: ISODate, pagos: Pick<Pago, 'clienteId' | 'estado' | 'mes'>[]): { concepto: string; importeCentimos: number; venceEl: ISODate; mes: ISODate }[] {
  if (contrato.importeCentimos == null) return [];
  return mesesNuevos(sumarDias(contrato.fechaFin, 1), hasta)
    .filter((venceEl) => !pagos.some((p) => p.clienteId === contrato.clienteId && p.estado !== 'CANCELADO' && p.mes === mesDe(venceEl)))
    .map((venceEl) => ({ concepto: nombreMesAnio(mesDe(venceEl)), importeCentimos: contrato.importeCentimos!, venceEl, mes: mesDe(venceEl) }));
}
