/**
 * 0038 (quién gestiona el horario, clases vacías, mover clases con sus alumnos) y
 * 0039 (cambios sin publicar: borradores, plazas retenidas y «Publicar cambios»).
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Clase, Reserva, Sesion } from '@/domain/types';
import { tienePermiso } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import {
  anadirAlumno, apuntarListaEspera, cancelarClase, cancelarReserva, crearClaseExtraordinaria, eliminarClase, guardarPlantilla, guardarTrabajador,
  generarClasesPendientes, publicarCambios, quitarAlumno, reservar, type Ctx,
} from '@/data/comandos';
import { vistaClase } from '@/data/selectores';
import { clasesVisiblesDelDia, evaluarReservaDe } from '@/features/cliente/consultas';
import { cambiosSinPublicar } from '@/features/trabajador/consultas';
import { aISODate, diaSemanaDe, esPasada, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const trabajador = (db: Db, id: string, extra: Partial<Extract<Sesion, { tipo: 'TRABAJADOR' }>> = {}): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol, gestionaHorario: t.gestionaHorario === true, ...extra };
};
const alumno = (db: Db, id: string): Sesion => {
  const c = db.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId ?? `usr-${id}`, clienteId: c.id, nombre: c.nombre };
};
const ctx = (db: Db, sesion: Sesion): Ctx => ({ db, sesion, ahora });
const reservaManual = (clase: Clase, clienteId: string, id: string): Reserva => ({
  id, claseId: clase.id, clienteId, contratoId: null, origen: 'MANUAL', estado: 'RESERVADA', asistencia: 'PENDIENTE',
  recuperacionUsadaId: null, creadaEl: ahora.toISOString(), creadaPor: 'tra-jose', canceladaEl: null, canceladaPor: null,
});
const ocupadas = (db: Db, claseId: string) => db.reservas.filter((r) => r.claseId === claseId && r.estado === 'RESERVADA').length;

/** Clase extraordinaria de dirigidas dentro de 3 días con 2 plazas: Lucía (bono) ocupa una; María y Antonio, libres. */
function prepararClase(plazas = 2) {
  const db0 = crearSeed();
  const actividad = db0.actividades.find((a) => a.categoria === 'DIRIGIDA' && a.activa)!;
  const clase: Clase = {
    id: 'cla-prueba', plantillaId: null, actividadId: actividad.id, fecha: sumarDias(hoy, 3), horaInicio: '20:30', duracionMin: 55, monitorId: 'tra-ana',
    plazas, estado: 'PROGRAMADA', extraordinaria: true, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null,
  };
  const reservas = db0.reservas.filter((r) => r.clienteId !== 'antonio' && r.clienteId !== 'maria');
  const recuperaciones = db0.recuperaciones.filter((r) => r.clienteId !== 'maria' && r.clienteId !== 'antonio');
  const db: Db = { ...db0, clases: [...db0.clases, clase], reservas: [...reservas, reservaManual(clase, 'lucia', 'res-lucia-prueba')], recuperaciones };
  return { db, clase };
}

