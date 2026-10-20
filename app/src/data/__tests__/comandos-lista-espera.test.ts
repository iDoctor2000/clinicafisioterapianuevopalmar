/** 0021: lista de espera (apuntarse, promoción automática, cambio de clase) y eliminar franjas. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Clase, Reserva, Sesion } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { apuntarListaEspera, cancelarReserva, eliminarPlantilla, quitarDeListaEspera, salirListaEspera } from '@/data/comandos';
import { aISODate, esPasada, sumarDias } from '@/domain/fechas';

const ahora = new Date();
const hoy = aISODate(ahora);
const trabajador = (db: Db, id: string): Sesion => {
  const t = db.trabajadores.find((x) => x.id === id)!;
  return { tipo: 'TRABAJADOR', userId: t.userId!, trabajadorId: t.id, nombre: t.nombre, permisos: t.permisos, rol: t.rol };
};
const alumno = (db: Db, id: string): Sesion => {
  const c = db.clientes.find((x) => x.id === id)!;
  return { tipo: 'CLIENTE', userId: c.userId ?? `usr-${id}`, clienteId: c.id, nombre: c.nombre };
};
const reservaManual = (clase: Clase, clienteId: string, id: string): Reserva => ({
  id, claseId: clase.id, clienteId, contratoId: null, origen: 'MANUAL', estado: 'RESERVADA', asistencia: 'PENDIENTE',
  recuperacionUsadaId: null, creadaEl: ahora.toISOString(), creadaPor: 'tra-jose', canceladaEl: null, canceladaPor: null,
});

/** Clase extraordinaria de dirigidas dentro de 3 días, con 1 plaza ocupada por "lucia" (bono). María (turno libre) espera. */
function preparar() {
  const db0 = crearSeed();
  const actividad = db0.actividades.find((a) => a.categoria === 'DIRIGIDA' && a.activa)!;
  const clase: Clase = {
    id: 'cla-llena', plantillaId: null, actividadId: actividad.id, fecha: sumarDias(hoy, 3), horaInicio: '20:30', duracionMin: 55, monitorId: 'tra-ana',
    plazas: 1, estado: 'PROGRAMADA', extraordinaria: true, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null,
  };
  // María y Antonio (turno libre) sin reservas: así tienen el cupo de la semana libre.
  const reservas = db0.reservas.filter((r) => r.clienteId !== 'antonio' && r.clienteId !== 'maria');
  // María sin recuperaciones: así entra con su cupo semanal (origen CLIENTE), no con una recuperación.
  const recuperaciones = db0.recuperaciones.filter((r) => r.clienteId !== 'maria');
  const db: Db = { ...db0, clases: [...db0.clases, clase], reservas: [...reservas, reservaManual(clase, 'lucia', 'res-lucia-llena')], recuperaciones };
  return { db, clase };
}

