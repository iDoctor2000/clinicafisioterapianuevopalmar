/** Comando actualizarConfig (demo): solo el administrador; guarda cualquier subconjunto de campos. */
import { describe, expect, it } from 'vitest';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { actualizarConfig, type Ctx } from '@/data/comandos';

const db0 = crearSeed();
const ahora = new Date();
const sesionDe = (id: string): Sesion => {
  const t = db0.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const ctx = (sesion: Sesion): Ctx => ({ db: db0, sesion, ahora });

describe('actualizarConfig', () => {
  it('el administrador cambia las reglas y queda auditado con los campos tocados', () => {
    const r = actualizarConfig(ctx(sesionDe('tra-jose')), { config: { minutosAntelacionCancelacion: 120, diasVentanaReserva: 21 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.config).toMatchObject({ ...db0.config, minutosAntelacionCancelacion: 120, diasVentanaReserva: 21 });
    expect(r.db.auditoria[0]).toMatchObject({ accion: 'CONFIG', detalle: 'minutosAntelacionCancelacion,diasVentanaReserva' });
  });
  it('cambiar la caducidad de las recuperaciones no toca los días de cierre', () => {
    const r = actualizarConfig(ctx(sesionDe('tra-jose')), { config: { recuperacionCaducaConContrato: false, diasCaducidadRecuperacion: 45 } });
    expect(r.ok && r.db.config.diasCierre).toEqual(db0.config.diasCierre);
    expect(r.ok && r.db.config.diasCaducidadRecuperacion).toBe(45);
  });
  it('recepción y monitores no pueden', () => {
    expect(actualizarConfig(ctx(sesionDe('tra-laura')), { config: { diasVentanaReserva: 30 } })).toEqual({ ok: false, error: 'Solo el administrador puede cambiar la configuración.' });
    expect(actualizarConfig(ctx(sesionDe('tra-ana')), { config: { diasVentanaReserva: 30 } })).toEqual({ ok: false, error: 'Solo el administrador puede cambiar la configuración.' });
  });
});