describe('0038 · quién gestiona el horario', () => {
  it('los permisos del horario los da «Gestiona el horario», no el rol ADMIN ni la lista de permisos', () => {
    const db = crearSeed();
    const jose = trabajador(db, 'tra-jose');
    expect(jose.tipo === 'TRABAJADOR' && jose.gestionaHorario).toBe(true);
    expect(tienePermiso(jose, 'HORARIOS_GESTIONAR')).toBe(true);
    expect(tienePermiso(jose, 'CLASES_CREAR_CANCELAR')).toBe(true);
    const adminSin = trabajador(db, 'tra-jose', { gestionaHorario: false });
    expect(tienePermiso(adminSin, 'HORARIOS_GESTIONAR')).toBe(false);
    expect(tienePermiso(adminSin, 'CLIENTES_EDITAR')).toBe(true); // el resto, como siempre
    const laura = trabajador(db, 'tra-laura', { permisos: ['HORARIOS_GESTIONAR', 'CLASES_CREAR_CANCELAR'] });
    expect(tienePermiso(laura, 'HORARIOS_GESTIONAR')).toBe(false); // en la lista de permisos ya no vale
    const lauraGestiona = trabajador(db, 'tra-laura', { gestionaHorario: true });
    expect(tienePermiso(lauraGestiona, 'CLASES_CREAR_CANCELAR')).toBe(true);
    const p = db.plantillas.find((x) => x.activa)!;
    expect(guardarPlantilla(ctx(db, adminSin), { plantilla: { ...p, plazas: p.plazas + 1 } })).toMatchObject({ ok: false, error: 'No tienes permiso para: HORARIOS_GESTIONAR' });
    expect(guardarPlantilla(ctx(db, lauraGestiona), { plantilla: { ...p, plazas: p.plazas + 1 } }).ok).toBe(true);
  });

  it('solo quien gestiona el horario lo concede o lo quita, y nunca se queda nadie', () => {
    const db = crearSeed();
    const jose = trabajador(db, 'tra-jose');
    const laura = db.trabajadores.find((t) => t.id === 'tra-laura')!;
    // José (lo tiene) se lo da a Laura.
    const r1 = guardarTrabajador(ctx(db, jose), { trabajador: { ...laura, gestionaHorario: true } });
    expect(r1.ok && r1.db.trabajadores.find((t) => t.id === 'tra-laura')!.gestionaHorario).toBe(true);
    // Un administrador que no lo tiene no puede dárselo a nadie (se conserva en silencio).
    const adminSin = trabajador(db, 'tra-jose', { gestionaHorario: false });
    const r2 = guardarTrabajador(ctx(db, adminSin), { trabajador: { ...laura, gestionaHorario: true } });
    expect(r2.ok && r2.db.trabajadores.find((t) => t.id === 'tra-laura')!.gestionaHorario).toBe(false);
    // José no puede quitárselo si es el único.
    const joseFila = db.trabajadores.find((t) => t.id === 'tra-jose')!;
    expect(guardarTrabajador(ctx(db, jose), { trabajador: { ...joseFila, gestionaHorario: false } })).toMatchObject({ ok: false, error: expect.stringMatching(/al menos una persona/) });
    // Con Laura ya con el permiso, sí.
    if (!r1.ok) return;
    const r3 = guardarTrabajador(ctx(r1.db, jose), { trabajador: { ...joseFila, gestionaHorario: false } });
    expect(r3.ok && r3.db.trabajadores.find((t) => t.id === 'tra-jose')!.gestionaHorario).toBe(false);
  });
});

