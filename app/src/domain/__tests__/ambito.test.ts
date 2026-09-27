import { describe, expect, it } from 'vitest';
import type { Aviso, Cliente, Sesion, Trabajador } from '../types';
import {
  alcanceAvisos, alcanceClases, alcanceClientes, alcancePlantillas, alumnosDe, ambitoDe, esAlumnoMio, limitadoASusClases,
  puedeGestionarClase, recortarAlAmbito,
} from '../ambito';
import { clase, plantilla, reserva } from './fixtures';

const trabajador = (over: Partial<Trabajador>): Trabajador => ({
  id: 'w1', nombre: 'Ana', apellidos: 'M', email: 'a@x', telefono: '', rol: 'MONITOR', permisos: [], ambito: 'SUS_CLASES', esMonitor: true, color: '#000', activo: true, userId: 'u-w1', ...over,
});
const cliente = (id: string): Cliente => ({
  id, nombre: id, apellidos: '', dni: '', direccion: '', email: '', telefono: '', clinica: { lesiones: '', patologias: '', observaciones: '', actualizadaEl: null },
  notificacionesPush: true, activo: true, userId: null, altaEl: '2026-01-01', bajaEl: null, fotoUrl: null,
});
const aviso = (id: string, over: Partial<Aviso>): Aviso => ({ id, titulo: id, cuerpo: '', destino: { tipo: 'TODOS' }, destinatariosIds: [], importante: false, publicadoEl: '2026-09-01T00:00:00.000Z', publicadoPor: 'u-admin', ...over });

const db = {
  trabajadores: [trabajador({ id: 'w1' }), trabajador({ id: 'w2', ambito: 'CENTRO' }), trabajador({ id: 'adm', rol: 'ADMIN', ambito: 'SUS_CLASES' })],
  clases: [clase({ id: 'k1', monitorId: 'w1' }), clase({ id: 'k2', monitorId: 'w2' }), clase({ id: 'k3', monitorId: 'w1', fecha: '2026-10-08' })],
  plantillas: [plantilla({ id: 'p1', monitorId: 'w1' }), plantilla({ id: 'p2', monitorId: 'w2' })],
  reservas: [reserva({ id: 'r1', claseId: 'k1', clienteId: 'cli1' }), reserva({ id: 'r2', claseId: 'k2', clienteId: 'cli2' }), reserva({ id: 'r3', claseId: 'k3', clienteId: 'cli3', estado: 'CANCELADA_RECUPERABLE' })],
  clientes: [cliente('cli1'), cliente('cli2'), cliente('cli3')],
  contratos: [{ clienteId: 'cli1' }, { clienteId: 'cli2' }],
  recuperaciones: [{ clienteId: 'cli2' }, { clienteId: 'cli3' }],
  lecturas: [{ clienteId: 'cli2' }],
  avisos: [
    aviso('a-todos', {}),
    aviso('a-mio', { publicadoPor: 'u-w1', destino: { tipo: 'CLIENTES', clienteIds: ['cli1'] } }),
    aviso('a-k1', { destino: { tipo: 'CLASE', claseId: 'k1' } }),
    aviso('a-k2', { destino: { tipo: 'CLASE', claseId: 'k2' } }),
  ],
};

const sesion = (over: Partial<Extract<Sesion, { tipo: 'TRABAJADOR' }>> = {}): Sesion => ({ tipo: 'TRABAJADOR', userId: 'u-w1', trabajadorId: 'w1', nombre: 'Ana', permisos: [], rol: 'MONITOR', ...over });
const ana = sesion({ ambito: 'SUS_CLASES' });
const anaSinAmbito = sesion(); // como la construye la demo: se resuelve desde la ficha
const centro = sesion({ trabajadorId: 'w2', userId: 'u-w2', ambito: 'CENTRO' });
const admin = sesion({ trabajadorId: 'adm', userId: 'u-adm', rol: 'ADMIN', ambito: 'SUS_CLASES' });
const clienteSesion: Sesion = { tipo: 'CLIENTE', userId: 'u-c', clienteId: 'cli1', nombre: 'C' };

