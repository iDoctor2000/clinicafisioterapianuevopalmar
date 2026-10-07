/** Cliente del mes (demo): anunciar (con aviso), responder el ganador y quitar. */
import { describe, expect, it } from 'vitest';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { anunciarClienteDelMes, quitarClienteDelMes, responderClienteDelMes, type Ctx } from '@/data/comandos';

const db0 = crearSeed();
const ahora = new Date();
const trabajador = (id: string): Sesion => {
  const t = db0.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const alumno = (i: number): Sesion => {
  const c = db0.clientes[i];
  return { tipo: 'CLIENTE', userId: `u-${c.id}`, clienteId: c.id, nombre: c.nombre };
};
const ganador = db0.clientes[0];

describe('cliente del mes', () => {
  it('el administrador lo anuncia y el ganador recibe un aviso solo para él', () => {
    const r = anunciarClienteDelMes({ db: db0, sesion: trabajador('tra-jose'), ahora }, { mes: '2026-09-15', clienteId: ganador.id, clases: 9, motivo: 'x', aviso: { titulo: '🏆', cuerpo: 'Enhorabuena' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.premios).toEqual([expect.objectContaining({ mes: '2026-09-01', clienteId: ganador.id, clases: 9, publico: null })]);
    const aviso = r.db.avisos.find((a) => a.id === r.valor.avisoId)!;
    expect(aviso.destinatariosIds).toEqual([ganador.id]);
    // Volver a anunciar el mismo mes sustituye.
    const r2 = anunciarClienteDelMes({ db: r.db, sesion: trabajador('tra-jose'), ahora }, { mes: '2026-09-01', clienteId: db0.clientes[1].id, clases: 8, motivo: '' });
    expect(r2.ok && r2.db.premios.length).toBe(1);
    expect(r2.ok && r2.valor.avisoId).toBeNull();
  });

  it('solo el administrador', () => {
    const r = anunciarClienteDelMes({ db: db0, sesion: trabajador('tra-laura'), ahora }, { mes: '2026-09-01', clienteId: ganador.id, clases: 9, motivo: '' });
    expect(r).toEqual({ ok: false, error: 'Solo el administrador puede elegir al cliente del mes.' });
  });

  it('el ganador decide si se ve; nadie más puede contestar', () => {
    const r = anunciarClienteDelMes({ db: db0, sesion: trabajador('tra-jose'), ahora }, { mes: '2026-09-01', clienteId: ganador.id, clases: 9, motivo: '' });
    if (!r.ok) throw new Error(r.error);
    const ctxAlumno = (i: number): Ctx => ({ db: r.db, sesion: alumno(i), ahora });
    expect(responderClienteDelMes(ctxAlumno(1), { mes: '2026-09-01', publico: true })).toEqual({ ok: false, error: 'Ese premio no es tuyo.' });
    const si = responderClienteDelMes(ctxAlumno(0), { mes: '2026-09-01', publico: true });
    expect(si.ok && si.db.premios[0]).toMatchObject({ publico: true, nombrePublico: `${ganador.nombre} ${ganador.apellidos.charAt(0)}.` });
    const no = responderClienteDelMes(ctxAlumno(0), { mes: '2026-09-01', publico: false });
    expect(no.ok && no.db.premios[0]).toMatchObject({ publico: false, nombrePublico: '' });
    const q = quitarClienteDelMes({ db: r.db, sesion: trabajador('tra-jose'), ahora }, { mes: '2026-09-01' });
    expect(q.ok && q.db.premios).toEqual([]);
  });
});
