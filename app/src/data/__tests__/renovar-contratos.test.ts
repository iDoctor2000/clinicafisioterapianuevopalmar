/** Renovar de golpe (0028): alarga el mismo contrato, apunta a sus clases fijas y crea el cobro del mes nuevo. */
import { describe, expect, it } from 'vitest';
import type { Contrato, Sesion } from '@/domain/types';
import { cobrosDeRenovacion, contratosParaRenovar, finDelMesSiguiente } from '@/domain/renovaciones';
import { aISODate, sumarDias } from '@/domain/fechas';
import { crearSeed } from '@/data/seed';
import { renovarContratos, type Ctx } from '@/data/comandos';
import type { Db } from '@/data/db';

const ahora = new Date();
const hoy = aISODate(ahora);
const db0 = crearSeed();
const sesionDe = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, veFinanzas: t.veFinanzas === true };
};
const ctx = (sesion: Sesion, db: Db): Ctx => ({ db, sesion, ahora });

/** El contrato fijo de Juan, terminando en 5 días y sin cobros (para la prueba). */
function preparar(): { db: Db; contrato: Contrato } {
  const actual = db0.contratos.find((c) => c.clienteId === 'juan' && c.estado === 'ACTIVO')!;
  const contrato: Contrato = { ...actual, fechaFin: sumarDias(hoy, 5), importeCentimos: 5000, metodoPago: 'TARJETA' };
  const db: Db = { ...db0, contratos: db0.contratos.map((c) => (c.id === contrato.id ? contrato : c)), pagos: db0.pagos.filter((p) => p.clienteId !== 'juan') };
  return { db, contrato };
}

describe('renovaciones', () => {
  it('finDelMesSiguiente: de cualquier día del mes al último del siguiente, también en diciembre', () => {
    expect(finDelMesSiguiente('2026-10-25')).toBe('2026-11-30');
    expect(finDelMesSiguiente('2026-12-03')).toBe('2027-01-31');
    expect(finDelMesSiguiente('2027-01-31')).toBe('2027-02-28');
  });

  it('salen los contratos mensuales activos que terminan pronto y antes de la fecha', () => {
    const { db, contrato } = preparar();
    const lista = contratosParaRenovar(db, hoy, finDelMesSiguiente(hoy));
    expect(lista.map((c) => c.id)).toContain(contrato.id);
    expect(lista.every((c) => c.estado === 'ACTIVO' && db.tarifas.find((t) => t.id === c.tarifaId)?.tipo === 'RECURRENTE')).toBe(true);
    expect(contratosParaRenovar(db, hoy, sumarDias(hoy, 3)).map((c) => c.id)).not.toContain(contrato.id); // ya llega más allá
  });

  it('cobros: uno por mes nuevo con el importe del contrato; ninguno si ya hay cobro ese mes o no hay importe', () => {
    const c = { fechaFin: '2026-10-31', importeCentimos: 5200, clienteId: 'x' } as Contrato;
    expect(cobrosDeRenovacion(c, '2026-11-30', [])).toEqual([{ concepto: 'Noviembre 2026', importeCentimos: 5200, venceEl: '2026-11-01', mes: '2026-11-01' }]);
    expect(cobrosDeRenovacion(c, '2027-01-31', []).map((q) => q.mes)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(cobrosDeRenovacion(c, '2026-11-30', [{ clienteId: 'x', estado: 'PENDIENTE', mes: '2026-11-01' }])).toEqual([]);
    expect(cobrosDeRenovacion(c, '2026-11-30', [{ clienteId: 'x', estado: 'CANCELADO', mes: '2026-11-01' }])).toHaveLength(1);
    expect(cobrosDeRenovacion({ ...c, importeCentimos: null }, '2026-11-30', [])).toEqual([]);
  });

  it('renovarContratos alarga el mismo contrato, conserva sus clases fijas, crea el cobro y no repite', () => {
    const { db, contrato } = preparar();
    const hasta = sumarDias(hoy, 40);
    const r = renovarContratos(ctx(sesionDe(db, 'tra-jose'), db), { contratoIds: [contrato.id], hasta });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({ renovados: 1, saltados: 0 });
    const despues = r.db.contratos.find((c) => c.id === contrato.id)!;
    expect(despues).toMatchObject({ estado: 'ACTIVO', fechaFin: hasta, franjasFijas: contrato.franjasFijas });
    const fechas = r.db.reservas.filter((x) => x.contratoId === contrato.id && x.estado === 'RESERVADA').map((x) => r.db.clases.find((c) => c.id === x.claseId)!.fecha);
    if (r.db.clases.some((c) => c.fecha > contrato.fechaFin && c.fecha <= hasta && contrato.franjasFijas.some((f) => f.plantillaId === c.plantillaId))) {
      expect(fechas.some((f) => f > contrato.fechaFin)).toBe(true);
    }
    expect(r.db.pagos.filter((p) => p.contratoId === contrato.id && p.mes > contrato.fechaFin)).toHaveLength(r.valor.cobros);
    expect(r.valor.cobros).toBeGreaterThan(0);
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'RENOVAR_CONTRATO', entidadId: contrato.id });
    // Otra vez: ya llega a esa fecha, se salta.
    const r2 = renovarContratos(ctx(sesionDe(r.db, 'tra-jose'), r.db), { contratoIds: [contrato.id], hasta });
    expect(r2.ok && r2.valor).toMatchObject({ renovados: 0, saltados: 1, cobros: 0 });
  });

  it('sin permiso de editar fichas no se puede, y la fecha tiene que ser futura', () => {
    const { db, contrato } = preparar();
    expect(renovarContratos(ctx(sesionDe(db, 'tra-ana'), db), { contratoIds: [contrato.id], hasta: sumarDias(hoy, 40) }).ok).toBe(false);
    expect(renovarContratos(ctx(sesionDe(db, 'tra-jose'), db), { contratoIds: [contrato.id], hasta: hoy }).ok).toBe(false);
  });
});
