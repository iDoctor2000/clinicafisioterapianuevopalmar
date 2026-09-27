/** Comandos registrarConsentimiento (el propio cliente) y registrarConsentimientoPapel (personal). */
import { describe, expect, it } from 'vitest';
import type { Sesion } from '@/domain/types';
import { MENSAJE_CLIENTE_AJENO, alumnosDe } from '@/domain/ambito';
import { CONSENTIMIENTO_PAPEL, VERSION_POLITICA_PRIVACIDAD } from '@/domain/privacidad';
import { crearSeed } from '@/data/seed';
import { registrarConsentimiento, registrarConsentimientoPapel, guardarCliente, type Ctx } from '@/data/comandos';
import type { Db } from '@/data/db';

const db0 = crearSeed();
const ahora = new Date('2026-09-27T10:30:00.000Z');
const ctx = (sesion: Sesion, db: Db = db0): Ctx => ({ db, sesion, ahora });
const trabajador = (id: string): Sesion => {
  const t = db0.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const clienteSesion = (id: string): Sesion => {
  const c = db0.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId!, clienteId: c.id, nombre: c.nombre };
};
const consentimientoDe = (db: Db, id: string) => {
  const c = db.clientes.find((x) => x.id === id)!;
  return { el: c.consentimientoEl, version: c.consentimientoVersion };
};

describe('seed', () => {
  it('todos los clientes de demo tienen consentimiento salvo Nuria (chip pendiente en su ficha)', () => {
    expect(db0.clientes.filter((c) => c.consentimientoEl == null).map((c) => c.id)).toEqual(['nuria']);
    expect(consentimientoDe(db0, 'maria').version).toBe(VERSION_POLITICA_PRIVACIDAD);
  });
});

describe('registrarConsentimiento · cliente', () => {
  it('guarda el instante y la versión vigente en su propia ficha, con auditoría', () => {
    const r = registrarConsentimiento(ctx(clienteSesion('nuria')), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(consentimientoDe(r.db, 'nuria')).toEqual({ el: '2026-09-27T10:30:00.000Z', version: VERSION_POLITICA_PRIVACIDAD });
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'CONSENTIMIENTO', entidad: 'cliente', entidadId: 'nuria', actorId: 'usr-nuria' });
    // Los demás clientes no cambian.
    expect(consentimientoDe(r.db, 'maria')).toEqual(consentimientoDe(db0, 'maria'));
  });
  it('un trabajador no puede usarlo (para el papel está registrarConsentimientoPapel)', () => {
    expect(registrarConsentimiento(ctx(trabajador('tra-jose')), {})).toEqual({ ok: false, error: 'Solo el propio cliente puede aceptar la política de privacidad.' });
  });
});

describe('registrarConsentimientoPapel · personal', () => {
  const jose = trabajador('tra-jose');   // ADMIN
  const laura = trabajador('tra-laura'); // RECEPCION, CENTRO
  const ana = trabajador('tra-ana');     // MONITOR, SUS_CLASES

  it('exige CLIENTES_EDITAR', () => {
    const sinPermiso: Sesion = { ...laura, tipo: 'TRABAJADOR', permisos: laura.tipo === 'TRABAJADOR' ? laura.permisos.filter((p) => p !== 'CLIENTES_EDITAR') : [] } as Sesion;
    expect(registrarConsentimientoPapel(ctx(sinPermiso), { clienteId: 'nuria' })).toEqual({ ok: false, error: 'No tienes permiso para: CLIENTES_EDITAR' });
  });
  it('el admin registra el papel de cualquier cliente: fecha de hoy y versión "papel", auditado', () => {
    expect(registrarConsentimientoPapel(ctx(jose), { clienteId: '' })).toEqual({ ok: false, error: 'Falta el cliente.' });
    expect(registrarConsentimientoPapel(ctx(jose), { clienteId: 'no-existe' })).toEqual({ ok: false, error: 'Cliente no encontrado.' });
    const r = registrarConsentimientoPapel(ctx(jose), { clienteId: 'nuria' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(consentimientoDe(r.db, 'nuria')).toEqual({ el: '2026-09-27T10:30:00.000Z', version: CONSENTIMIENTO_PAPEL });
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'CONSENTIMIENTO_PAPEL', entidad: 'cliente', entidadId: 'nuria', actorId: jose.userId });
  });
  it('un cliente no puede registrar el papel (ni el suyo)', () => {
    expect(registrarConsentimientoPapel(ctx(clienteSesion('nuria')), { clienteId: 'nuria' })).toEqual({ ok: false, error: 'No tienes permiso para: CLIENTES_EDITAR' });
  });
  it('con ámbito SUS_CLASES solo sobre sus alumnos', () => {
    const alumnos = alumnosDe(db0, ana)!;
    const mio = db0.clientes.find((c) => alumnos.has(c.id))!;
    const ajeno = db0.clientes.find((c) => !alumnos.has(c.id))!;
    expect(mio && ajeno).toBeTruthy();
    const anaEdita: Sesion = { ...ana, permisos: Array.from(new Set([...(ana.tipo === 'TRABAJADOR' ? ana.permisos : []), 'CLIENTES_EDITAR' as const])) } as Sesion;
    expect(registrarConsentimientoPapel(ctx(anaEdita), { clienteId: ajeno.id })).toEqual({ ok: false, error: MENSAJE_CLIENTE_AJENO });
    const r = registrarConsentimientoPapel(ctx(anaEdita), { clienteId: mio.id });
    expect(r.ok && consentimientoDe(r.db, mio.id).version).toBe(CONSENTIMIENTO_PAPEL);
  });
  it('guardarCliente no pisa el consentimiento si el formulario trae la ficha completa', () => {
    const c = db0.clientes.find((x) => x.id === 'maria')!;
    const r = guardarCliente(ctx(jose), { cliente: { ...c, telefono: '600 000 000' } });
    expect(r.ok && consentimientoDe(r.db, 'maria')).toEqual(consentimientoDe(db0, 'maria'));
  });
});