describe('ambitoDe', () => {
  it('usa el ámbito de la sesión y, si falta, el de la ficha', () => {
    expect(ambitoDe(db, ana)).toBe('SUS_CLASES');
    expect(ambitoDe(db, anaSinAmbito)).toBe('SUS_CLASES');
    expect(ambitoDe(db, centro)).toBe('CENTRO');
    expect(ambitoDe({ trabajadores: [] }, anaSinAmbito)).toBe('CENTRO');
  });
  it('un ADMIN siempre es CENTRO aunque su ficha o sesión digan otra cosa', () => {
    expect(ambitoDe(db, admin)).toBe('CENTRO');
    expect(limitadoASusClases(db, admin)).toBe(false);
  });
  it('clientes y sesión nula no tienen ámbito', () => {
    expect(ambitoDe(db, clienteSesion)).toBeNull();
    expect(ambitoDe(db, null)).toBeNull();
    expect(limitadoASusClases(db, null)).toBe(false);
  });
});

describe('puedeGestionarClase', () => {
  it('SUS_CLASES: solo las clases que imparte', () => {
    expect(puedeGestionarClase(db, ana, db.clases[0])).toBe(true);
    expect(puedeGestionarClase(db, ana, db.clases[1])).toBe(false);
    expect(puedeGestionarClase(db, anaSinAmbito, db.clases[1])).toBe(false);
  });
  it('CENTRO y ADMIN: cualquier clase; un cliente ninguna', () => {
    expect(puedeGestionarClase(db, centro, db.clases[0])).toBe(true);
    expect(puedeGestionarClase(db, admin, db.clases[1])).toBe(true);
    expect(puedeGestionarClase(db, clienteSesion, db.clases[0])).toBe(false);
  });
});

describe('alcance', () => {
  it('clases y franjas', () => {
    expect(alcanceClases(db, ana).map((c) => c.id)).toEqual(['k1', 'k3']);
    expect(alcanceClases(db, centro)).toBe(db.clases);
    expect(alcancePlantillas(db, ana).map((p) => p.id)).toEqual(['p1']);
    expect(alcancePlantillas(db, admin)).toBe(db.plantillas);
  });
  it('alumnos: clientes con alguna reserva (en cualquier estado) en una clase suya', () => {
    expect(Array.from(alumnosDe(db, ana)!).sort()).toEqual(['cli1', 'cli3']);
    expect(alumnosDe(db, centro)).toBeNull();
    expect(esAlumnoMio(db, ana, 'cli1')).toBe(true);
    expect(esAlumnoMio(db, ana, 'cli2')).toBe(false);
    expect(esAlumnoMio(db, centro, 'cli2')).toBe(true);
    expect(esAlumnoMio(db, clienteSesion, 'cli1')).toBe(false);
    expect(alcanceClientes(db, ana).map((c) => c.id)).toEqual(['cli1', 'cli3']);
  });
  it('avisos: los publicados por el trabajador o dirigidos a sus clases', () => {
    expect(alcanceAvisos(db, ana).map((a) => a.id)).toEqual(['a-mio', 'a-k1']);
    expect(alcanceAvisos(db, centro)).toBe(db.avisos);
  });
});

describe('recortarAlAmbito', () => {
  it('con CENTRO devuelve la misma instantánea', () => {
    expect(recortarAlAmbito(db, centro)).toBe(db);
    expect(recortarAlAmbito(db, admin)).toBe(db);
  });
  it('con SUS_CLASES deja solo lo que alcanza el trabajador', () => {
    const r = recortarAlAmbito(db, ana);
    expect(r.clases.map((c) => c.id)).toEqual(['k1', 'k3']);
    expect(r.plantillas.map((p) => p.id)).toEqual(['p1']);
    expect(r.reservas.map((x) => x.id)).toEqual(['r1', 'r3']);
    expect(r.clientes.map((c) => c.id)).toEqual(['cli1', 'cli3']);
    expect(r.contratos).toEqual([{ clienteId: 'cli1' }]);
    expect(r.recuperaciones).toEqual([{ clienteId: 'cli3' }]);
    expect(r.lecturas).toEqual([]);
    expect(r.avisos.map((a) => a.id)).toEqual(['a-mio', 'a-k1']);
    expect(r.trabajadores).toBe(db.trabajadores);
  });
});
