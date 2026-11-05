/**
 * 0051: en la lista de espera, «a cambio de otra clase mía» vale con cualquier clase futura suya (no solo de esa
 * semana) y no la pierde hasta entrar; e importe acordado 0 € = no se cobra.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Clase, Contrato, Pago, Reserva, Sesion, Tarifa } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { apuntarListaEspera, cancelarReserva, editarContrato } from '@/data/comandos';
import { opcionesDeCambio } from '@/features/cliente/consultas';
import { planDeCobros } from '@/domain/cobros';
import { cobrosDeRenovacion } from '@/domain/renovaciones';
import { resumenCobrosMes } from '@/domain/resumenCobros';
import { aISODate, inicioSemana, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const alumno = (db: Db, id: string): Sesion => {
  const c = db.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId ?? `usr-${id}`, clienteId: c.id, nombre: c.nombre };
};
const jose = (db: Db): Sesion => {
  const t = db.trabajadores.find((x) => x.id === 'tra-jose')!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, gestionaHorario: t.gestionaHorario === true, veFinanzas: true };
};

describe('0051 · a cambio de una clase de otra semana', () => {
  /** Clase de dirigidas completa dentro de 3 días; Juan (fijo) cambia por su clase fija de dos semanas después. */
  function preparar() {
    const db0 = crearSeed();
    const actividad = db0.actividades.find((a) => a.categoria === 'DIRIGIDA' && a.activa)!;
    const clase: Clase = {
      id: 'cla-llena', plantillaId: null, actividadId: actividad.id, fecha: sumarDias(hoy, 3), horaInicio: '20:30', duracionMin: 55, monitorId: 'tra-ana',
      plazas: 1, estado: 'PROGRAMADA', extraordinaria: true, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null,
    };
    const lucia: Reserva = { id: 'res-lucia', claseId: clase.id, clienteId: 'lucia', contratoId: null, origen: 'MANUAL', estado: 'RESERVADA', asistencia: 'PENDIENTE',
      recuperacionUsadaId: null, creadaEl: ahora.toISOString(), creadaPor: 'tra-jose', canceladaEl: null, canceladaPor: null };
    const db: Db = { ...db0, clases: [...db0.clases, clase], reservas: [...db0.reservas, lucia] };
    const otraSemana = db.reservas
      .filter((r) => r.clienteId === 'juan' && r.estado === 'RESERVADA')
      .map((r) => ({ r, c: db.clases.find((c) => c.id === r.claseId)! }))
      .filter(({ c }) => inicioSemana(c.fecha) > inicioSemana(clase.fecha))
      .sort((a, b) => a.c.fecha.localeCompare(b.c.fecha))[0];
    return { db, clase, otraSemana };
  }

  it('se ofrece y se acepta; mientras espera conserva su clase; al entrar se cambia', () => {
    const { db, clase, otraSemana } = preparar();
    expect(otraSemana).toBeDefined();
    const opciones = opcionesDeCambio(db, 'juan', clase.id, ahora);
    const op = opciones.find((o) => o.vista.reserva.id === otraSemana.r.id);
    expect(op?.motivo).toBeNull();
    const a = apuntarListaEspera({ db, sesion: alumno(db, 'juan'), ahora }, { claseId: clase.id, reservaCambioId: otraSemana.r.id });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.db.reservas.find((r) => r.id === otraSemana.r.id)?.estado).toBe('RESERVADA');
    const c = cancelarReserva({ db: a.db, sesion: alumno(a.db, 'lucia'), ahora }, { reservaId: 'res-lucia' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.db.reservas.find((r) => r.id === otraSemana.r.id)?.estado).toBe('CANCELADA_RECUPERABLE');
    expect(c.db.reservas.some((r) => r.claseId === clase.id && r.clienteId === 'juan' && r.estado === 'RESERVADA')).toBe(true);
    expect(c.db.recuperaciones.some((x) => x.reservaOrigenId === otraSemana.r.id)).toBe(false);
  });

  it('no vale una clase fuera de las fechas de su contratación', () => {
    const { db, otraSemana } = preparar();
    const k = db.contratos.find((x) => x.id === otraSemana.r.contratoId)!;
    const fuera: Clase = { ...db.clases.find((c) => c.id === 'cla-llena')!, id: 'cla-fuera', fecha: sumarDias(k.fechaFin, 3) };
    const ocupa: Reserva = { ...db.reservas.find((r) => r.id === 'res-lucia')!, id: 'res-fuera', claseId: fuera.id };
    const db2: Db = { ...db, clases: [...db.clases, fuera], reservas: [...db.reservas, ocupa] };
    const r = apuntarListaEspera({ db: db2, sesion: alumno(db2, 'juan'), ahora }, { claseId: fuera.id, reservaCambioId: otraSemana.r.id });
    expect(!r.ok && r.error).toBe('Esa clase es fuera de las fechas de tu contratación.');
  });
});

