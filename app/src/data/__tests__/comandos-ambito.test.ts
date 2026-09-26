/** Comandos: comprobación de ámbito (SUS_CLASES) y gestión del equipo solo ADMIN. */
import { describe, expect, it } from 'vitest';
import type { Sesion, Trabajador } from '@/domain/types';
import { MENSAJE_AVISO_LIMITADO, MENSAJE_CLASE_AJENA, MENSAJE_CLASE_EXTRA_LIMITADA, MENSAJE_HORARIO_LIMITADO, MENSAJE_SOLO_ADMIN_EQUIPO } from '@/domain/ambito';
import { crearSeed } from '@/data/seed';
import {
  anadirAlumno, cancelarClase, cancelarReserva, crearClaseExtraordinaria, guardarPlantilla, guardarTrabajador, publicarAviso, quitarAlumno,
  registrarAsistencia, reservar, type Ctx,
} from '@/data/comandos';
import type { Db } from '@/data/db';

function sesionDe(db: Db, id: string): Sesion {
  const t = db.trabajadores.find((x) => x.id === id)!;
  // Igual que la demo (store.ts): sin `ambito`; los comandos lo resuelven desde la ficha.
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
}

const db0 = crearSeed();
const ahora = new Date();
const ana = sesionDe(db0, 'tra-ana');   // MONITOR, SUS_CLASES
const jose = sesionDe(db0, 'tra-jose'); // ADMIN
const laura = sesionDe(db0, 'tra-laura'); // RECEPCION, CENTRO
const ctx = (sesion: Sesion, db: Db = db0): Ctx => ({ db, sesion, ahora });

const claseDe = (db: Db, monitorId: string, conReserva: boolean) => db.clases.find((c) => c.monitorId === monitorId && c.estado === 'PROGRAMADA' && c.fecha > '2000' && (!conReserva || db.reservas.some((r) => r.claseId === c.id && r.estado === 'RESERVADA')) && new Date(`${c.fecha}T${c.horaInicio}:00`) > ahora)!;
const claseAjena = claseDe(db0, 'tra-jose', true);
const claseMia = claseDe(db0, 'tra-ana', true);
const reservaAjena = db0.reservas.find((r) => r.claseId === claseAjena.id && r.estado === 'RESERVADA')!;
const reservaMia = db0.reservas.find((r) => r.claseId === claseMia.id && r.estado === 'RESERVADA')!;

describe('seed de demo', () => {
  it('Ana tiene ámbito SUS_CLASES y clases propias y ajenas con alumnos', () => {
    expect(db0.trabajadores.find((t) => t.id === 'tra-ana')?.ambito).toBe('SUS_CLASES');
    expect(claseAjena).toBeDefined();
    expect(claseMia).toBeDefined();
    expect(reservaAjena).toBeDefined();
    expect(reservaMia).toBeDefined();
  });
});

