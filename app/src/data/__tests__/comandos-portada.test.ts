/** Comandos de la portada (carrusel): guardarPortadaImagen, borrarPortadaImagen, ordenarPortada. Solo el administrador. */
import { describe, expect, it } from 'vitest';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { borrarPortadaImagen, guardarPortadaImagen, ordenarPortada, MAX_PORTADA, MENSAJE_SOLO_ADMIN_PORTADA, type Ctx } from '@/data/comandos';
import { portadaOrdenada, portadaVisible } from '@/data/selectores';
import type { Db } from '@/data/db';

const db0 = crearSeed();
const ahora = new Date('2026-10-03T10:00:00.000Z');
const ctx = (sesion: Sesion, db: Db = db0): Ctx => ({ db, sesion, ahora });
const trabajador = (id: string): Sesion => {
  const t = db0.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const admin = trabajador('tra-jose');
const recepcion = trabajador('tra-laura');
const cliente: Sesion = { tipo: 'CLIENTE', userId: db0.clientes[0].userId!, clienteId: db0.clientes[0].id, nombre: db0.clientes[0].nombre };
const URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('seed', () => {
  it('la demo trae tres fotos activas y ordenadas', () => {
    expect(db0.portada).toHaveLength(3);
    expect(portadaVisible(db0).map((p) => p.orden)).toEqual([1, 2, 3]);
  });
});

describe('guardarPortadaImagen', () => {
  it('el administrador añade una foto al final, con auditoría', () => {
    const r = guardarPortadaImagen(ctx(admin), { imagen: { url: URL, pie: '  Nueva sala  ', activa: true } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({ url: URL, pie: 'Nueva sala', orden: 4, activa: true, creadoEl: ahora.toISOString() });
    expect(r.db.portada).toHaveLength(4);
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'CREAR_PORTADA', entidad: 'portada', entidadId: r.valor.id, detalle: 'Nueva sala' });
  });
  it('edita pie y visibilidad de una existente sin cambiar su orden', () => {
    const r = guardarPortadaImagen(ctx(admin), { imagen: { id: 'por-2', url: URL, pie: 'Otro pie', activa: false } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const img = r.db.portada.find((p) => p.id === 'por-2')!;
    expect(img).toMatchObject({ pie: 'Otro pie', activa: false, orden: 2, creadoEl: db0.portada[1].creadoEl });
    expect(portadaVisible(r.db).map((p) => p.id)).toEqual(['por-1', 'por-3']);
    expect(r.db.auditoria[0].accion).toBe('EDITAR_PORTADA');
  });
  it('rechaza una url vacía, un id inexistente y superar el máximo', () => {
    expect(guardarPortadaImagen(ctx(admin), { imagen: { url: '  ', pie: '', activa: true } })).toEqual({ ok: false, error: 'Falta la imagen.' });
    expect(guardarPortadaImagen(ctx(admin), { imagen: { id: 'no-existe', url: URL, pie: '', activa: true } })).toEqual({ ok: false, error: 'Foto no encontrada.' });
    let db = db0;
    for (let i = db.portada.length; i < MAX_PORTADA; i++) {
      const r = guardarPortadaImagen(ctx(admin, db), { imagen: { url: URL, pie: `${i}`, activa: true } });
      expect(r.ok).toBe(true);
      if (r.ok) db = r.db;
    }
    const r = guardarPortadaImagen(ctx(admin, db), { imagen: { url: URL, pie: 'una más', activa: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`${MAX_PORTADA}`);
  });
  it('solo el administrador: ni recepción ni un cliente', () => {
    expect(guardarPortadaImagen(ctx(recepcion), { imagen: { url: URL, pie: '', activa: true } })).toEqual({ ok: false, error: MENSAJE_SOLO_ADMIN_PORTADA });
    expect(guardarPortadaImagen(ctx(cliente), { imagen: { url: URL, pie: '', activa: true } })).toEqual({ ok: false, error: MENSAJE_SOLO_ADMIN_PORTADA });
  });
});

describe('borrarPortadaImagen', () => {
  it('el administrador borra; los demás no', () => {
    const r = borrarPortadaImagen(ctx(admin), { id: 'por-1' });
    expect(r.ok && r.db.portada.map((p) => p.id)).toEqual(['por-2', 'por-3']);
    expect(r.ok && r.db.auditoria[0]).toMatchObject({ accion: 'BORRAR_PORTADA', entidadId: 'por-1' });
    expect(borrarPortadaImagen(ctx(admin), { id: 'nada' })).toEqual({ ok: false, error: 'Foto no encontrada.' });
    expect(borrarPortadaImagen(ctx(recepcion), { id: 'por-1' })).toEqual({ ok: false, error: MENSAJE_SOLO_ADMIN_PORTADA });
    expect(db0.portada).toHaveLength(3);
  });
});

describe('ordenarPortada', () => {
  it('renumera según la lista de ids y las que faltan quedan al final', () => {
    const r = ordenarPortada(ctx(admin), { ids: ['por-3', 'por-1'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(portadaOrdenada(r.db.portada).map((p) => [p.id, p.orden])).toEqual([['por-3', 1], ['por-1', 2], ['por-2', 3]]);
  });
  it('rechaza ids desconocidos y a quien no es administrador', () => {
    expect(ordenarPortada(ctx(admin), { ids: ['por-1', 'x'] })).toEqual({ ok: false, error: 'Foto no encontrada.' });
    expect(ordenarPortada(ctx(cliente), { ids: ['por-1'] })).toEqual({ ok: false, error: MENSAJE_SOLO_ADMIN_PORTADA });
  });
});