describe('lista de espera', () => {
  it('solo se puede apuntar a una clase completa, y se queda en orden', () => {
    const { db, clase } = preparar();
    const r1 = apuntarListaEspera({ db, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id });
    expect(r1.ok && r1.valor.posicion).toBe(1);
    if (!r1.ok) return;
    const r2 = apuntarListaEspera({ db: r1.db, sesion: alumno(db, 'antonio'), ahora }, { claseId: clase.id });
    expect(r2.ok && r2.valor.posicion).toBe(2);
    // Repetir no duplica.
    const r3 = apuntarListaEspera({ db: r1.db, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id });
    expect(r3.ok && r3.valor.posicion).toBe(1);
    expect(r3.ok && r3.db.listaEspera.filter((e) => e.claseId === clase.id)).toHaveLength(1);
    // Con plazas libres, no.
    const libre = db.clases.find((c) => c.estado === 'PROGRAMADA' && c.fecha > hoy && c.id !== clase.id && db.reservas.filter((r) => r.claseId === c.id && r.estado === 'RESERVADA').length < c.plazas)!;
    const r4 = apuntarListaEspera({ db, sesion: alumno(db, 'maria'), ahora }, { claseId: libre.id });
    expect(r4.ok).toBe(false);
    expect(!r4.ok && r4.error).toMatch(/plazas libres/);
    // El personal no se apunta.
    expect(apuntarListaEspera({ db, sesion: trabajador(db, 'tra-jose'), ahora }, { claseId: clase.id }).ok).toBe(false);
  });

  it('a menos de 2 horas la lista está cerrada', () => {
    const { db, clase } = preparar();
    const pronto = new Date(ahora.getTime() + 60 * 60 * 1000);
    const cerca: Db = { ...db, clases: db.clases.map((c) => (c.id === clase.id ? { ...c, fecha: aISODate(pronto), horaInicio: pronto.toTimeString().slice(0, 5) } : c)) };
    const r = apuntarListaEspera({ db: cerca, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id });
    expect(!r.ok && r.error).toMatch(/2 horas/);
  });

  it('al liberarse la plaza entra la primera de la lista con su tarifa y recibe un aviso', () => {
    const { db, clase } = preparar();
    const r1 = apuntarListaEspera({ db, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id });
    const r2 = apuntarListaEspera({ db: r1.ok ? r1.db : db, sesion: alumno(db, 'antonio'), ahora }, { claseId: clase.id });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const r = cancelarReserva({ db: r2.db, sesion: trabajador(db, 'tra-laura'), ahora }, { reservaId: 'res-lucia-llena', forzarRecuperable: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const deMaria = r.db.reservas.find((x) => x.claseId === clase.id && x.clienteId === 'maria' && x.estado === 'RESERVADA');
    expect(deMaria?.origen).toBe('CLIENTE');
    expect(r.db.listaEspera.filter((e) => e.claseId === clase.id).map((e) => e.clienteId)).toEqual(['antonio']);
    const aviso = r.db.avisos.find((a) => a.destinatariosIds.includes('maria') && a.titulo.startsWith('¡Tienes plaza!'));
    expect(aviso?.destino.tipo).toBe('CLIENTES');
    expect(r.db.auditoria.some((a) => a.accion === 'LISTA_ESPERA' && a.detalle.includes('entra desde la lista'))).toBe(true);
  });

  it('con "cambio", la reserva antigua se mueve a la clase nueva sin gastar nada', () => {
    const { db, clase } = preparar();
    // Juan (horario fijo mar+jue) tiene una reserva automática esa misma semana.
    const semana = (f: string) => {
      const d = new Date(f + 'T00:00:00');
      const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return aISODate(lunes);
    };
    const deJuan = db.reservas.find((x) => x.clienteId === 'juan' && x.estado === 'RESERVADA' && x.claseId !== clase.id
      && semana(db.clases.find((c) => c.id === x.claseId)!.fecha) === semana(clase.fecha) && db.clases.find((c) => c.id === x.claseId)!.fecha > hoy);
    expect(deJuan).toBeDefined();
    if (!deJuan) return;
    // Sin cambio no puede (horario fijo, sin recuperaciones).
    const sinRec: Db = { ...db, recuperaciones: db.recuperaciones.filter((x) => x.clienteId !== 'juan') };
    const r0 = apuntarListaEspera({ db: sinRec, sesion: alumno(db, 'juan'), ahora }, { claseId: clase.id });
    expect(!r0.ok && r0.error).toMatch(/horario fijo/i);
    // Con cambio sí.
    const r1 = apuntarListaEspera({ db: sinRec, sesion: alumno(db, 'juan'), ahora }, { claseId: clase.id, reservaCambioId: deJuan.id });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r = cancelarReserva({ db: r1.db, sesion: alumno(db, 'lucia'), ahora }, { reservaId: 'res-lucia-llena' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 0022: la antigua queda cancelada en su clase fija y se crea una nueva en la clase elegida.
    const antigua = r.db.reservas.find((x) => x.id === deJuan.id)!;
    expect(antigua.claseId).toBe(deJuan.claseId);
    expect(antigua.estado).toBe('CANCELADA_RECUPERABLE');
    const nueva = r.db.reservas.find((x) => x.clienteId === 'juan' && x.claseId === clase.id && x.estado === 'RESERVADA')!;
    expect(nueva).toMatchObject({ origen: 'CLIENTE', contratoId: deJuan.contratoId });
    expect(r.db.recuperaciones.some((x) => x.reservaOrigenId === deJuan.id)).toBe(false);
    expect(r.db.reservas.filter((x) => x.clienteId === 'juan' && x.claseId === deJuan.claseId && x.estado === 'RESERVADA')).toHaveLength(0);
    expect(r.db.avisos.some((a) => a.destinatariosIds.includes('juan') && a.cuerpo.includes('queda cambiada por esta'))).toBe(true);
    // Una reserva ajena no vale como cambio.
    expect(apuntarListaEspera({ db, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id, reservaCambioId: deJuan.id }).ok).toBe(false);
  });

  it('salir de la lista (alumno) y quitar de la lista (personal)', () => {
    const { db, clase } = preparar();
    const r1 = apuntarListaEspera({ db, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = salirListaEspera({ db: r1.db, sesion: alumno(db, 'maria'), ahora }, { claseId: clase.id });
    expect(r2.ok && r2.db.listaEspera).toHaveLength(0);
    const r3 = quitarDeListaEspera({ db: r1.db, sesion: trabajador(db, 'tra-laura'), ahora }, { id: r1.valor.id });
    expect(r3.ok && r3.db.listaEspera).toHaveLength(0);
    expect(quitarDeListaEspera({ db: r1.db, sesion: alumno(db, 'antonio'), ahora }, { id: r1.valor.id }).ok).toBe(false);
  });
});

describe('eliminar una franja', () => {
  it('se bloquea si alguien la tiene como clase fija, diciendo quién', () => {
    const db = crearSeed();
    const r = eliminarPlantilla({ db, sesion: trabajador(db, 'tra-jose'), ahora }, { plantillaId: 'pl-mar-1800' });
    expect(!r.ok && r.error).toMatch(/clase fija .*Juan/);
    expect(eliminarPlantilla({ db, sesion: trabajador(db, 'tra-laura'), ahora }, { plantillaId: 'pl-mar-1800' }).ok).toBe(false);
  });

  it('cancela sus clases futuras con alumnos (aviso y recuperación), borra las vacías y la deja como eliminada', () => {
    const db0 = crearSeed();
    // Liberamos la franja de Juan: su contrato pasa a finalizado y sus reservas automáticas futuras se quitan.
    const sinFijos: Db = {
      ...db0,
      contratos: db0.contratos.map((c) => (c.id === 'con-juan' ? { ...c, estado: 'FINALIZADO' as const } : c)),
      reservas: db0.reservas.filter((r) => !(r.contratoId === 'con-juan' && r.origen === 'AUTOMATICA' && (db0.clases.find((c) => c.id === r.claseId)?.fecha ?? '') >= hoy)),
    };
    // Las mismas que mira el comando: las que aún no han empezado (incluida la de hoy, si todavía no ha pasado).
    const futuras = sinFijos.clases.filter((c) => c.plantillaId === 'pl-mar-1800' && c.estado === 'PROGRAMADA' && !esPasada(c.fecha, c.horaInicio, ahora)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    expect(futuras.length).toBeGreaterThan(1);
    const db: Db = { ...sinFijos, reservas: [...sinFijos.reservas, reservaManual(futuras[0], 'maria', 'res-maria-franja')] };
    const r = eliminarPlantilla({ db, sesion: trabajador(db, 'tra-jose'), ahora }, { plantillaId: 'pl-mar-1800' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.canceladas).toBe(1);
    // María y quien más tuviera plaza en esa clase (la demo apunta a alguien a mano según el día).
    expect(r.valor.afectados).toBe(db.reservas.filter((x) => x.claseId === futuras[0].id && x.estado === 'RESERVADA').length);
    expect(r.valor.borradas).toBe(futuras.length - 1);
    expect(r.db.clases.find((c) => c.id === futuras[0].id)?.estado).toBe('CANCELADA');
    expect(r.db.clases.some((c) => c.plantillaId === 'pl-mar-1800' && c.estado === 'PROGRAMADA' && c.fecha > hoy)).toBe(false);
    const p = r.db.plantillas.find((x) => x.id === 'pl-mar-1800')!;
    expect(p.activa).toBe(false);
    expect(p.eliminadaEl).toBeTruthy();
    expect(r.db.recuperaciones.some((x) => x.clienteId === 'maria' && x.motivo === 'CANCELACION_CENTRO')).toBe(true);
    expect(r.valor.avisoIds).toHaveLength(1);
    expect(eliminarPlantilla({ db: r.db, sesion: trabajador(db, 'tra-jose'), ahora }, { plantillaId: 'pl-mar-1800' }).ok).toBe(false);
  });
});