describe('ámbito SUS_CLASES en los comandos', () => {
  it('registrarAsistencia: solo en sus clases', () => {
    expect(registrarAsistencia(ctx(ana), { reservaId: reservaAjena.id, asistencia: 'ASISTE' })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    const r = registrarAsistencia(ctx(ana), { reservaId: reservaMia.id, asistencia: 'ASISTE' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.db.reservas.find((x) => x.id === reservaMia.id)?.asistencia).toBe('ASISTE');
  });
  it('anadirAlumno / reservar / quitarAlumno / cancelarReserva: solo en sus clases', () => {
    const cliente = db0.clientes.find((c) => c.activo && !db0.reservas.some((r) => r.claseId === claseAjena.id && r.clienteId === c.id))!;
    expect(anadirAlumno(ctx(ana), { claseId: claseAjena.id, clienteId: cliente.id, modo: 'MANUAL' })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    expect(anadirAlumno(ctx(ana), { claseId: claseAjena.id, clienteId: cliente.id, modo: 'CLASE_SUELTA' })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    expect(anadirAlumno(ctx(ana), { claseId: claseAjena.id, clienteId: cliente.id, modo: 'TARIFA' })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    expect(reservar(ctx(ana), { claseId: claseAjena.id, clienteId: cliente.id })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    expect(quitarAlumno(ctx(ana), { reservaId: reservaAjena.id })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    expect(cancelarReserva(ctx(ana), { reservaId: reservaAjena.id })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    // En una clase suya funciona con normalidad.
    const clienteLibre = db0.clientes.find((c) => c.activo && !db0.reservas.some((r) => r.claseId === claseMia.id && r.clienteId === c.id))!;
    const r = anadirAlumno(ctx(ana), { claseId: claseMia.id, clienteId: clienteLibre.id, modo: 'MANUAL' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(quitarAlumno(ctx(ana, r.db), { reservaId: r.valor.id }).ok).toBe(true);
  });
  it('cancelarClase: solo sus clases (Ana no tiene el permiso; se prueba con un monitor limitado que sí lo tiene)', () => {
    const db = { ...db0, trabajadores: db0.trabajadores.map((t) => (t.id === 'tra-ana' ? { ...t, permisos: [...t.permisos, 'CLASES_CREAR_CANCELAR' as const] } : t)) };
    const anaConPermiso = sesionDe(db, 'tra-ana');
    expect(cancelarClase(ctx(anaConPermiso, db), { claseId: claseAjena.id, motivo: 'x', claseAlternativaId: null, avisar: false })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    expect(cancelarClase(ctx(anaConPermiso, db), { claseId: claseMia.id, motivo: 'x', claseAlternativaId: null, avisar: false }).ok).toBe(true);
    expect(crearClaseExtraordinaria(ctx(anaConPermiso, db), { actividadId: 'act-suelo', fecha: '2030-01-07', horaInicio: '10:00', duracionMin: 55, monitorId: 'tra-ana', plazas: 8 })).toEqual({ ok: false, error: MENSAJE_CLASE_EXTRA_LIMITADA });
  });
  it('publicarAviso: solo destino CLASE de una clase suya', () => {
    expect(publicarAviso(ctx(ana), { titulo: 't', cuerpo: 'c', destino: { tipo: 'TODOS' }, importante: false })).toEqual({ ok: false, error: MENSAJE_AVISO_LIMITADO });
    expect(publicarAviso(ctx(ana), { titulo: 't', cuerpo: 'c', destino: { tipo: 'ACTIVIDAD', actividadId: 'act-suelo' }, importante: false })).toEqual({ ok: false, error: MENSAJE_AVISO_LIMITADO });
    expect(publicarAviso(ctx(ana), { titulo: 't', cuerpo: 'c', destino: { tipo: 'CLIENTES', clienteIds: [reservaMia.clienteId] }, importante: false })).toEqual({ ok: false, error: MENSAJE_AVISO_LIMITADO });
    expect(publicarAviso(ctx(ana), { titulo: 't', cuerpo: 'c', destino: { tipo: 'CLASE', claseId: claseAjena.id }, importante: false })).toEqual({ ok: false, error: MENSAJE_CLASE_AJENA });
    const r = publicarAviso(ctx(ana), { titulo: 't', cuerpo: 'c', destino: { tipo: 'CLASE', claseId: claseMia.id }, importante: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.destinatariosIds).toContain(reservaMia.clienteId);
  });
  it('guardarPlantilla: sin escritura de horarios con SUS_CLASES aunque tenga el permiso', () => {
    const db = { ...db0, trabajadores: db0.trabajadores.map((t) => (t.id === 'tra-ana' ? { ...t, permisos: [...t.permisos, 'HORARIOS_GESTIONAR' as const] } : t)) };
    const p = db.plantillas.find((x) => x.monitorId === 'tra-ana')!;
    expect(guardarPlantilla(ctx(sesionDe(db, 'tra-ana'), db), { plantilla: { ...p, plazas: 12 } })).toEqual({ ok: false, error: MENSAJE_HORARIO_LIMITADO });
  });
  it('un trabajador con ámbito CENTRO no se ve afectado', () => {
    expect(registrarAsistencia(ctx(jose), { reservaId: reservaMia.id, asistencia: 'NO_ASISTE' }).ok).toBe(true);
    expect(publicarAviso(ctx(laura), { titulo: 't', cuerpo: 'c', destino: { tipo: 'TODOS' }, importante: false }).ok).toBe(true);
  });
});

describe('guardarTrabajador: exclusivo del rol ADMIN', () => {
  const nuevo: Omit<Trabajador, 'id'> = { nombre: 'María', apellidos: 'Yoga', email: 'maria@x', telefono: '', rol: 'MONITOR', permisos: ['ASISTENCIA_REGISTRAR'], ambito: 'SUS_CLASES', esMonitor: true, color: '#000', activo: true, userId: null };
  it('el permiso TRABAJADORES_GESTIONAR ya no basta', () => {
    const db = { ...db0, trabajadores: db0.trabajadores.map((t) => (t.id === 'tra-laura' ? { ...t, permisos: [...t.permisos, 'TRABAJADORES_GESTIONAR' as const] } : t)) };
    expect(guardarTrabajador(ctx(sesionDe(db, 'tra-laura'), db), { trabajador: nuevo })).toEqual({ ok: false, error: MENSAJE_SOLO_ADMIN_EQUIPO });
    expect(guardarTrabajador(ctx(ana), { trabajador: nuevo })).toEqual({ ok: false, error: MENSAJE_SOLO_ADMIN_EQUIPO });
  });
  it('el ADMIN crea trabajadores con ámbito y un ADMIN siempre queda en CENTRO', () => {
    const r = guardarTrabajador(ctx(jose), { trabajador: nuevo });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.ambito).toBe('SUS_CLASES');
    const r2 = guardarTrabajador(ctx(jose), { trabajador: { ...nuevo, rol: 'ADMIN', ambito: 'SUS_CLASES' } });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.valor.ambito).toBe('CENTRO');
  });
});
