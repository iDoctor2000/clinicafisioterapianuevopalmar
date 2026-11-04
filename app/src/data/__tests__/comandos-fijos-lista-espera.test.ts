/**
 * 0050: un alumno fijo sin plaza en su clase (completa) queda el primero en la lista de espera; si se libera
 * sitio entra solo, con su horario fijo, y puede cancelar sin perder la clase. Si sale de esa lista, no vuelve.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Clase, Reserva, Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { apuntarListaEspera, cancelarReserva, generarClasesPendientes, rehacerReservasFijas, salirListaEspera } from '@/data/comandos';
import { listaEsperaDeClase } from '@/features/trabajador/consultas';
import { posicionEnLista } from '@/features/cliente/consultas';
import { aISODate, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const jose = (db: Db): Sesion => {
  const t = db.trabajadores.find((x) => x.id === 'tra-jose')!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, gestionaHorario: t.gestionaHorario === true };
};
const alumno = (db: Db, id: string): Sesion => {
  const c = db.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId ?? `usr-${id}`, clienteId: c.id, nombre: c.nombre };
};
const manual = (clase: Clase, clienteId: string, id: string): Reserva => ({
  id, claseId: clase.id, clienteId, contratoId: null, origen: 'MANUAL', estado: 'RESERVADA', asistencia: 'PENDIENTE',
  recuperacionUsadaId: null, creadaEl: ahora.toISOString(), creadaPor: 'tra-jose', canceladaEl: null, canceladaPor: null,
});

/** Dos clases fijas futuras de Juan (con más de 3 días de margen), completas y sin Juan: solo Lucía ocupa su única plaza. */
function preparar() {
  const db0 = crearSeed();
  const k = db0.contratos.find((c) => c.clienteId === 'juan' && c.estado === 'ACTIVO' && c.modalidad === 'FIJO')!;
  const franjas = new Set(k.franjasFijas.map((f) => f.plantillaId));
  const [c1, c2] = db0.clases
    .filter((c) => c.plantillaId && franjas.has(c.plantillaId) && c.estado === 'PROGRAMADA' && c.fecha > sumarDias(hoy, 3) && c.fecha <= k.fechaFin)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const llenas = new Set([c1.id, c2.id]);
  const db: Db = {
    ...db0,
    clases: db0.clases.map((c) => (llenas.has(c.id) ? { ...c, plazas: 1 } : c)),
    reservas: [...db0.reservas.filter((r) => !llenas.has(r.claseId)), manual(c1, 'lucia', 'res-lucia-1'), manual(c2, 'lucia', 'res-lucia-2')],
  };
  return { db, k, c1, c2 };
}

describe('0050 · alumnos fijos en la lista de espera de su clase completa', () => {
  it('sin plaza va a la lista, el primero aunque otros llegaran antes; si se libera sitio entra solo y puede cancelar sin perder la clase', () => {
    const p = preparar();
    // María (turno libre) ya esperaba.
    const espera = apuntarListaEspera({ db: p.db, sesion: alumno(p.db, 'maria'), ahora: new Date(ahora.getTime() - 3600_000) }, { claseId: p.c1.id });
    expect(espera.ok).toBe(true);
    if (!espera.ok) return;
    const r = rehacerReservasFijas({ db: espera.db, sesion: jose(espera.db), ahora }, { contratoId: p.k.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.reservas.some((x) => x.claseId === p.c1.id && x.clienteId === 'juan' && x.estado === 'RESERVADA')).toBe(false);
    const lista = listaEsperaDeClase(r.db, p.c1.id);
    expect(lista.map((e) => [e.entrada.clienteId, e.posicion, !!e.entrada.contratoFijoId])).toEqual([['juan', 1, true], ['maria', 2, false]]);
    const deJuan = r.db.listaEspera.find((e) => e.claseId === p.c1.id && e.clienteId === 'juan')!;
    expect(posicionEnLista(r.db, deJuan)).toBe(1);

    // Lucía cancela: la plaza es para Juan, con su horario fijo, y se le avisa.
    const c = cancelarReserva({ db: r.db, sesion: alumno(r.db, 'lucia'), ahora }, { reservaId: 'res-lucia-1' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const suya = c.db.reservas.find((x) => x.claseId === p.c1.id && x.clienteId === 'juan' && x.estado === 'RESERVADA')!;
    expect(suya).toMatchObject({ origen: 'AUTOMATICA', contratoId: p.k.id, cancelacionLibre: true });
    expect(c.db.listaEspera.some((e) => e.claseId === p.c1.id && e.clienteId === 'juan')).toBe(false);
    expect(c.db.listaEspera.some((e) => e.claseId === p.c1.id && e.clienteId === 'maria')).toBe(true);
    expect(c.db.avisos[0]).toMatchObject({ destinatariosIds: ['juan'] });
    expect(c.db.avisos[0].cuerpo).toMatch(/clase fija.*no pierdes la clase/);

    // Juan cancela tarde (antelación mínima enorme): aun así no pierde la clase.
    const tarde: Db = { ...c.db, config: { ...c.db.config, minutosAntelacionCancelacion: 100_000 } };
    const cj = cancelarReserva({ db: tarde, sesion: alumno(tarde, 'juan'), ahora }, { reservaId: suya.id });
    expect(cj.ok && cj.valor.recuperable).toBe(true);
    // Y no se le vuelve a apuntar a esa clase ni a su lista.
    if (!cj.ok) return;
    const noche = generarClasesPendientes(cj.db, ahora);
    expect(noche.listaEspera.some((e) => e.claseId === p.c1.id && e.clienteId === 'juan')).toBe(false);
    expect(noche.reservas.some((x) => x.claseId === p.c1.id && x.clienteId === 'juan' && x.estado === 'RESERVADA')).toBe(false);
  });

  it('una reserva normal cancelada igual de tarde sí se pierde (la regla de siempre no cambia)', () => {
    const p = preparar();
    const tarde: Db = { ...p.db, config: { ...p.db.config, minutosAntelacionCancelacion: 100_000 } };
    const c = cancelarReserva({ db: tarde, sesion: alumno(tarde, 'lucia'), ahora }, { reservaId: 'res-lucia-2' });
    expect(c.ok && c.valor.recuperable).toBe(false);
  });

  it('si sale de la lista de su clase fija, el mantenimiento no le vuelve a apuntar', () => {
    const p = preparar();
    const noche = generarClasesPendientes(p.db, ahora);
    expect(noche.listaEspera.some((e) => e.claseId === p.c2.id && e.clienteId === 'juan' && !!e.contratoFijoId)).toBe(true);
    const s = salirListaEspera({ db: noche, sesion: alumno(noche, 'juan'), ahora }, { claseId: p.c2.id });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.db.listaEsperaRechazos).toContainEqual({ claseId: p.c2.id, clienteId: 'juan' });
    const otraNoche = generarClasesPendientes(s.db, ahora);
    expect(otraNoche.listaEspera.some((e) => e.claseId === p.c2.id && e.clienteId === 'juan')).toBe(false);
  });

  it('a menos de 2 horas de la clase no se le apunta a la lista', () => {
    const p = preparar();
    const casi = new Date(new Date(`${p.c1.fecha}T${p.c1.horaInicio}:00`).getTime() - 60 * 60 * 1000);
    const noche = generarClasesPendientes(p.db, casi);
    expect(noche.listaEspera.some((e) => e.claseId === p.c1.id && e.clienteId === 'juan')).toBe(false);
  });
});
