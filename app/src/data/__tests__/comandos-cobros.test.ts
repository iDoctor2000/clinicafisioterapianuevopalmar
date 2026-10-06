/** Contratos: plan de cobros al crear, edición posterior y registro de cobros. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { borrarPago, crearContrato, editarContrato, guardarPago, guardarPlantilla, type Ctx } from '@/data/comandos';
import { aISODate } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const sesionDe = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const ctx = (db: Db = crearSeed()): Ctx => ({ db, sesion: sesionDe(db, 'tra-jose'), ahora });

describe('contratos con cobros', () => {
  it('crea el plan de cobros junto con el contrato', () => {
    const c0 = ctx();
    const cliente = c0.db.clientes.find((c) => !c0.db.contratos.some((k) => k.clienteId === c.id && k.estado === 'ACTIVO')) ?? c0.db.clientes[0];
    const r = crearContrato(c0, {
      contrato: { clienteId: cliente.id, tarifaId: 'tar-dir2', fechaInicio: hoy, fechaFin: hoy, modalidad: 'LIBRE', franjasFijas: [], sesionesRestantes: null, actividadesPermitidasIds: [], notas: '', oferta: 'TRIMESTRAL', importeCentimos: 6500, metodoPago: 'BIZUM' },
      cobros: [
        { concepto: 'Mes 1', importeCentimos: 6500, venceEl: hoy, estado: 'PAGADO', metodo: 'BIZUM', pagadoEl: null },
        { concepto: 'Mes 2', importeCentimos: 6500, venceEl: hoy, estado: 'PENDIENTE', metodo: null, pagadoEl: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pagos = r.db.pagos.filter((p) => p.contratoId === r.valor.id);
    expect(pagos).toHaveLength(2);
    expect(pagos[0].pagadoEl).not.toBeNull();
    expect(r.valor.oferta).toBe('TRIMESTRAL');
  });

  it('editar: cambiar la franja rehace las reservas automáticas futuras', () => {
    const c0 = ctx();
    const contrato = c0.db.contratos.find((c) => c.id === 'con-juan')!;
    const quitada = contrato.franjasFijas[0].plantillaId;
    const nueva = c0.db.plantillas.find((p) => p.activa && !contrato.franjasFijas.some((f) => f.plantillaId === p.id)
      && c0.db.actividades.find((a) => a.id === p.actividadId)?.categoria === 'DIRIGIDA')!;
    const franjas = [{ plantillaId: nueva.id }, ...contrato.franjasFijas.slice(1)];
    const r = editarContrato(c0, { contratoId: contrato.id, cambios: { fechaFin: contrato.fechaFin, franjasFijas: franjas, notas: 'cambio', oferta: 'NINGUNA', importeCentimos: 5000, metodoPago: 'EFECTIVO', sesionesRestantes: null } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const futurasDe = (db: Db, plantillaId: string) => db.reservas.filter((x) => x.contratoId === contrato.id && x.estado === 'RESERVADA'
      && db.clases.some((c) => c.id === x.claseId && c.plantillaId === plantillaId && c.fecha >= hoy)).length;
    expect(futurasDe(r.db, quitada)).toBe(0);
    expect(futurasDe(r.db, nueva.id)).toBeGreaterThan(0);
    // Las pasadas no se tocan.
    const pasadas = (db: Db) => db.reservas.filter((x) => x.contratoId === contrato.id && db.clases.some((c) => c.id === x.claseId && c.fecha < hoy)).length;
    expect(pasadas(r.db)).toBe(pasadas(c0.db));
    expect(r.valor.metodoPago).toBe('EFECTIVO');
  });

  it('editar: un horario fijo sin franjas no se acepta', () => {
    const c0 = ctx();
    const contrato = c0.db.contratos.find((c) => c.id === 'con-juan')!;
    const r = editarContrato(c0, { contratoId: contrato.id, cambios: { fechaFin: contrato.fechaFin, franjasFijas: [], notas: '', oferta: 'NINGUNA', importeCentimos: null, metodoPago: null, sesionesRestantes: null } });
    expect(r.ok).toBe(false);
  });

  it('cobrar, deshacer y borrar un cobro', () => {
    const c0 = ctx();
    const pendiente = c0.db.pagos.find((p) => p.estado === 'PENDIENTE')!;
    const r1 = guardarPago(c0, { pago: { ...pendiente, estado: 'PAGADO', metodo: 'TARJETA', pagadoEl: null } });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.valor.pagadoEl).not.toBeNull();
    const r2 = guardarPago({ ...c0, db: r1.db }, { pago: { ...r1.valor, estado: 'PENDIENTE' } });
    expect(r2.ok && r2.valor.pagadoEl).toBe(null);
    const r3 = borrarPago({ ...c0, db: r1.db }, { id: pendiente.id });
    expect(r3.ok && r3.db.pagos.some((p) => p.id === pendiente.id)).toBe(false);
  });

  it('un monitor sin permiso de editar clientes no registra cobros', () => {
    const db = crearSeed();
    const sinPermiso = db.trabajadores.find((t) => !t.permisos.includes('CLIENTES_EDITAR') && t.rol !== 'ADMIN');
    if (!sinPermiso) return;
    const r = guardarPago({ db, sesion: sesionDe(db, sinPermiso.id), ahora }, { pago: { ...db.pagos[0], estado: 'PAGADO' } });
    expect(r.ok).toBe(false);
  });
});

describe('horario: clases conservadas', () => {
  it('las clases con alumnos toman la actividad nueva y conservan su hora', () => {
    const c0 = ctx();
    const conReserva = c0.db.clases.find((c) => c.plantillaId && c.estado === 'PROGRAMADA' && c.fecha > hoy
      && c0.db.reservas.some((r) => r.claseId === c.id && r.estado === 'RESERVADA' && r.origen !== 'AUTOMATICA'));
    if (!conReserva) return;
    const plantilla = c0.db.plantillas.find((p) => p.id === conReserva.plantillaId)!;
    const otra = c0.db.actividades.find((a) => a.id !== plantilla.actividadId)!;
    const r = guardarPlantilla(c0, { plantilla: { ...plantilla, actividadId: otra.id, horaInicio: '07:05', plazas: 1 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const despues = r.db.clases.find((c) => c.id === conReserva.id)!;
    expect(despues.actividadId).toBe(otra.id);
    expect(despues.horaInicio).toBe(conReserva.horaInicio);
    const ocupadas = r.db.reservas.filter((x) => x.claseId === conReserva.id && x.estado === 'RESERVADA').length;
    expect(despues.plazas).toBeGreaterThanOrEqual(ocupadas);
  });
});
