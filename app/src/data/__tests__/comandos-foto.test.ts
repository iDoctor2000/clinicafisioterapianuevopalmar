/** Comando actualizarFotoCliente: quién puede poner/quitar la foto de quién. */
import { describe, expect, it } from 'vitest';
import type { Sesion } from '@/domain/types';
import { MENSAJE_CLIENTE_AJENO } from '@/domain/ambito';
import { alumnosDe } from '@/domain/ambito';
import { crearSeed } from '@/data/seed';
import { actualizarFotoCliente, guardarCliente, type Ctx } from '@/data/comandos';
import type { Db } from '@/data/db';

const db0 = crearSeed();
const ahora = new Date();
const ctx = (sesion: Sesion, db: Db = db0): Ctx => ({ db, sesion, ahora });
const trabajador = (id: string): Sesion => {
  const t = db0.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const clienteSesion = (id: string): Sesion => {
  const c = db0.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId!, clienteId: c.id, nombre: c.nombre };
};
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const fotoDe = (db: Db, id: string) => db.clientes.find((c) => c.id === id)?.fotoUrl;

describe('actualizarFotoCliente · cliente', () => {
  it('pone y quita su propia foto, con auditoría', () => {
    const r = actualizarFotoCliente(ctx(clienteSesion('isabel')), { fotoUrl: FOTO });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fotoDe(r.db, 'isabel')).toBe(FOTO);
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'FOTO_CLIENTE', entidad: 'cliente', entidadId: 'isabel' });
    const q = actualizarFotoCliente(ctx(clienteSesion('isabel'), r.db), { clienteId: 'isabel', fotoUrl: null });
    expect(q.ok).toBe(true);
    if (q.ok) {
      expect(fotoDe(q.db, 'isabel')).toBeNull();
      expect(q.db.auditoria[0].accion).toBe('QUITAR_FOTO_CLIENTE');
    }
  });
  it('no puede tocar la foto de otro cliente', () => {
    const r = actualizarFotoCliente(ctx(clienteSesion('isabel')), { clienteId: 'maria', fotoUrl: null });
    expect(r).toEqual({ ok: false, error: 'Solo puedes cambiar tu propia foto.' });
    expect(fotoDe(db0, 'maria')).toBeTruthy();
  });
  it('una cadena vacía equivale a quitar la foto', () => {
    const r = actualizarFotoCliente(ctx(clienteSesion('maria')), { fotoUrl: '   ' });
    expect(r.ok && fotoDe(r.db, 'maria')).toBeNull();
  });
});

describe('actualizarFotoCliente · personal', () => {
  const jose = trabajador('tra-jose');   // ADMIN
  const laura = trabajador('tra-laura'); // RECEPCION, CENTRO
  const ana = trabajador('tra-ana');     // MONITOR, SUS_CLASES

  it('exige CLIENTES_EDITAR', () => {
    const sinPermiso: Sesion = { ...laura, tipo: 'TRABAJADOR', permisos: laura.tipo === 'TRABAJADOR' ? laura.permisos.filter((p) => p !== 'CLIENTES_EDITAR') : [] } as Sesion;
    expect(actualizarFotoCliente(ctx(sinPermiso), { clienteId: 'isabel', fotoUrl: FOTO })).toEqual({ ok: false, error: 'No tienes permiso para: CLIENTES_EDITAR' });
  });
  it('el admin pone la foto a cualquier cliente y necesita indicar cuál', () => {
    expect(actualizarFotoCliente(ctx(jose), { fotoUrl: FOTO })).toEqual({ ok: false, error: 'Falta el cliente.' });
    expect(actualizarFotoCliente(ctx(jose), { clienteId: 'no-existe', fotoUrl: FOTO })).toEqual({ ok: false, error: 'Cliente no encontrado.' });
    const r = actualizarFotoCliente(ctx(jose), { clienteId: 'isabel', fotoUrl: FOTO });
    expect(r.ok && fotoDe(r.db, 'isabel')).toBe(FOTO);
  });
  it('con ámbito SUS_CLASES solo sobre sus alumnos', () => {
    const alumnos = alumnosDe(db0, ana)!;
    const mio = db0.clientes.find((c) => alumnos.has(c.id))!;
    const ajeno = db0.clientes.find((c) => !alumnos.has(c.id))!;
    expect(mio && ajeno).toBeTruthy();
    // Ana tiene CLIENTES_EDITAR en la demo (si no, se lo damos para aislar la comprobación de ámbito).
    const anaEdita: Sesion = { ...ana, permisos: Array.from(new Set([...(ana.tipo === 'TRABAJADOR' ? ana.permisos : []), 'CLIENTES_EDITAR' as const])) } as Sesion;
    expect(actualizarFotoCliente(ctx(anaEdita), { clienteId: ajeno.id, fotoUrl: FOTO })).toEqual({ ok: false, error: MENSAJE_CLIENTE_AJENO });
    const r = actualizarFotoCliente(ctx(anaEdita), { clienteId: mio.id, fotoUrl: FOTO });
    expect(r.ok && fotoDe(r.db, mio.id)).toBe(FOTO);
  });
  it('guardarCliente conserva la foto si el formulario la trae y la respeta al reenviar la ficha', () => {
    const c = db0.clientes.find((x) => x.id === 'maria')!;
    const r = guardarCliente(ctx(jose), { cliente: { ...c, telefono: '600 000 000' } });
    expect(r.ok && fotoDe(r.db, 'maria')).toBe(c.fotoUrl);
  });
});
