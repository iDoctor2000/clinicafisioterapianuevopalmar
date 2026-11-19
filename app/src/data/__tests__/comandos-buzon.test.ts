/**
 * 0052 · Buzón: los alumnos escriben al centro; solo lo lee y contesta quien lo atiende; al alumno le firma
 * "Nuevo Palmar" y le llega su aviso. Espejo de enviar_consulta, responder_consulta, cerrar_consulta y leer_consulta.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { buzonAvisarme, cerrarConsulta, enviarConsulta, guardarTrabajador, leerConsulta, responderConsulta, MENSAJE_SIN_BUZON } from '@/data/comandos';
import { avisosDeCliente, avisosNoLeidos } from '@/data/selectores';
import {
  MAX_LETRAS_MENSAJE, consultasDeCliente, consultasDelBuzon, consultasPendientes, enHorarioBuzon, ocultarBuzon, respuestaSinLeer, resumenConsulta, textoHorarioBuzon, validarMensaje,
} from '@/domain/buzon';

const t0 = new Date('2026-11-19T10:00:00');
const mas = (min: number) => new Date(t0.getTime() + min * 60_000);
const trabajador = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, gestionaHorario: t.gestionaHorario === true, veFinanzas: t.veFinanzas === true, atiendeBuzon: t.atiendeBuzon === true };
};
const alumno = (db: Db, id: string): Sesion => {
  const c = db.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId ?? `usr-${id}`, clienteId: c.id, nombre: c.nombre };
};
/** Ejecuta y exige que vaya bien. */
function bien<T>(r: { ok: true; db: Db; valor: T } | { ok: false; error: string }): { db: Db; valor: T } {
  if (!r.ok) throw new Error(r.error);
  return r;
}
const error = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

describe('Buzón · el alumno escribe', () => {
  const db0 = crearSeed();

  it('abre una consulta pendiente con el texto limpio; no vale sin motivo, vacío o demasiado largo', () => {
    const maria = alumno(db0, 'maria');
    expect(error(enviarConsulta({ db: db0, sesion: maria, ahora: t0 }, { motivo: 'OTRO', texto: '   ' }))).toBe('Escribe tu mensaje.');
    expect(error(enviarConsulta({ db: db0, sesion: maria, ahora: t0 }, { motivo: 'OTRO', texto: 'a'.repeat(MAX_LETRAS_MENSAJE + 1) }))).toMatch(/demasiado largo/);
    expect(error(enviarConsulta({ db: db0, sesion: maria, ahora: t0 }, { motivo: 'PAGOS' as never, texto: 'hola' }))).toBe('Elige sobre qué es tu consulta.');
    const { db, valor } = bien(enviarConsulta({ db: db0, sesion: maria, ahora: t0 }, { motivo: 'LESION', texto: '  Me duele el hombro \n' }));
    expect(valor).toMatchObject({ clienteId: 'maria', motivo: 'LESION', estado: 'PENDIENTE', leidaClienteEl: null });
    expect(valor.mensajes.map((m) => [m.autor, m.texto])).toEqual([['CLIENTE', 'Me duele el hombro']]);
    expect(consultasPendientes(db.consultas)).toBe(1);
    // En el registro queda quién escribe, nunca el texto ni el motivo.
    expect(db.auditoria[0]).toMatchObject({ accion: 'CONSULTA', entidadId: valor.id });
    expect(db.auditoria[0].detalle).not.toMatch(/hombro|Lesión/i);
  });

  it('solo los alumnos, y solo con el buzón activo', () => {
    expect(error(enviarConsulta({ db: db0, sesion: trabajador(db0, 'tra-jose'), ahora: t0 }, { motivo: 'OTRO', texto: 'hola' }))).toMatch(/Solo los alumnos/);
    const cerrado: Db = { ...db0, config: { ...db0.config, buzonActivo: false } };
    expect(error(enviarConsulta({ db: cerrado, sesion: alumno(db0, 'maria'), ahora: t0 }, { motivo: 'OTRO', texto: 'hola' }))).toMatch(/no se puede escribir al centro/);
    // Sin la migración (ajuste ausente) tampoco.
    const sin: Db = { ...db0, config: { ...db0.config, buzonActivo: undefined } };
    expect(enviarConsulta({ db: sin, sesion: alumno(db0, 'maria'), ahora: t0 }, { motivo: 'OTRO', texto: 'hola' }).ok).toBe(false);
  });

  it('como mucho 10 mensajes en 24 horas; al día siguiente puede volver a escribir', () => {
    const maria = alumno(db0, 'maria');
    let { db, valor } = bien(enviarConsulta({ db: db0, sesion: maria, ahora: t0 }, { motivo: 'OTRO', texto: '1' }));
    for (let i = 2; i <= 10; i++) db = bien(responderConsulta({ db, sesion: maria, ahora: mas(i) }, { consultaId: valor.id, texto: String(i) })).db;
    expect(error(responderConsulta({ db, sesion: maria, ahora: mas(20) }, { consultaId: valor.id, texto: 'uno más' }))).toMatch(/muchos mensajes hoy/);
    expect(error(enviarConsulta({ db, sesion: maria, ahora: mas(20) }, { motivo: 'OTRO', texto: 'otra' }))).toMatch(/muchos mensajes hoy/);
    expect(enviarConsulta({ db, sesion: maria, ahora: mas(24 * 60 + 30) }, { motivo: 'OTRO', texto: 'mañana sí' }).ok).toBe(true);
    // El límite es de cada alumno.
    expect(enviarConsulta({ db, sesion: alumno(db, 'juan'), ahora: mas(20) }, { motivo: 'OTRO', texto: 'yo sí' }).ok).toBe(true);
  });
});

