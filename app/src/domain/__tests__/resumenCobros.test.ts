import { describe, expect, it } from 'vitest';
import type { Cliente, Contrato, Pago, Tarifa } from '../types';
import { mesDeCobro, resumenCobrosMes } from '../resumenCobros';

const cliente = (id: string, activo = true) => ({ id, nombre: id, apellidos: 'X', activo } as Cliente);
const tarifas = [{ id: 'mensual', tipo: 'RECURRENTE' }, { id: 'bono', tipo: 'BONO' }] as Tarifa[];
const contrato = (clienteId: string, tarifaId = 'mensual', fechaInicio = '2026-10-01', fechaFin = '2026-10-31', estado: Contrato['estado'] = 'ACTIVO') =>
  ({ id: `k-${clienteId}`, clienteId, tarifaId, fechaInicio, fechaFin, estado, importeCentimos: 5200 } as Contrato);
let n = 0;
const pago = (clienteId: string, o: Partial<Pago>): Pago => ({ id: `p${++n}`, contratoId: null, clienteId, concepto: 'Octubre', importeCentimos: 5200, venceEl: '2026-10-01', estado: 'PENDIENTE', metodo: null, pagadoEl: null, creadoEl: '2026-10-01T10:00:00Z', ...o });

describe('resumen de cobros del mes', () => {
  const db = {
    tarifas,
    clientes: [cliente('ana'), cliente('beto'), cliente('carla'), cliente('dani'), cliente('eva'), cliente('fede')],
    contratos: [contrato('ana'), contrato('beto'), contrato('carla'), contrato('dani'), contrato('eva', 'bono'), contrato('fede', 'mensual', '2026-11-01', '2026-11-30')],
    pagos: [
      pago('ana', { estado: 'PAGADO', metodo: 'TARJETA', pagadoEl: '2026-10-02T09:00:00Z' }),
      pago('ana', { estado: 'PAGADO', metodo: 'TARJETA', pagadoEl: '2026-10-07T09:00:00Z', venceEl: '2026-10-07', concepto: 'Mes 1 · octubre 2026' }),
      pago('beto', { venceEl: '2026-10-05' }),
      pago('carla', { venceEl: '2026-10-30' }),
      pago('carla', { venceEl: '2026-09-01', estado: 'PAGADO', metodo: 'BIZUM', pagadoEl: '2026-09-01T09:00:00Z' }),
      pago('dani', { estado: 'CANCELADO' }),
    ],
  };
  const r = resumenCobrosMes(db, '2026-10-01', '2026-10-25');

  it('han pagado, pendientes (vencidos primero) y totales', () => {
    expect(r.pagados.map((p) => p.clienteId)).toEqual(['ana', 'ana']);
    expect(r.pendientes.map((p) => [p.clienteId, p.vencido])).toEqual([['beto', true], ['carla', false]]);
    expect(r.totales).toMatchObject({ cobrado: 10400, pendiente: 10400, vencido: 5200 });
    expect(r.totales.porMetodo).toEqual([{ metodo: 'TARJETA', total: 10400, n: 2 }]);
  });
  it('sin cobro: tarifa mensual en el mes y ningún cobro (los cancelados no cuentan; los bonos y los de otro mes no salen)', () => {
    expect(r.sinCobro.map((s) => s.cliente.id)).toEqual(['dani']);
  });
  it('repetidos: más de un cobro el mismo mes', () => {
    expect(r.duplicados.map((d) => [d.cliente.id, d.pagos.length])).toEqual([['ana', 2]]);
  });
  it('el mes de un cobro: su fecha de cobro, si no la de pago, si no la de creación', () => {
    expect(mesDeCobro({ venceEl: '2026-11-07', pagadoEl: '2026-10-30T10:00:00Z', creadoEl: '2026-10-01T00:00:00Z' })).toBe('2026-11');
    expect(mesDeCobro({ venceEl: null, pagadoEl: '2026-10-30T10:00:00Z', creadoEl: '2026-09-01T00:00:00Z' })).toBe('2026-10');
    expect(mesDeCobro({ venceEl: null, pagadoEl: null, creadoEl: '2026-09-01T00:00:00Z' })).toBe('2026-09');
  });
});
