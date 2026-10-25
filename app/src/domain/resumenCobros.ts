/**
 * Pantalla Cobros (solo quien ve las finanzas): quién ha pagado, quién falta, quién no tiene cobro
 * apuntado y quién lo tiene repetido, en un mes. Lógica pura. El mes de un cobro es el de su fecha de
 * cobro (vence), o el de su pago, o el de su creación, igual que la consulta de duplicados.
 */
import type { Cliente, Contrato, ISODate, MetodoPago, Pago, Tarifa } from './types';
import { pagoVencido } from './cobros';

export interface ResumenCobrosMes {
  pagados: Pago[];
  /** Pendientes del mes: primero los ya vencidos. */
  pendientes: (Pago & { vencido: boolean })[];
  /** Alumnos con contrato mensual en ese mes y ningún cobro (ni pagado ni pendiente). */
  sinCobro: { cliente: Cliente; contrato: Contrato }[];
  /** Alumnos con más de un cobro ese mes. */
  duplicados: { cliente: Cliente; pagos: Pago[] }[];
  totales: { cobrado: number; pendiente: number; vencido: number; porMetodo: { metodo: MetodoPago | null; total: number; n: number }[] };
}

/** Mes (AAAA-MM) al que pertenece un cobro. */
export function mesDeCobro(p: Pick<Pago, 'venceEl' | 'pagadoEl' | 'creadoEl'>): string {
  return (p.venceEl ?? p.pagadoEl ?? p.creadoEl ?? '').slice(0, 7);
}

function finMes(mes: ISODate): ISODate {
  const [a, m] = mes.split('-').map(Number);
  return `${mes.slice(0, 7)}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

export function resumenCobrosMes(
  db: { pagos: Pago[]; clientes: Cliente[]; contratos: Contrato[]; tarifas: Tarifa[] },
  mes: ISODate,
  hoy: ISODate,
): ResumenCobrosMes {
  const clave = mes.slice(0, 7);
  const fin = finMes(mes);
  const delMes = db.pagos.filter((p) => p.estado !== 'CANCELADO' && mesDeCobro(p) === clave);
  const clienteDe = new Map(db.clientes.map((c) => [c.id, c]));
  const nombre = (id: string) => { const c = clienteDe.get(id); return c ? `${c.apellidos} ${c.nombre}` : ''; };
  const porNombre = <T extends { clienteId: string }>(a: T, b: T) => nombre(a.clienteId).localeCompare(nombre(b.clienteId), 'es');

  const pagados = delMes.filter((p) => p.estado === 'PAGADO').sort((a, b) => (a.pagadoEl ?? '').localeCompare(b.pagadoEl ?? '') || porNombre(a, b));
  const pendientes = delMes.filter((p) => p.estado === 'PENDIENTE')
    .map((p) => ({ ...p, vencido: pagoVencido(p, hoy) }))
    .sort((a, b) => Number(b.vencido) - Number(a.vencido) || (a.venceEl ?? '').localeCompare(b.venceEl ?? '') || porNombre(a, b));

  const conCobro = new Set(delMes.map((p) => p.clienteId));
  const mensual = new Set(db.tarifas.filter((t) => t.tipo === 'RECURRENTE').map((t) => t.id));
  const vistos = new Set<string>();
  const sinCobro: ResumenCobrosMes['sinCobro'] = [];
  for (const k of db.contratos) {
    if (k.estado === 'CANCELADO' || !mensual.has(k.tarifaId) || k.fechaInicio > fin || k.fechaFin < mes) continue;
    if (conCobro.has(k.clienteId) || vistos.has(k.clienteId)) continue;
    const cliente = clienteDe.get(k.clienteId);
    if (!cliente) continue;
    vistos.add(k.clienteId);
    sinCobro.push({ cliente, contrato: k });
  }
  sinCobro.sort((a, b) => nombre(a.cliente.id).localeCompare(nombre(b.cliente.id), 'es'));

  const porCliente = new Map<string, Pago[]>();
  for (const p of delMes) porCliente.set(p.clienteId, [...(porCliente.get(p.clienteId) ?? []), p]);
  const duplicados = [...porCliente.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([id, ps]) => ({ cliente: clienteDe.get(id)!, pagos: ps.sort((a, b) => (a.venceEl ?? a.pagadoEl ?? '').localeCompare(b.venceEl ?? b.pagadoEl ?? '')) }))
    .filter((d) => !!d.cliente)
    .sort((a, b) => nombre(a.cliente.id).localeCompare(nombre(b.cliente.id), 'es'));

  const metodos = new Map<MetodoPago | null, { total: number; n: number }>();
  for (const p of pagados) { const m = metodos.get(p.metodo) ?? { total: 0, n: 0 }; metodos.set(p.metodo, { total: m.total + p.importeCentimos, n: m.n + 1 }); }
  const suma = (ps: Pago[]) => ps.reduce((s, p) => s + p.importeCentimos, 0);
  return {
    pagados, pendientes, sinCobro, duplicados,
    totales: {
      cobrado: suma(pagados), pendiente: suma(pendientes), vencido: suma(pendientes.filter((p) => p.vencido)),
      porMetodo: [...metodos.entries()].map(([metodo, v]) => ({ metodo, ...v })).sort((a, b) => b.total - a.total),
    },
  };
}