describe('Buzón · el centro contesta', () => {
  const db0 = crearSeed();
  const maria = alumno(db0, 'maria');
  const jose = trabajador(db0, 'tra-jose');
  const abierta = bien(enviarConsulta({ db: db0, sesion: maria, ahora: t0 }, { motivo: 'CLASES', texto: '¿Puedo cambiar el martes?' }));
  const id = abierta.valor.id;

  it('quien no atiende el buzón no contesta ni cierra; otro alumno tampoco escribe en una consulta ajena', () => {
    const otro = db0.trabajadores.find((t) => !t.atiendeBuzon && t.activo)!;
    const sesionOtro = trabajador(db0, otro.id);
    expect(error(responderConsulta({ db: abierta.db, sesion: sesionOtro, ahora: mas(1) }, { consultaId: id, texto: 'hola' }))).toBe(MENSAJE_SIN_BUZON);
    expect(error(cerrarConsulta({ db: abierta.db, sesion: sesionOtro, ahora: mas(1) }, { consultaId: id }))).toBe(MENSAJE_SIN_BUZON);
    expect(error(buzonAvisarme({ db: abierta.db, sesion: sesionOtro, ahora: mas(1) }, { activo: false }))).toBe(MENSAJE_SIN_BUZON);
    expect(error(responderConsulta({ db: abierta.db, sesion: alumno(db0, 'juan'), ahora: mas(1) }, { consultaId: id, texto: 'me cuelo' }))).toBe(MENSAJE_SIN_BUZON);
    // Y lo que recibe en pantalla va sin consultas ni avisos de respuesta.
    const respondida = bien(responderConsulta({ db: abierta.db, sesion: jose, ahora: mas(2) }, { consultaId: id, texto: 'Sí' })).db;
    const limpio = ocultarBuzon(respondida);
    expect(limpio.consultas).toEqual([]);
    expect(limpio.avisos.some((a) => a.consultaId)).toBe(false);
    expect(limpio.avisos.length).toBe(respondida.avisos.length - 1);
  });

  it('responder: pasa a respondida, guarda quién contestó y avisa al alumno; al abrirla queda leída (y su aviso)', () => {
    const avisosAntes = avisosNoLeidos(abierta.db, 'maria');
    const db1 = bien(responderConsulta({ db: abierta.db, sesion: jose, ahora: mas(5) }, { consultaId: id, texto: ' Sí, sin problema. ' })).db;
    const c1 = consultasDeCliente(db1.consultas, 'maria')[0];
    expect(c1.estado).toBe('RESPONDIDA');
    expect(c1.mensajes[1]).toMatchObject({ autor: 'CENTRO', texto: 'Sí, sin problema.', trabajadorId: 'tra-jose' });
    expect(respuestaSinLeer(c1)).toBe(true);
    expect(resumenConsulta(c1)).toBe('Nuevo Palmar: Sí, sin problema.');
    expect(avisosNoLeidos(db1, 'maria')).toBe(avisosAntes + 1);
    const aviso = avisosDeCliente(db1, 'maria').find((a) => a.aviso.consultaId === id)!;
    expect(aviso.aviso.titulo).toBe('Nuevo Palmar ha respondido a tu consulta');
    expect(aviso.aviso.destinatariosIds).toEqual(['maria']);
    // Otro alumno no recibe ese aviso.
    expect(avisosDeCliente(db1, 'juan').some((a) => a.aviso.consultaId)).toBe(false);

    const db2 = bien(leerConsulta({ db: db1, sesion: maria, ahora: mas(6) }, { consultaId: id })).db;
    expect(respuestaSinLeer(consultasDeCliente(db2.consultas, 'maria')[0])).toBe(false);
    expect(avisosNoLeidos(db2, 'maria')).toBe(avisosAntes);
    // Otro alumno no puede marcar como leída una consulta ajena.
    expect(leerConsulta({ db: db1, sesion: alumno(db0, 'juan'), ahora: mas(6) }, { consultaId: id }).ok && respuestaSinLeer(consultasDeCliente(db1.consultas, 'maria')[0])).toBe(true);
  });

  it('dos respuestas seguidas dejan un solo aviso sin leer; si el alumno contesta vuelve a pendiente; cerrada se reabre al escribir', () => {
    let db = bien(responderConsulta({ db: abierta.db, sesion: jose, ahora: mas(5) }, { consultaId: id, texto: 'Una' })).db;
    db = bien(responderConsulta({ db, sesion: jose, ahora: mas(6) }, { consultaId: id, texto: 'Dos' })).db;
    expect(db.avisos.filter((a) => a.consultaId === id).length).toBe(1);
    db = bien(responderConsulta({ db, sesion: maria, ahora: mas(7) }, { consultaId: id, texto: 'Gracias' })).db;
    expect(consultasPendientes(db.consultas)).toBe(1);
    db = bien(cerrarConsulta({ db, sesion: jose, ahora: mas(8) }, { consultaId: id })).db;
    expect(db.consultas![0].estado).toBe('CERRADA');
    expect(consultasPendientes(db.consultas)).toBe(0);
    db = bien(responderConsulta({ db, sesion: maria, ahora: mas(9) }, { consultaId: id, texto: 'Una cosa más' })).db;
    expect(db.consultas![0].estado).toBe('PENDIENTE');
  });

  it('el buzón ordena: pendientes, la que más espera primero; el resto, lo último primero', () => {
    let db = bien(enviarConsulta({ db: abierta.db, sesion: alumno(db0, 'juan'), ahora: mas(30) }, { motivo: 'TARIFA', texto: 'Quiero un día más' })).db;
    expect(consultasDelBuzon(db.consultas, 'PENDIENTES').map((c) => c.clienteId)).toEqual(['maria', 'juan']);
    db = bien(responderConsulta({ db, sesion: jose, ahora: mas(40) }, { consultaId: id, texto: 'Hecho' })).db;
    expect(consultasDelBuzon(db.consultas, 'PENDIENTES').map((c) => c.clienteId)).toEqual(['juan']);
    expect(consultasDelBuzon(db.consultas, 'RESPONDIDAS').map((c) => c.clienteId)).toEqual(['maria']);
    expect(consultasDelBuzon(db.consultas, 'TODAS').map((c) => c.clienteId)).toEqual(['maria', 'juan']);
  });
});

