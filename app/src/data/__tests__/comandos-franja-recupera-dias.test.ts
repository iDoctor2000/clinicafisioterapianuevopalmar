/**
 * 0047: una franja guardada siempre tiene sus clases. Quitar una clase (0042) vale hasta que alguien vuelva a
 * guardar la franja; el calendario enseña el hueco y deja volver a poner la clase.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { eliminarClase, generarClasesPendientes, guardarPlantilla, restaurarClaseQuitada, type Ctx } from '@/data/comandos';
import { huecosDeFranjas } from '@/features/trabajador/consultas';
import { aISODate, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const sesionDe = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, gestionaHorario: t.gestionaHorario === true };
};
const ctx = (db: Db, sesion: Sesion): Ctx => ({ db, sesion, ahora });

/** Una clase futura (dentro de más de 3 días) de una franja activa, sin nadie apuntado de fuera del horario fijo. */
function prepararQuitada() {
  const db0 = generarClasesPendientes(crearSeed(), ahora);
  const jose = sesionDe(db0, 'tra-jose');
  const clase = db0.clases
    .filter((c) => c.plantillaId && c.estado === 'PROGRAMADA' && c.fecha > sumarDias(hoy, 3) && db0.plantillas.find((p) => p.id === c.plantillaId)?.activa)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))[0]!;
  // Sin reservas, para que se pueda eliminar.
  const sinReservas: Db = { ...db0, reservas: db0.reservas.filter((r) => r.claseId !== clase.id) };
  const quitada = eliminarClase(ctx(sinReservas, jose), { claseId: clase.id });
  if (!quitada.ok) throw new Error(quitada.error);
  return { db: quitada.db, jose, clase, plantilla: db0.plantillas.find((p) => p.id === clase.plantillaId)! };
}

describe('0047 · una franja guardada recupera sus días quitados', () => {
  it('la clase quitada no vuelve sola, pero el calendario enseña el hueco con su motivo', () => {
    const { db, clase, plantilla } = prepararQuitada();
    const regenerada = generarClasesPendientes(db, ahora);
    expect(regenerada.clases.some((c) => c.plantillaId === plantilla.id && c.fecha === clase.fecha)).toBe(false);
    const huecos = huecosDeFranjas(regenerada, clase.fecha, hoy);
    expect(huecos.map((h) => [h.plantilla.id, h.motivo])).toContainEqual([plantilla.id, 'QUITADA']);
    // Los días con clase no son hueco; los días pasados tampoco.
    expect(huecosDeFranjas(regenerada, sumarDias(clase.fecha, 7), hoy).some((h) => h.plantilla.id === plantilla.id)).toBe(false);
    expect(huecosDeFranjas(regenerada, sumarDias(hoy, -7), hoy)).toEqual([]);
  });

  it('guardar la franja (p. ej. cambiar las plazas) vuelve a poner la clase, con sus alumnos fijos', () => {
    const { db, jose, clase, plantilla } = prepararQuitada();
    const r = guardarPlantilla(ctx(db, jose), { plantilla: { ...plantilla, plazas: plantilla.plazas + 1 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.recuperadas).toBe(1);
    const nueva = r.db.clases.find((c) => c.plantillaId === plantilla.id && c.fecha === clase.fecha);
    expect(nueva).toBeDefined();
    expect(nueva!.plazas).toBe(plantilla.plazas + 1);
    expect(r.db.clasesQuitadas?.some((q) => q.plantillaId === plantilla.id && q.fecha === clase.fecha)).toBe(false);
    const fijos = r.db.contratos.filter((k) => k.estado === 'ACTIVO' && k.modalidad === 'FIJO' && k.franjasFijas.some((f) => f.plantillaId === plantilla.id));
    for (const k of fijos) expect(r.db.reservas.some((x) => x.claseId === nueva!.id && x.clienteId === k.clienteId && x.estado === 'RESERVADA')).toBe(true);
    expect(r.db.auditoria[0]?.detalle).toContain('1 días quitados vuelven');
    expect(huecosDeFranjas(r.db, clase.fecha, hoy).some((h) => h.plantilla.id === plantilla.id)).toBe(false);
  });

  it('«Volver a poner la clase» desde el calendario', () => {
    const { db, jose, clase, plantilla } = prepararQuitada();
    const r = restaurarClaseQuitada(ctx(db, jose), { plantillaId: plantilla.id, fecha: clase.fecha });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nueva = r.db.clases.find((c) => c.id === r.valor.claseId)!;
    expect(nueva.plantillaId).toBe(plantilla.id);
    expect(nueva.fecha).toBe(clase.fecha);
    expect(nueva.estado).toBe('PROGRAMADA');
    expect(r.db.clasesQuitadas?.some((q) => q.plantillaId === plantilla.id && q.fecha === clase.fecha)).toBe(false);
    expect(r.db.auditoria[0]?.accion).toBe('RESTAURAR_CLASE');
    // Dos veces no: ya tiene clase.
    expect(restaurarClaseQuitada(ctx(r.db, jose), { plantillaId: plantilla.id, fecha: clase.fecha })).toMatchObject({ ok: false, error: 'Ese día ya tiene clase.' });
    // Ni un día que no le toca, ni uno pasado, ni sin permiso.
    expect(restaurarClaseQuitada(ctx(db, jose), { plantillaId: plantilla.id, fecha: sumarDias(clase.fecha, 1) })).toMatchObject({ ok: false, error: 'A esa franja no le toca clase ese día.' });
    expect(restaurarClaseQuitada(ctx(db, jose), { plantillaId: plantilla.id, fecha: sumarDias(clase.fecha, -14) })).toMatchObject({ ok: false, error: 'Ese día ya ha pasado.' });
    const sinPermiso: Sesion = { ...jose, permisos: [], rol: 'RECEPCION', gestionaHorario: false } as Sesion;
    expect(restaurarClaseQuitada(ctx(db, sinPermiso), { plantillaId: plantilla.id, fecha: clase.fecha }).ok).toBe(false);
  });
});
