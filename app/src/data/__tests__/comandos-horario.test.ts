/** guardarPlantilla: al editar una franja, las clases futuras se recrean con el nuevo horario. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { guardarPlantilla, type Ctx } from '@/data/comandos';
import { aISODate, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const sesionDe = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const ctx = (db: Db = crearSeed()): Ctx => ({ db, sesion: sesionDe(db, 'tra-jose'), ahora });

describe('guardarPlantilla: cambios aplicados a las clases futuras', () => {
  it('cambia la hora de las clases futuras sin reservas de clientes y conserva las que las tienen', () => {
    const c0 = ctx();
    const hoy = aISODate(ahora);
    const plantilla = c0.db.plantillas.find((p) => p.activa)!;
    const futuras = c0.db.clases.filter((c) => c.plantillaId === plantilla.id && c.estado === 'PROGRAMADA' && c.fecha >= hoy);
    expect(futuras.length).toBeGreaterThan(2);
    // Una clase futura con una reserva hecha por un cliente: debe conservarse.
    const conReserva = futuras.find((c) => c0.db.reservas.some((r) => r.claseId === c.id && r.estado === 'RESERVADA' && r.origen !== 'AUTOMATICA'));
    const nuevaHora = plantilla.horaInicio === '10:00' ? '11:30' : '10:00';
    const r = guardarPlantilla(c0, { plantilla: { ...plantilla, horaInicio: nuevaHora } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const despues = r.db.clases.filter((c) => c.plantillaId === plantilla.id && c.estado === 'PROGRAMADA' && c.fecha >= hoy);
    // Todas las fechas futuras siguen teniendo su clase (una por fecha), con la hora nueva salvo las conservadas.
    const fechasDespues = new Set(despues.map((c) => c.fecha));
    for (const c of futuras) expect(fechasDespues.has(c.fecha)).toBe(true);
    expect(fechasDespues.size).toBe(despues.length);
    const conservadas = despues.filter((c) => c.horaInicio !== nuevaHora);
    expect(r.valor.conservadas).toBe(conservadas.length);
    if (conReserva) {
      expect(conservadas.map((c) => c.id)).toContain(conReserva.id);
      expect(r.db.reservas.filter((x) => x.claseId === conReserva.id).length).toBeGreaterThan(0);
    }
    // Las clases pasadas no se tocan.
    const pasadasAntes = c0.db.clases.filter((c) => c.plantillaId === plantilla.id && c.fecha < hoy).map((c) => c.id).sort();
    const pasadasDespues = r.db.clases.filter((c) => c.plantillaId === plantilla.id && c.fecha < hoy).map((c) => c.id).sort();
    expect(pasadasDespues).toEqual(pasadasAntes);
  });

  it('las reservas automáticas (horario fijo) se regeneran en las clases nuevas', () => {
    const c0 = ctx();
    const hoy = aISODate(ahora);
    const contratoFijo = c0.db.contratos.find((c) => c.estado === 'ACTIVO' && c.modalidad === 'FIJO' && c.franjasFijas.length > 0);
    if (!contratoFijo) return; // la demo siempre tiene uno; si no, no hay nada que comprobar
    const plantillaId = contratoFijo.franjasFijas[0].plantillaId;
    const plantilla = c0.db.plantillas.find((p) => p.id === plantillaId)!;
    // Solo fechas estrictamente futuras: la clase de hoy a las 07:15 ya habría empezado y no se le generaría reserva.
    const antes = c0.db.reservas.filter((r) => r.contratoId === contratoFijo.id && r.origen === 'AUTOMATICA' && r.estado === 'RESERVADA' && c0.db.clases.some((c) => c.id === r.claseId && c.plantillaId === plantillaId && c.fecha > hoy)).length;
    const r = guardarPlantilla(c0, { plantilla: { ...plantilla, horaInicio: '07:15' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const despues = r.db.reservas.filter((x) => x.contratoId === contratoFijo.id && x.origen === 'AUTOMATICA' && x.estado === 'RESERVADA' && r.db.clases.some((c) => c.id === x.claseId && c.plantillaId === plantillaId && c.fecha > hoy && c.horaInicio === '07:15'));
    expect(despues.length).toBe(antes);
  });

  it('crear una franja nueva no conserva nada y genera sus clases', () => {
    const c0 = ctx();
    const base = c0.db.plantillas[0];
    const r = guardarPlantilla(c0, { plantilla: { ...base, id: undefined, diaSemana: 6, horaInicio: '09:00' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.conservadas).toBe(0);
    expect(r.db.clases.some((c) => c.plantillaId === r.valor.plantilla.id && c.horaInicio === '09:00')).toBe(true);
    expect(sumarDias(aISODate(ahora), 1) > aISODate(ahora)).toBe(true);
  });
});