describe('Buzón · quién lo atiende', () => {
  it('solo lo concede quien ya lo tiene, no puede quedarse nadie sin él y el aviso al móvil es de cada uno', () => {
    const db0 = crearSeed();
    const jose = trabajador(db0, 'tra-jose');
    const yo = db0.trabajadores.find((t) => t.id === 'tra-jose')!;
    const otra = db0.trabajadores.find((t) => t.id !== 'tra-jose' && t.activo)!;
    // No puede dejarlo si es el único.
    expect(error(guardarTrabajador({ db: db0, sesion: jose, ahora: t0 }, { trabajador: { ...yo, atiendeBuzon: false } }))).toMatch(/al menos una persona activa que atienda el buzón/);
    // Se lo da a otra persona y entonces sí.
    let db = bien(guardarTrabajador({ db: db0, sesion: jose, ahora: t0 }, { trabajador: { ...otra, atiendeBuzon: true } })).db;
    expect(db.trabajadores.find((t) => t.id === otra.id)!.atiendeBuzon).toBe(true);
    db = bien(guardarTrabajador({ db, sesion: jose, ahora: t0 }, { trabajador: { ...yo, atiendeBuzon: false } })).db;
    expect(db.trabajadores.find((t) => t.id === 'tra-jose')!.atiendeBuzon).toBe(false);
    // Ya sin él, no se lo puede devolver (se conserva en silencio).
    const sinBuzon = trabajador(db, 'tra-jose');
    db = bien(guardarTrabajador({ db, sesion: sinBuzon, ahora: t0 }, { trabajador: { ...yo, atiendeBuzon: true } })).db;
    expect(db.trabajadores.find((t) => t.id === 'tra-jose')!.atiendeBuzon).toBe(false);

    // El aviso al móvil lo cambia cada uno para sí; editar la ficha de otro no lo toca.
    const db1 = bien(buzonAvisarme({ db: db0, sesion: jose, ahora: t0 }, { activo: false })).db;
    expect(db1.trabajadores.find((t) => t.id === 'tra-jose')!.buzonPush).toBe(false);
    const db2 = bien(guardarTrabajador({ db: db1, sesion: jose, ahora: t0 }, { trabajador: { ...yo, buzonPush: true, telefono: '600' } })).db;
    expect(db2.trabajadores.find((t) => t.id === 'tra-jose')!.buzonPush).toBe(false);
  });
});

