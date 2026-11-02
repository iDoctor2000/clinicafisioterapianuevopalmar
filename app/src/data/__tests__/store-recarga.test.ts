/**
 * Con servidor: tras guardar o borrar un cobro solo se vuelven a leer los cobros (no todo el centro), y las
 * recargas completas que se piden a la vez se juntan (no se lanzan varias en paralelo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearSeed } from '@/data/seed';

const llamadas = { cargarDb: 0, cargarPagos: 0, enCurso: 0, maxEnCurso: 0, remotas: [] as string[] };
const db0 = crearSeed();
const jose = db0.trabajadores.find((t) => t.id === 'tra-jose')!;

const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
vi.mock('@/data/supabase/cliente', () => ({ hayServidor: () => true, servidor: () => ({ rpc: (nombre: string, args: Record<string, unknown>) => { rpcs.push({ nombre, args }); return Promise.resolve({}); } }), mensajeError: (e: unknown) => String(e) }));
vi.mock('@/data/supabase/tiempoReal', () => ({ activarTiempoReal: () => () => undefined }));
vi.mock('@/data/supabase/push', () => ({ enviarPushPendientes: () => Promise.resolve(), invocarEnvioPush: () => Promise.resolve({ fallidas: 0, borradas: 0 }) }));
vi.mock('@/data/supabase/comandos', () => ({
  ejecutarRemoto: async (nombre: string, args: unknown) => {
    llamadas.remotas.push(`${nombre} ${JSON.stringify(args)}`);
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, valor: () => `hecho ${llamadas.remotas.length}` };
  },
}));
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

const { useStore, anotarApertura } = await import('@/data/store');

describe('recargas con servidor', () => {
  beforeEach(async () => {
    await useStore.getState().arrancar();
    Object.assign(llamadas, { cargarDb: 0, cargarPagos: 0, enCurso: 0, maxEnCurso: 0, remotas: [] });
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

  it('un doble toque no manda la orden dos veces: la segunda recibe el resultado de la primera', async () => {
    const { ejecutar } = useStore.getState();
    const [a, b] = await Promise.all([ejecutar('reservar', { claseId: 'cla-1' }), ejecutar('reservar', { claseId: 'cla-1' })]);
    expect(llamadas.remotas).toEqual(['reservar {"claseId":"cla-1"}']);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    // Con otros datos sí se manda; y cuando la primera ha terminado, la misma orden se puede repetir.
    await Promise.all([ejecutar('reservar', { claseId: 'cla-1' }), ejecutar('reservar', { claseId: 'cla-2' })]);
    expect(llamadas.remotas).toHaveLength(3);
    expect(llamadas.remotas.slice(1).sort()).toEqual(['reservar {"claseId":"cla-1"}', 'reservar {"claseId":"cla-2"}']);
  });

  it('0048: al abrir la app, el equipo anota su versión (como mucho una vez cada media hora); los alumnos no', () => {
    const aperturas = () => rpcs.filter((r) => r.nombre === 'registrar_apertura');
    // Al arrancar con sesión de equipo ya se ha anotado una (beforeEach → arrancar).
    expect(aperturas().length).toBeGreaterThanOrEqual(1);
    expect(aperturas()[0].args).toMatchObject({ p_version: expect.any(String), p_navegador: expect.any(String), p_instalada: false });
    const n = aperturas().length;
    const sesion = useStore.getState().sesion;
    anotarApertura(sesion);
    expect(aperturas()).toHaveLength(n);
    anotarApertura(sesion, Date.now() + 31 * 60 * 1000);
    expect(aperturas()).toHaveLength(n + 1);
    anotarApertura({ tipo: 'CLIENTE', userId: 'u', clienteId: 'c', nombre: 'A' }, Date.now() + 120 * 60 * 1000);
    expect(aperturas()).toHaveLength(n + 1);
  });
});
