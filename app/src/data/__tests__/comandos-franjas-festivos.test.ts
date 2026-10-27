/** 0020: quitar una franja cancela sus clases con alumnos (con recuperación); los festivos no se recuperan. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Reserva, Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { cancelarClase, clasesQueSeCancelarian, guardarPlantilla, reactivarClase } from '@/data/comandos';
import { aISODate, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const sesionDe = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};

/** Seed con una reserva manual de un alumno en la próxima clase de la primera franja activa. */
function preparar() {
  const db0 = crearSeed();
  const plantilla = db0.plantillas.find((p) => p.activa)!;
  const clase = db0.clases.filter((c) => c.plantillaId === plantilla.id && c.estado === 'PROGRAMADA' && c.fecha > hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  const cliente = db0.clientes.find((c) => !db0.reservas.some((r) => r.claseId === clase.id && r.clienteId === c.id))!;
  const reserva: Reserva = {
    id: 'res-manual-prueba', claseId: clase.id, clienteId: cliente.id, contratoId: null, origen: 'MANUAL', estado: 'RESERVADA', asistencia: 'PENDIENTE',
    recuperacionUsadaId: null, creadaEl: ahora.toISOString(), creadaPor: 'tra-jose', canceladaEl: null, canceladaPor: null,
  } as Reserva;
  return { db: { ...db0, reservas: [...db0.reservas, reserva] } as Db, plantilla, clase, cliente };
}

describe('quitar una franja', () => {
  it('avisa antes de cuántas clases y alumnos se cancelarían', () => {
    const { db, plantilla, clase } = preparar();
    expect(clasesQueSeCancelarian(db, plantilla, ahora).clases).toHaveLength(0);
    const previa = clasesQueSeCancelarian(db, { ...plantilla, activa: false }, ahora);
    expect(previa.clases.map((c) => c.id)).toContain(clase.id);
    expect(previa.alumnos).toBeGreaterThan(0);
  });

  it('al desactivarla, sus clases con alumnos se cancelan con aviso y recuperación', () => {
    const { db, plantilla, clase, cliente } = preparar();
    const r = guardarPlantilla({ db, sesion: sesionDe(db, 'tra-jose'), ahora }, { plantilla: { ...plantilla, activa: false } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.canceladas).toBeGreaterThan(0);
    expect(r.valor.afectados).toBeGreaterThan(0);
    expect(r.valor.avisoIds.length).toBe(r.valor.canceladas);
    expect(r.db.clases.find((c) => c.id === clase.id)?.estado).toBe('CANCELADA');
    expect(r.db.clases.some((c) => c.plantillaId === plantilla.id && c.estado === 'PROGRAMADA' && c.fecha >= hoy)).toBe(false);
    expect(r.db.recuperaciones.some((x) => x.clienteId === cliente.id && x.motivo === 'CANCELACION_CENTRO')).toBe(true);
  });

  it('con fecha de fin, solo se cancelan las clases posteriores', () => {
    const { db, plantilla, clase } = preparar();
    const r = guardarPlantilla({ db, sesion: sesionDe(db, 'tra-jose'), ahora }, { plantilla: { ...plantilla, vigenciaHasta: clase.fecha } });
    expect(r.ok && r.db.clases.find((c) => c.id === clase.id)?.estado).toBe('PROGRAMADA');
  });
});

describe('festivos', () => {
  it('cancelar a mano una clase en día de cierre no da recuperación, pero avisa', () => {
    const { db, clase, cliente } = preparar();
    const conCierre: Db = { ...db, config: { ...db.config, diasCierre: [...db.config.diasCierre, { fecha: clase.fecha, motivo: 'Festivo' }] } };
    const r = cancelarClase({ db: conCierre, sesion: sesionDe(db, 'tra-jose'), ahora }, { claseId: clase.id, motivo: 'Festivo', claseAlternativaId: null, avisar: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.recuperaciones.length).toBe(conCierre.recuperaciones.length);
    expect(r.db.avisos[0].cuerpo).toContain('no se recupera');
    expect(r.db.avisos[0].destinatariosIds).toContain(cliente.id);
  });

  it('un día normal sí da recuperación', () => {
    const { db, clase, cliente } = preparar();
    const r = cancelarClase({ db, sesion: sesionDe(db, 'tra-jose'), ahora }, { claseId: clase.id, motivo: 'Baja del monitor', claseAlternativaId: null, avisar: true });
    expect(r.ok && r.db.recuperaciones.some((x) => x.clienteId === cliente.id && x.motivo === 'CANCELACION_CENTRO')).toBe(true);
  });
});

describe('0033: deshacer un cambio de horario y reactivar clases', () => {
  it('poner "vigente desde" más adelante cancela las de antes; quitarlo las reactiva con sus alumnos y sin la recuperación', () => {
    const { db, plantilla, clase, cliente } = preparar();
    const ctx = { db, sesion: sesionDe(db, 'tra-jose'), ahora };
    // Como el 27/10/2026: «Vigente desde» un día después de la clase (el horario «de noviembre»).
    const r1 = guardarPlantilla(ctx, { plantilla: { ...plantilla, vigenciaDesde: sumarDias(clase.fecha, 1) } });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.db.clases.find((c) => c.id === clase.id)!.estado).toBe('CANCELADA');
    expect(r1.db.recuperaciones.some((x) => x.clienteId === cliente.id && x.reservaOrigenId === 'res-manual-prueba' && x.estado === 'DISPONIBLE')).toBe(true);
    // Se deshace el cambio: la clase vuelve con su alumno y la recuperación se retira.
    const r2 = guardarPlantilla({ ...ctx, db: r1.db }, { plantilla: { ...plantilla, vigenciaDesde: null } });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.valor.reactivadas).toBeGreaterThan(0);
    expect(r2.db.clases.find((c) => c.id === clase.id)!.estado).toBe('PROGRAMADA');
    expect(r2.db.reservas.find((r) => r.id === 'res-manual-prueba')!.estado).toBe('RESERVADA');
    expect(r2.db.recuperaciones.some((x) => x.reservaOrigenId === 'res-manual-prueba')).toBe(false);
    expect(r2.db.avisos.some((a) => a.destino.tipo === 'CLASE' && a.destino.claseId === clase.id && a.titulo.startsWith('Clase cancelada'))).toBe(false);
    expect(r2.db.avisos.some((a) => a.destino.tipo === 'CLASE' && a.destino.claseId === clase.id && a.titulo.startsWith('Clase de nuevo programada'))).toBe(true);
  });

  it('cambiar una franja no toca las clases que ya han empezado (aunque sean de hoy)', () => {
    const { db, plantilla } = preparar();
    const ya = { ...db.clases.find((c) => c.plantillaId === plantilla.id)!, id: 'cla-ya-dada', fecha: hoy, horaInicio: '00:00' };
    const res: Reserva = { id: 'res-ya', claseId: ya.id, clienteId: db.clientes[0].id, contratoId: null, origen: 'MANUAL', estado: 'RESERVADA', asistencia: 'ASISTE',
      recuperacionUsadaId: null, creadaEl: ahora.toISOString(), creadaPor: 'tra-jose', canceladaEl: null, canceladaPor: null } as Reserva;
    const db1 = { ...db, clases: [...db.clases.filter((c) => !(c.plantillaId === plantilla.id && c.fecha === hoy)), ya], reservas: [...db.reservas, res] } as Db;
    const r = guardarPlantilla({ db: db1, sesion: sesionDe(db1, 'tra-jose'), ahora }, { plantilla: { ...plantilla, activa: false } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.clases.find((c) => c.id === 'cla-ya-dada')!.estado).toBe('PROGRAMADA');
    expect(r.db.reservas.find((x) => x.id === 'res-ya')!.estado).toBe('RESERVADA');
  });

  it('reactivar a mano una clase cancelada por error', () => {
    const { db, clase, cliente } = preparar();
    const ctx = { db, sesion: sesionDe(db, 'tra-jose'), ahora };
    const c1 = cancelarClase(ctx, { claseId: clase.id, motivo: 'Error', claseAlternativaId: null, avisar: true });
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;
    const r = reactivarClase({ ...ctx, db: c1.db }, { claseId: clase.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.vuelven).toBeGreaterThan(0);
    expect(r.db.reservas.find((x) => x.id === 'res-manual-prueba')!.estado).toBe('RESERVADA');
    expect(r.db.recuperaciones.filter((x) => x.clienteId === cliente.id && x.estado === 'DISPONIBLE')).toEqual(db.recuperaciones.filter((x) => x.clienteId === cliente.id && x.estado === 'DISPONIBLE'));
    expect(reactivarClase({ ...ctx, db: r.db }, { claseId: clase.id }).ok).toBe(false); // ya no está cancelada
  });
});