describe('Buzón · textos y horario', () => {
  const config = { buzonDesde: '08:00', buzonHasta: '22:00' };
  it('dentro del horario se contesta "en cuanto podamos"; fuera, "a partir de las 8:00"', () => {
    expect(enHorarioBuzon(config, new Date('2026-11-19T08:00:00'))).toBe(true);
    expect(enHorarioBuzon(config, new Date('2026-11-19T21:59:00'))).toBe(true);
    expect(enHorarioBuzon(config, new Date('2026-11-19T22:00:00'))).toBe(false);
    expect(enHorarioBuzon(config, new Date('2026-11-19T07:59:00'))).toBe(false);
    expect(textoHorarioBuzon(config, new Date('2026-11-19T23:30:00'))).toBe('Puedes escribir a cualquier hora. Te contestamos a partir de las 8:00.');
    expect(textoHorarioBuzon(config, new Date('2026-11-19T11:00:00'))).toMatch(/en cuanto podamos/);
    // Sin ajustes (antes de guardarlos): 8:00–22:00.
    expect(enHorarioBuzon({}, new Date('2026-11-19T12:00:00'))).toBe(true);
    expect(textoHorarioBuzon({}, new Date('2026-11-19T03:00:00'))).toMatch(/a partir de las 8:00/);
  });
  it('validarMensaje recorta espacios y respeta el tope de letras', () => {
    expect(validarMensaje('  hola  ')).toEqual({ ok: true, texto: 'hola' });
    expect(validarMensaje('a'.repeat(MAX_LETRAS_MENSAJE)).ok).toBe(true);
    expect(validarMensaje('a'.repeat(MAX_LETRAS_MENSAJE + 1)).ok).toBe(false);
  });
});
