/** 0020: quitar una franja cancela sus clases con alumnos (con recuperación); los festivos no se recuperan. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Reserva, Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { cancelarClase, clasesQueSeCancelarian, guardarPlantilla } from '@/data/comandos';
import { aISODate } from '@/domain/fechas';

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
    expect(clasesQueSeCancelarian(db, plantilla, hoy).clases).toHaveLength(0);
    const previa = clasesQueSeCancelarian(db, { ...plantilla, activa: false }, hoy);
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