describe('0051 · importe 0 € = no se cobra', () => {
  const tarifa = { tipo: 'RECURRENTE', nombre: 'Dirigidas', precioCentimos: 5800, descripcion: '' } as Pick<Tarifa, 'tipo' | 'nombre' | 'precioCentimos' | 'descripcion'>;
  it('ni plan de cobros, ni cobros al renovar, ni «Sin cobro»', () => {
    expect(planDeCobros({ tarifa, inicio: '2026-11-01', fin: '2026-12-31', oferta: 'NINGUNA', importeCentimos: 0 })).toEqual([]);
    expect(planDeCobros({ tarifa, inicio: '2026-11-01', fin: '2026-11-30', oferta: 'NINGUNA', importeCentimos: null })).toHaveLength(1);
    const k = { id: 'k', clienteId: 'x', tarifaId: 't', fechaInicio: '2026-10-01', fechaFin: '2026-10-31', estado: 'ACTIVO', importeCentimos: 0 } as Contrato;
    expect(cobrosDeRenovacion(k, '2026-11-30', [], 5800)).toEqual([]);
    const r = resumenCobrosMes({ pagos: [], clientes: [{ id: 'x', nombre: 'X', apellidos: 'Y', activo: true } as never], contratos: [{ ...k, fechaFin: '2026-11-30' }], tarifas: [{ id: 't', tipo: 'RECURRENTE' } as Tarifa] }, '2026-11-01', '2026-11-05');
    expect(r.sinCobro).toEqual([]);
  });

  it('al poner 0 € se quitan sus cobros pendientes (los cobrados se quedan)', () => {
    const db = crearSeed();
    const k = db.contratos.find((c) => c.estado === 'ACTIVO' && db.tarifas.find((t) => t.id === c.tarifaId)?.tipo === 'RECURRENTE')!;
    const pend: Pago = { id: 'pag-pend', contratoId: k.id, clienteId: k.clienteId, concepto: 'Noviembre 2026', importeCentimos: 5800, venceEl: hoy, mes: `${hoy.slice(0, 7)}-01`, estado: 'PENDIENTE', metodo: null, pagadoEl: null, creadoEl: ahora.toISOString() };
    const cobr: Pago = { ...pend, id: 'pag-cobr', mes: '2026-10-01', estado: 'PAGADO', metodo: 'EFECTIVO', pagadoEl: ahora.toISOString() };
    const db2: Db = { ...db, pagos: [...db.pagos, pend, cobr] };
    const r = editarContrato({ db: db2, sesion: jose(db2), ahora }, { contratoId: k.id, cambios: {
      fechaFin: k.fechaFin, franjasFijas: k.franjasFijas, notas: k.notas, oferta: k.oferta ?? 'NINGUNA', importeCentimos: 0, metodoPago: k.metodoPago ?? null, sesionesRestantes: k.sesionesRestantes,
    } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.pagos.some((p) => p.id === 'pag-pend')).toBe(false);
    expect(r.db.pagos.some((p) => p.id === 'pag-cobr')).toBe(true);
  });
});
