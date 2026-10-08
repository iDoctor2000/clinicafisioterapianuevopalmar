/** rehacerReservasFijas: vuelve a apuntar al alumno de horario fijo a las clases futuras que le falten. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { rehacerReservasFijas } from '@/data/comandos';
import { aISODate } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const sesionDe = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};

describe('rehacerReservasFijas', () => {
  const db0 = crearSeed();
  const contrato = db0.contratos.find((c) => c.modalidad === 'FIJO' && c.estado === 'ACTIVO' && c.fechaFin > hoy)!;
  const esFutura = (claseId: string) => (db0.clases.find((c) => c.id === claseId)?.fecha ?? '') >= hoy;

  it('si no falta ninguna, no crea nada', () => {
    const r = rehacerReservasFijas({ db: db0, sesion: sesionDe(db0, 'tra-laura'), ahora }, { contratoId: contrato.id });
    expect(r.ok && r.valor.creadas).toBe(0);
  });

  it('recupera las reservas futuras que se hubieran perdido, sin tocar las pasadas', () => {
    const perdidas = db0.reservas.filter((x) => x.contratoId === contrato.id && x.estado === 'RESERVADA' && esFutura(x.claseId));
    expect(perdidas.length).toBeGreaterThan(0);
    const sinEllas: Db = { ...db0, reservas: db0.reservas.filter((x) => !perdidas.includes(x)) };
    const r = rehacerReservasFijas({ db: sinEllas, sesion: sesionDe(db0, 'tra-laura'), ahora }, { contratoId: contrato.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.creadas).toBe(perdidas.length);
    const nuevas = r.db.reservas.filter((x) => x.contratoId === contrato.id && x.estado === 'RESERVADA');
    expect(new Set(nuevas.map((x) => x.claseId))).toEqual(new Set(db0.reservas.filter((x) => x.contratoId === contrato.id && x.estado === 'RESERVADA').map((x) => x.claseId)));
    expect(nuevas.every((x) => x.origen === 'AUTOMATICA')).toBe(true);
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'RESERVAS_AUTOMATICAS', entidadId: contrato.id });
  });

  it('necesita permiso y un contrato fijo activo', () => {
    const ana = sesionDe(db0, 'tra-ana');
    const sinPermiso: Sesion = { ...ana, tipo: 'TRABAJADOR', permisos: [] } as Sesion;
    expect(rehacerReservasFijas({ db: db0, sesion: sinPermiso, ahora }, { contratoId: contrato.id }).ok).toBe(false);
    const libre = db0.contratos.find((c) => c.modalidad === 'LIBRE' && c.estado === 'ACTIVO')!;
    expect(rehacerReservasFijas({ db: db0, sesion: sesionDe(db0, 'tra-laura'), ahora }, { contratoId: libre.id })).toEqual({ ok: false, error: 'Solo para contratos activos de horario fijo.' });
  });
});

describe('rehacerTodasReservasFijas', () => {
  it('repasa todos los contratos fijos activos y solo el administrador puede', async () => {
    const { rehacerTodasReservasFijas } = await import('@/data/comandos');
    const db0 = crearSeed();
    const fijos = db0.contratos.filter((c) => c.modalidad === 'FIJO' && c.estado === 'ACTIVO');
    const futuras = db0.reservas.filter((x) => x.estado === 'RESERVADA' && x.origen === 'AUTOMATICA' && fijos.some((c) => c.id === x.contratoId) && (db0.clases.find((c) => c.id === x.claseId)?.fecha ?? '') >= hoy);
    const sinEllas: Db = { ...db0, reservas: db0.reservas.filter((x) => !futuras.includes(x)) };
    const r = rehacerTodasReservasFijas({ db: sinEllas, sesion: sesionDe(db0, 'tra-jose'), ahora }, {});
    expect(r.ok && r.valor.creadas).toBe(futuras.length);
    expect(r.ok && r.valor.contratos).toBeGreaterThan(0);
    const otra = rehacerTodasReservasFijas({ db: db0, sesion: sesionDe(db0, 'tra-jose'), ahora }, {});
    expect(otra.ok && otra.valor).toEqual({ contratos: 0, creadas: 0 });
    expect(rehacerTodasReservasFijas({ db: db0, sesion: sesionDe(db0, 'tra-laura'), ahora }, {}).ok).toBe(false);
  });
});