describe('0038 · clases vacías y mover clases con sus alumnos', () => {
  it('cancelar una clase en la que no hay nadie la borra; eliminar una cancelada sin alumnos también', () => {
    const db = crearSeed();
    const jose = trabajador(db, 'tra-jose');
    const vacia = db.clases.find((c) => c.estado === 'PROGRAMADA' && !esPasada(c.fecha, c.horaInicio, ahora) && !db.reservas.some((r) => r.claseId === c.id))!;
    expect(vacia).toBeDefined();
    const r = cancelarClase(ctx(db, jose), { claseId: vacia.id, motivo: 'Sobra', claseAlternativaId: null, avisar: true });
    expect(r.ok && r.valor).toEqual({ afectados: 0, borrada: true });
    expect(r.ok && r.db.clases.some((c) => c.id === vacia.id)).toBe(false);
    expect(r.ok && r.db.auditoria[0]).toMatchObject({ accion: 'BORRAR_CLASE', entidadId: vacia.id });
    // Con alumnos apuntados no se elimina (se cancela, con avisos); al cancelarla sigue en el historial.
    const conGente = db.clases.find((c) => c.estado === 'PROGRAMADA' && !esPasada(c.fecha, c.horaInicio, ahora) && ocupadas(db, c.id) > 0)!;
    expect(eliminarClase(ctx(db, jose), { claseId: conGente.id })).toMatchObject({ ok: false, error: expect.stringMatching(/tiene alumnos apuntados/) });
    const rc = cancelarClase(ctx(db, jose), { claseId: conGente.id, motivo: 'Avería', claseAlternativaId: null, avisar: false });
    expect(rc.ok && rc.valor.borrada).toBe(false);
    // 0041: una clase en la que alguien se apuntó y lo canceló no tiene a nadie: se puede eliminar (o cancelar, que la borra) y la recuperación se conserva.
    const cancelada = db.reservas.find((r) => r.estado === 'CANCELADA_RECUPERABLE' && db.clases.some((c) => c.id === r.claseId && c.estado === 'PROGRAMADA' && !esPasada(c.fecha, c.horaInicio, ahora) && ocupadas(db, c.id) === 0));
    const soloCancelada: Clase = cancelada ? db.clases.find((c) => c.id === cancelada.claseId)! : { ...vacia, id: 'cla-solo-cancelada' };
    const dbSolo: Db = cancelada ? db : { ...db, clases: [...db.clases, soloCancelada], reservas: [...db.reservas, { ...reservaManual(soloCancelada, 'maria', 'res-solo-cancelada'), estado: 'CANCELADA_RECUPERABLE' as const }] };
    const rs = cancelarClase(ctx(dbSolo, jose), { claseId: soloCancelada.id, motivo: 'Sobra', claseAlternativaId: null, avisar: true });
    expect(rs.ok && rs.valor).toEqual({ afectados: 0, borrada: true });
    expect(rs.ok && rs.db.reservas.some((r) => r.claseId === soloCancelada.id)).toBe(false);
    expect(rs.ok && rs.db.recuperaciones.length).toBe(dbSolo.recuperaciones.length);
    const re = eliminarClase(ctx(dbSolo, jose), { claseId: soloCancelada.id });
    expect(re.ok && re.db.clases.some((c) => c.id === soloCancelada.id)).toBe(false);
    expect(eliminarClase(ctx(dbSolo, trabajador(db, 'tra-laura')), { claseId: soloCancelada.id })).toMatchObject({ ok: false, error: 'No tienes permiso para: CLASES_CREAR_CANCELAR' });
  });

  it('0042: una clase de franja quitada no vuelve a generarse (ni al regenerar ni al guardar el horario)', () => {
    const db = crearSeed();
    const jose = trabajador(db, 'tra-jose');
    const vacia = db.clases.find((c) => !!c.plantillaId && c.estado === 'PROGRAMADA' && c.fecha > sumarDias(hoy, 2) && !db.reservas.some((r) => r.claseId === c.id))!;
    const r = cancelarClase(ctx(db, jose), { claseId: vacia.id, motivo: 'Sobra', claseAlternativaId: null, avisar: false });
    expect(r.ok && r.valor.borrada).toBe(true);
    if (!r.ok) return;
    expect(r.db.clasesQuitadas).toContainEqual({ plantillaId: vacia.plantillaId, fecha: vacia.fecha });
    const deNuevo = (d: Db) => d.clases.some((c) => c.plantillaId === vacia.plantillaId && c.fecha === vacia.fecha);
    expect(deNuevo(generarClasesPendientes(r.db, ahora))).toBe(false);
    const p = r.db.plantillas.find((x) => x.id === vacia.plantillaId)!;
    const g = guardarPlantilla(ctx(r.db, jose), { plantilla: { ...p, plazas: p.plazas + 1 } });
    expect(g.ok && deNuevo(g.db)).toBe(false);
    // Las demás fechas de la franja siguen ahí.
    expect(g.ok && g.db.clases.filter((c) => c.plantillaId === p.id && c.fecha > hoy).length).toBeGreaterThan(3);
  });

  it('al cambiar la hora, «mover» lleva las clases con alumnos a la hora nueva avisándoles; sin «mover» se quedan', () => {
    const db = crearSeed();
    const jose = trabajador(db, 'tra-jose');
    // Franja con una clase futura con reserva de cliente (no automática).
    const reserva = db.reservas.find((r) => r.estado === 'RESERVADA' && r.origen !== 'AUTOMATICA' && (() => { const c = db.clases.find((x) => x.id === r.claseId); return !!c?.plantillaId && c.estado === 'PROGRAMADA' && c.fecha > hoy; })())!;
    const clase = db.clases.find((c) => c.id === reserva.claseId)!;
    const p = db.plantillas.find((x) => x.id === clase.plantillaId)!;
    const nuevaHora = p.horaInicio === '10:00' ? '11:30' : '10:00';
    const sinMover = guardarPlantilla(ctx(db, jose), { plantilla: { ...p, horaInicio: nuevaHora }, mover: false });
    expect(sinMover.ok && sinMover.valor.movidas).toBe(0);
    expect(sinMover.ok && sinMover.db.clases.find((c) => c.id === clase.id)!.horaInicio).toBe(clase.horaInicio);
    const movida = guardarPlantilla(ctx(db, jose), { plantilla: { ...p, horaInicio: nuevaHora }, mover: true });
    expect(movida.ok && movida.valor.movidas).toBeGreaterThan(0);
    if (!movida.ok) return;
    const despues = movida.db.clases.find((c) => c.id === clase.id)!;
    expect(despues).toMatchObject({ fecha: clase.fecha, horaInicio: nuevaHora });
    expect(movida.db.reservas.find((r) => r.id === reserva.id)).toMatchObject({ claseId: clase.id, estado: 'RESERVADA' });
    const aviso = movida.db.avisos.find((a) => a.destino.tipo === 'CLASE' && a.destino.claseId === clase.id && a.titulo.startsWith('Cambio de hora'))!;
    expect(aviso).toBeDefined();
    expect(aviso.destinatariosIds).toContain(reserva.clienteId);
    expect(aviso.cuerpo).toContain(nuevaHora);
    // No quedan dos clases de la franja el mismo día.
    expect(movida.db.clases.filter((c) => c.plantillaId === p.id && c.fecha === clase.fecha)).toHaveLength(1);
  });

  it('al cambiar el día, la clase movida va al mismo día de su semana', () => {
    const db0 = crearSeed();
    const jose = trabajador(db0, 'tra-jose');
    // Una clase de franja dentro de dos semanas con una reserva hecha a mano (las automáticas se regeneran solas).
    const clase = db0.clases.find((c) => !!c.plantillaId && c.estado === 'PROGRAMADA' && c.fecha > sumarDias(hoy, 10) && ocupadas(db0, c.id) < c.plazas)!;
    const reserva = reservaManual(clase, 'maria', 'res-maria-mueve');
    const db: Db = { ...db0, reservas: [...db0.reservas.filter((r) => r.clienteId !== 'maria'), reserva] };
    const p = db.plantillas.find((x) => x.id === clase.plantillaId)!;
    const nuevoDia = p.diaSemana === 7 ? 6 : ((p.diaSemana + 1) as typeof p.diaSemana);
    const r = guardarPlantilla(ctx(db, jose), { plantilla: { ...p, diaSemana: nuevoDia, horaInicio: '07:15' }, mover: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const despues = r.db.clases.find((c) => c.id === clase.id)!;
    expect(diaSemanaDe(despues.fecha)).toBe(nuevoDia);
    expect(despues.horaInicio).toBe('07:15');
    expect(Math.abs((new Date(despues.fecha).getTime() - new Date(clase.fecha).getTime()) / 86400000)).toBeLessThanOrEqual(6);
  });
});

describe('0039 · cambios sin publicar', () => {
  it('una franja nueva y sus clases nacen sin publicar; un alumno no las ve hasta «Publicar cambios»', () => {
    const db = crearSeed();
    const jose = trabajador(db, 'tra-jose');
    const act = db.actividades.find((a) => a.categoria === 'DIRIGIDA' && a.activa)!;
    const r = guardarPlantilla(ctx(db, jose), { plantilla: { actividadId: act.id, diaSemana: 7, horaInicio: '08:15', duracionMin: 55, monitorId: 'tra-ana', plazas: 8, activa: true, vigenciaDesde: null, vigenciaHasta: null } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.valor.plantilla;
    expect(r.db.plantillas.find((x) => x.id === p.id)!.publicada).toBe(false);
    const clases = r.db.clases.filter((c) => c.plantillaId === p.id);
    expect(clases.length).toBeGreaterThan(0);
    expect(clases.every((c) => c.publicada === false)).toBe(true);
    expect(clasesVisiblesDelDia(r.db, 'maria', clases[0].fecha).some((v) => v.clase.id === clases[0].id)).toBe(false);
    expect(reservar(ctx(r.db, alumno(db, 'maria')), { claseId: clases[0].id })).toMatchObject({ ok: false, error: 'Esta clase todavía no está publicada.' });
    expect(apuntarListaEspera(ctx(r.db, alumno(db, 'maria')), { claseId: clases[0].id })).toMatchObject({ ok: false, error: 'Esta clase todavía no está publicada.' });
    // El equipo sí la ve y puede apuntar a alguien, que entonces sí la ve.
    const ra = anadirAlumno(ctx(r.db, jose), { claseId: clases[0].id, clienteId: 'maria', modo: 'MANUAL' });
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    expect(clasesVisiblesDelDia(ra.db, 'maria', clases[0].fecha).some((v) => v.clase.id === clases[0].id)).toBe(true);
    expect(clasesVisiblesDelDia(ra.db, 'antonio', clases[0].fecha).some((v) => v.clase.id === clases[0].id)).toBe(false);
    expect(cambiosSinPublicar(ra.db, ahora)).toMatchObject({ hay: true, franjas: [expect.objectContaining({ id: p.id })] });
    // Publicar: todo visible, con aviso a todos si se pide. Solo quien gestiona el horario.
    expect(publicarCambios(ctx(ra.db, trabajador(db, 'tra-laura')), { avisar: false })).toMatchObject({ ok: false, error: 'No tienes permiso para: HORARIOS_GESTIONAR' });
    const rp = publicarCambios(ctx(ra.db, jose), { avisar: true, texto: 'Nuevo horario de domingo' });
    expect(rp.ok && rp.valor).toMatchObject({ franjas: 1, clases: clases.length, plazas: 0 });
    if (!rp.ok) return;
    expect(rp.db.plantillas.find((x) => x.id === p.id)!.publicada).toBe(true);
    expect(rp.db.clases.filter((c) => c.plantillaId === p.id).every((c) => c.publicada === true)).toBe(true);
    expect(clasesVisiblesDelDia(rp.db, 'antonio', clases[0].fecha).some((v) => v.clase.id === clases[0].id)).toBe(true);
    expect(rp.db.avisos[0]).toMatchObject({ titulo: 'Horario actualizado', cuerpo: 'Nuevo horario de domingo', destino: { tipo: 'TODOS' }, importante: true });
    expect(cambiosSinPublicar(rp.db, ahora).hay).toBe(false);
    // Una clase extraordinaria también nace sin publicar.
    const re = crearClaseExtraordinaria(ctx(rp.db, jose), { actividadId: act.id, fecha: sumarDias(hoy, 2), horaInicio: '21:00', duracionMin: 55, monitorId: 'tra-ana', plazas: 6 });
    expect(re.ok && re.valor.publicada).toBe(false);
  });

  it('la plaza que libera quien gestiona el horario queda retenida: el alumno no la ve ni la reserva; el equipo sí', () => {
    const { db, clase } = prepararClase(2);
    const jose = trabajador(db, 'tra-jose');
    // Jose quita a Lucía: 1 ocupada → 0, pero 1 retenida. Los alumnos ven 1 libre (de 2); el equipo, 2.
    const r = quitarAlumno(ctx(db, jose), { reservaId: 'res-lucia-prueba' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = vistaClase(r.db, r.db.clases.find((c) => c.id === clase.id)!);
    expect(v).toMatchObject({ ocupadas: 0, libres: 2, retenidas: 1, libresAlumnos: 1 });
    // María reserva la libre; Antonio ya no puede: la otra está retenida.
    const rm = reservar(ctx(r.db, alumno(db, 'maria')), { claseId: clase.id });
    expect(rm.ok).toBe(true);
    if (!rm.ok) return;
    expect(evaluarReservaDe(rm.db, 'antonio', clase.id, ahora)).toMatchObject({ ok: false, codigo: 'SIN_PLAZAS' });
    expect(reservar(ctx(rm.db, alumno(db, 'antonio')), { claseId: clase.id })).toMatchObject({ ok: false, error: 'No quedan plazas libres.' });
    // Antonio puede apuntarse a la lista de espera (para él está completa).
    const le = apuntarListaEspera(ctx(rm.db, alumno(db, 'antonio')), { claseId: clase.id });
    expect(le.ok).toBe(true);
    if (!le.ok) return;
    // El equipo sí puede usar la retenida (y la consume).
    const ra = anadirAlumno(ctx(le.db, jose), { claseId: clase.id, clienteId: 'lucia', modo: 'MANUAL' });
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    expect(vistaClase(ra.db, ra.db.clases.find((c) => c.id === clase.id)!)).toMatchObject({ ocupadas: 2, retenidas: 0, libresAlumnos: 0 });
  });

  it('lo que cancela el propio alumno, o quien no gestiona el horario, no retiene nada', () => {
    const { db, clase } = prepararClase(2);
    const rl = cancelarReserva(ctx(db, alumno(db, 'lucia')), { reservaId: 'res-lucia-prueba' });
    expect(rl.ok && vistaClase(rl.db, rl.db.clases.find((c) => c.id === clase.id)!)).toMatchObject({ retenidas: 0, libresAlumnos: 2 });
    const laura = trabajador(db, 'tra-laura');
    const rr = quitarAlumno(ctx(db, laura), { reservaId: 'res-lucia-prueba' });
    expect(rr.ok && vistaClase(rr.db, rr.db.clases.find((c) => c.id === clase.id)!)).toMatchObject({ retenidas: 0, libresAlumnos: 2 });
  });

  it('la lista de espera no recibe una plaza retenida; al publicar, sí', () => {
    const { db, clase } = prepararClase(1);
    const jose = trabajador(db, 'tra-jose');
    const le = apuntarListaEspera(ctx(db, alumno(db, 'maria')), { claseId: clase.id });
    expect(le.ok).toBe(true);
    if (!le.ok) return;
    // Jose quita a Lucía: la plaza queda retenida y María sigue esperando.
    const r = quitarAlumno(ctx(le.db, jose), { reservaId: 'res-lucia-prueba' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.db.listaEspera.some((e) => e.claseId === clase.id && e.clienteId === 'maria')).toBe(true);
    expect(ocupadas(r.db, clase.id)).toBe(0);
    expect(cambiosSinPublicar(r.db, ahora)).toMatchObject({ plazas: 1, hay: true });
    // Publicar libera la plaza y María entra con su aviso.
    const rp = publicarCambios(ctx(r.db, jose), { avisar: false });
    expect(rp.ok && rp.valor).toMatchObject({ franjas: 0, clases: 0, plazas: 1, avisoId: null });
    if (!rp.ok) return;
    expect(rp.db.listaEspera.some((e) => e.claseId === clase.id)).toBe(false);
    expect(rp.db.reservas.some((x) => x.claseId === clase.id && x.clienteId === 'maria' && x.estado === 'RESERVADA')).toBe(true);
    expect(rp.db.clases.find((c) => c.id === clase.id)!.plazasRetenidas).toBe(0);
    expect(rp.db.avisos.some((a) => a.titulo.startsWith('¡Tienes plaza!') && a.destinatariosIds.includes('maria'))).toBe(true);
  });
});
