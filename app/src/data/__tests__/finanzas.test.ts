/** Finanzas (0024): solo quien tiene el acceso ve importes y cobros, y solo él puede concederlo. */
import { describe, expect, it } from 'vitest';
import type { Sesion } from '@/domain/types';
import { veFinanzas } from '@/domain/types';
import { ocultarFinanzas } from '@/domain/finanzas';
import { crearSeed } from '@/data/seed';
import { guardarTrabajador, type Ctx } from '@/data/comandos';
import type { Db } from '@/data/db';

function sesionDe(db: Db, id: string): Sesion {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, veFinanzas: t.veFinanzas === true, gestionaHorario: t.gestionaHorario === true };
}
const db0 = crearSeed();
const ctx = (sesion: Sesion, db: Db = db0): Ctx => ({ db, sesion, ahora: new Date() });
const jose = sesionDe(db0, 'tra-jose') as Extract<Sesion, { tipo: 'TRABAJADOR' }>;

describe('veFinanzas', () => {
  it('es explícito: el rol ADMIN por sí solo no lo da', () => {
    expect(veFinanzas(jose)).toBe(true);
    expect(veFinanzas({ ...jose, veFinanzas: undefined })).toBe(false);
    expect(veFinanzas({ ...jose, veFinanzas: false })).toBe(false);
    expect(veFinanzas({ tipo: 'CLIENTE', userId: 'u', clienteId: 'c', nombre: 'x' })).toBe(false);
  });

  it('ocultarFinanzas deja la instantánea sin cobros ni importes', () => {
    expect(db0.pagos.length).toBeGreaterThan(0);
    expect(db0.contratos.some((c) => c.importeCentimos != null)).toBe(true);
    const sin = ocultarFinanzas(db0);
    expect(sin.pagos).toEqual([]);
    expect(sin.contratos.every((c) => c.importeCentimos == null && c.metodoPago == null && c.oferta === 'NINGUNA')).toBe(true);
    expect(sin.contratos).toHaveLength(db0.contratos.length);
  });
});

describe('guardarTrabajador y el acceso a las finanzas', () => {
  const laura = db0.trabajadores.find((t) => t.id === 'tra-laura')!;

  it('un administrador sin acceso no puede concederlo ni a otros ni a sí mismo: se conserva en silencio', () => {
    const conAdminSinFinanzas: Db = { ...db0, trabajadores: db0.trabajadores.map((t) => (t.id === 'tra-jose' ? { ...t, veFinanzas: false } : t.id === 'tra-ana' ? { ...t, veFinanzas: true } : t)) };
    const sesion = sesionDe(conAdminSinFinanzas, 'tra-jose');
    const r = guardarTrabajador(ctx(sesion, conAdminSinFinanzas), { trabajador: { ...laura, veFinanzas: true, telefono: '600 000 111' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const guardada = r.db.trabajadores.find((t) => t.id === 'tra-laura')!;
    expect(guardada.veFinanzas).toBe(false);
    expect(guardada.telefono).toBe('600 000 111');
    const yo = guardarTrabajador(ctx(sesion, conAdminSinFinanzas), { trabajador: { ...conAdminSinFinanzas.trabajadores.find((t) => t.id === 'tra-jose')!, veFinanzas: true } });
    expect(yo.ok && yo.db.trabajadores.find((t) => t.id === 'tra-jose')!.veFinanzas).toBe(false);
  });

  it('quien lo tiene lo concede y lo quita, pero no puede dejar a nadie con acceso', () => {
    const r1 = guardarTrabajador(ctx(jose), { trabajador: { ...laura, veFinanzas: true } });
    expect(r1.ok && r1.db.trabajadores.find((t) => t.id === 'tra-laura')!.veFinanzas).toBe(true);
    if (!r1.ok) return;
    // Con Laura dentro, José puede quitárselo a sí mismo.
    const joseFila = r1.db.trabajadores.find((t) => t.id === 'tra-jose')!;
    const r2 = guardarTrabajador(ctx(jose, r1.db), { trabajador: { ...joseFila, veFinanzas: false } });
    expect(r2.ok).toBe(true);
    // Pero no siendo el único (base original): ni quitárselo ni darse de baja.
    expect(guardarTrabajador(ctx(jose), { trabajador: { ...joseFila, veFinanzas: false } })).toMatchObject({ ok: false, error: expect.stringMatching(/al menos una persona/) });
    expect(guardarTrabajador(ctx(jose), { trabajador: { ...joseFila, activo: false } })).toMatchObject({ ok: false, error: expect.stringMatching(/al menos una persona/) });
  });
});
