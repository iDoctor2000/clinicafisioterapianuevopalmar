/**
 * Con servidor: tras guardar o borrar un cobro solo se vuelven a leer los cobros (no todo el centro), y las
 * recargas completas que se piden a la vez se juntan (no se lanzan varias en paralelo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearSeed } from '@/data/seed';

const llamadas = { cargarDb: 0, cargarPagos: 0, enCurso: 0, maxEnCurso: 0 };
const db0 = crearSeed();
const jose = db0.trabajadores.find((t) => t.id === 'tra-jose')!;

vi.mock('@/data/supabase/cliente', () => ({ hayServidor: () => true, servidor: () => ({ rpc: () => Promise.resolve({}) }), mensajeError: (e: unknown) => String(e) }));
vi.mock('@/data/supabase/tiempoReal', () => ({ activarTiempoReal: () => () => undefined }));
vi.mock('@/data/supabase/push', () => ({ enviarPushPendientes: () => Promise.resolve(), invocarEnvioPush: () => Promise.resolve({ fallidas: 0, borradas: 0 }) }));
vi.mock('@/data/supabase/comandos', () => ({ ejecutarRemoto: async () => ({ ok: true, valor: () => undefined }) }));
vi.mock('@/data/supabase/cargar', () => ({
  cargarDb: async () => {
    llamadas.cargarDb += 1;
    llamadas.enCurso += 1;
    llamadas.maxEnCurso = Math.max(llamadas.maxEnCurso, llamadas.enCurso);
    await new Promise((r) => setTimeout(r, 20));
    llamadas.enCurso -= 1;
    return db0;
  },
  cargarPagos: async () => { llamadas.cargarPagos += 1; return db0.pagos.slice(0, 1); },
}));
vi.mock('@/data/supabase/auth', () => ({
  haySesionViva: async () => true,
  sesionDesdeUsuario: () => ({ tipo: 'TRABAJADOR', userId: jose.userId, trabajadorId: jose.id, nombre: jose.nombre, permisos: jose.permisos, rol: jose.rol, veFinanzas: true, gestionaHorario: true }),
  usuarioActual: async () => ({ id: jose.userId, email: jose.email }),
  suscribirAuth: () => () => undefined,
  limpiarUrlTrasAcceso: () => undefined,
  SESION_CADUCADA: 'caducada',
}));

const { useStore } = await import('@/data/store');

describe('recargas con servidor', () => {
  beforeEach(async () => {
    await useStore.getState().arrancar();
    Object.assign(llamadas, { cargarDb: 0, cargarPagos: 0, enCurso: 0, maxEnCurso: 0 });
  });

  it('guardar o borrar un cobro solo vuelve a leer los cobros', async () => {
    const p = db0.pagos[0];
    const r = await useStore.getState().ejecutar('guardarPago', { pago: { ...p } });
    expect(r.ok).toBe(true);
    await useStore.getState().ejecutar('borrarPago', { id: p.id });
    expect(llamadas).toMatchObject({ cargarPagos: 2, cargarDb: 0 });
    expect(useStore.getState().db.pagos).toHaveLength(1);
  });

  it('otros comandos recargan todo, y varias recargas a la vez se juntan', async () => {
    await useStore.getState().ejecutar('marcarAvisoLeido', { avisoId: 'x' });
    expect(llamadas.cargarDb).toBe(1);
    Object.assign(llamadas, { cargarDb: 0, maxEnCurso: 0 });
    await Promise.all([useStore.getState().recargar(), useStore.getState().recargar(), useStore.getState().recargar(), useStore.getState().recargar()]);
    expect(llamadas.maxEnCurso).toBe(1);
    expect(llamadas.cargarDb).toBeLessThanOrEqual(2);
  });
});
