/** 0032: volver a una clase que se había cancelado anula la recuperación que dio esa cancelación. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { anadirAlumno, quitarAlumno } from '@/data/comandos';
import { aISODate, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const trabajador = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};

describe('volver a la misma clase', () => {
  it('quitar y volver a apuntar: la recuperación que dio quitarle se anula; otras recuperaciones no se tocan', () => {
    const db = crearSeed();
    const ctx = { db, sesion: trabajador(db, 'tra-jose'), ahora };
    // Una reserva fija de Juan dentro de unos días (con antelación de sobra).
    const reserva = db.reservas.find((r) => r.clienteId === 'juan' && r.estado === 'RESERVADA' && r.origen === 'AUTOMATICA'
      && db.clases.some((c) => c.id === r.claseId && c.fecha >= sumarDias(hoy, 2)))!;
    const disponiblesAntes = db.recuperaciones.filter((x) => x.clienteId === 'juan' && x.estado === 'DISPONIBLE').length;
    const r1 = quitarAlumno(ctx, { reservaId: reserva.id });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const generada = r1.db.recuperaciones.find((x) => x.reservaOrigenId === reserva.id);
    expect(generada?.estado).toBe('DISPONIBLE');
    const r2 = anadirAlumno({ ...ctx, db: r1.db }, { claseId: reserva.claseId, clienteId: 'juan', modo: 'MANUAL' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.db.recuperaciones.some((x) => x.reservaOrigenId === reserva.id)).toBe(false);
    expect(r2.db.recuperaciones.filter((x) => x.clienteId === 'juan' && x.estado === 'DISPONIBLE').length).toBe(disponiblesAntes);
  });
});
