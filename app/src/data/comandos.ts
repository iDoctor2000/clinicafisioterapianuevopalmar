/**
 * Comandos: todas las modificaciones de datos pasan por aquí.
 * Son funciones puras (Db, sesión, argumentos) → nuevo Db o error, de modo que
 * la misma lógica puede ejecutarse en el navegador (demo) o en el servidor
 * (Supabase Edge Functions) sin cambios.
 */
import type {
  Actividad, Asistencia, Aviso, Categoria, Clase, Cliente, ConfigCentro, Contrato, DestinoAviso, EntradaListaEspera, Id, ISODate, MetodoPago, Oferta, Pago,
  PlantillaClase, PortadaImagen, PremioMes, Recuperacion, RegistroAuditoria, Reserva, Sesion, Tarifa, Trabajador, Permiso,
} from '@/domain/types';
import { tienePermiso } from '@/domain/types';
import {
  MENSAJE_AVISO_LIMITADO, MENSAJE_CLASE_AJENA, MENSAJE_CLASE_EXTRA_LIMITADA, MENSAJE_CLIENTE_AJENO, MENSAJE_HORARIO_LIMITADO, MENSAJE_SOLO_ADMIN_EQUIPO,
  esAlumnoMio, limitadoASusClases, puedeGestionarClase,
} from '@/domain/ambito';
import { aISODate, esPasada, sumarDias } from '@/domain/fechas';
import { CONSENTIMIENTO_PAPEL, VERSION_POLITICA_PRIVACIDAD } from '@/domain/privacidad';
import {
  caducidadRecuperacion, categoriasPermitidasRecuperacion, clasificarCancelacion, evaluarReserva, generarClases,
  generarReservasAutomaticas, listaEsperaCerrada, motivoNoCambio, plazasLibres, puedeCancelarCliente, puedeGenerarRecuperacion, caducarVencidas,
} from '@/domain/rules';
import { indexar, nuevoId, type Db } from './db';
import { portadaOrdenada } from './selectores';

export type Resultado<T = void> = { ok: true; db: Db; valor: T } | { ok: false; error: string };

export interface Ctx {
  db: Db;
  sesion: Sesion;
  ahora: Date;
}

const ok = <T>(db: Db, valor: T): Resultado<T> => ({ ok: true, db, valor });
const fallo = <T>(error: string): Resultado<T> => ({ ok: false, error });

function auditar(db: Db, sesion: Sesion, ahora: Date, accion: string, entidad: string, entidadId: Id, detalle: string): Db {
  const reg: RegistroAuditoria = {
    id: nuevoId('aud'), instante: ahora.toISOString(), actorId: sesion.userId, actorNombre: sesion.nombre, accion, entidad, entidadId, detalle,
  };
  return { ...db, auditoria: [reg, ...db.auditoria].slice(0, 5000) };
}

function exigir(sesion: Sesion, permiso: Permiso): string | null {
  return tienePermiso(sesion, permiso) ? null : `No tienes permiso para: ${permiso}`;
}

/** Ámbito: un trabajador con SUS_CLASES solo actúa sobre las clases que imparte. */
function exigirClaseMia(db: Db, sesion: Sesion, clase: Clase): string | null {
  if (sesion.tipo !== 'TRABAJADOR') return null;
  return puedeGestionarClase(db, sesion, clase) ? null : MENSAJE_CLASE_AJENA;
}

function contratoActivo(db: Db, clienteId: Id, fecha: ISODate): Contrato | null {
  return (
    db.contratos.find((c) => c.clienteId === clienteId && c.estado === 'ACTIVO' && c.fechaInicio <= fecha && c.fechaFin >= fecha) ??
    db.contratos.find((c) => c.clienteId === clienteId && c.estado === 'ACTIVO') ??
    null
  );
}

function nombreCliente(db: Db, id: Id): string {
  const c = db.clientes.find((x) => x.id === id);
  return c ? `${c.nombre} ${c.apellidos}` : id;
}

function descClase(db: Db, clase: Clase): string {
  const a = db.actividades.find((x) => x.id === clase.actividadId);
  return `${a?.nombre ?? 'Clase'} ${clase.fecha} ${clase.horaInicio}`;
}

// ---------------------------------------------------------------------------
// Reservas (cliente y trabajador)
// ---------------------------------------------------------------------------

/** Reserva una plaza aplicando todas las reglas de la tarifa del cliente. */
export function reservar(ctx: Ctx, args: { claseId: Id; clienteId?: Id }): Resultado<Reserva> {
  const { db, sesion, ahora } = ctx;
  const clienteId = sesion.tipo === 'CLIENTE' ? sesion.clienteId : args.clienteId;
  if (!clienteId) return fallo('Falta el cliente.');
  if (sesion.tipo === 'TRABAJADOR') {
    const e = exigir(sesion, 'RESERVAS_GESTIONAR');
    if (e) return fallo(e);
  }
  const clase = db.clases.find((c) => c.id === args.claseId);
  if (!clase) return fallo('La clase no existe.');
  if (sesion.tipo === 'TRABAJADOR') {
    const e = exigirClaseMia(db, sesion, clase);
    if (e) return fallo(e);
  }
  const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
  const contrato = contratoActivo(db, clienteId, clase.fecha);
  const tarifa = contrato ? db.tarifas.find((t) => t.id === contrato.tarifaId) ?? null : null;
  const hoy = aISODate(ahora);
  const recuperaciones = db.recuperaciones.filter((r) => r.clienteId === clienteId && r.estado === 'DISPONIBLE' && r.caducaEl >= hoy);

  const ev = evaluarReserva({
    ahora, config: db.config, contrato, tarifa, clase, actividad,
    reservasCliente: db.reservas.filter((r) => r.clienteId === clienteId),
    reservasClase: db.reservas.filter((r) => r.claseId === clase.id),
    recuperaciones, clasesPorId: indexar(db.clases), actividadesPorId: indexar(db.actividades),
  });
  if (!ev.ok) return fallo(ev.motivo);

  const reserva: Reserva = {
    id: nuevoId('res'), claseId: clase.id, clienteId, contratoId: contrato?.id ?? null,
    origen: ev.via === 'RECUPERACION' ? 'RECUPERACION' : ev.via === 'BONO' ? 'BONO' : sesion.tipo === 'CLIENTE' ? 'CLIENTE' : 'MANUAL',
    estado: 'RESERVADA', asistencia: 'PENDIENTE', recuperacionUsadaId: ev.via === 'RECUPERACION' ? ev.recuperacionId : null,
    creadaEl: ahora.toISOString(), creadaPor: sesion.userId, canceladaEl: null, canceladaPor: null,
  };
  let nuevo: Db = { ...db, reservas: [...db.reservas, reserva] };
  if (ev.via === 'RECUPERACION') {
    nuevo = { ...nuevo, recuperaciones: nuevo.recuperaciones.map((r) => (r.id === ev.recuperacionId ? { ...r, estado: 'USADA', usadaEnReservaId: reserva.id } : r)) };
  }
  if (ev.via === 'BONO' && contrato) {
    nuevo = { ...nuevo, contratos: nuevo.contratos.map((c) => (c.id === contrato.id ? { ...c, sesionesRestantes: (c.sesionesRestantes ?? 1) - 1 } : c)) };
  }
  nuevo = auditar(nuevo, sesion, ahora, 'RESERVAR', 'reserva', reserva.id, `${nombreCliente(db, clienteId)} → ${descClase(db, clase)} (${ev.via})`);
  return ok(nuevo, reserva);
}

/** Cancelación por el cliente (o por un trabajador en su nombre): clasifica y genera recuperación si procede. */
export function cancelarReserva(ctx: Ctx, args: { reservaId: Id; forzarRecuperable?: boolean }): Resultado<{ recuperable: boolean }> {
  const { db, sesion, ahora } = ctx;
  const reserva = db.reservas.find((r) => r.id === args.reservaId);
  if (!reserva) return fallo('La reserva no existe.');
  if (sesion.tipo === 'CLIENTE' && reserva.clienteId !== sesion.clienteId) return fallo('Esta reserva no es tuya.');
  if (sesion.tipo === 'TRABAJADOR') {
    const e = exigir(sesion, 'RESERVAS_GESTIONAR');
    if (e) return fallo(e);
  }
  const clase = db.clases.find((c) => c.id === reserva.claseId)!;
  if (sesion.tipo === 'TRABAJADOR') {
    const ea = exigirClaseMia(db, sesion, clase);
    if (ea) return fallo(ea);
  }
  const puede = puedeCancelarCliente(clase, reserva.estado, ahora);
  if (!puede.ok) return fallo(puede.motivo);

  const clasif = clasificarCancelacion(clase, ahora, db.config);
  const recuperable = args.forzarRecuperable === true ? true : clasif.recuperable;
  const estado = recuperable ? 'CANCELADA_RECUPERABLE' : 'CANCELADA_NO_RECUPERABLE';
  let nuevo: Db = {
    ...db,
    reservas: db.reservas.map((r) => (r.id === reserva.id ? { ...r, estado, canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : r)),
  };

  const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
  const contrato = reserva.contratoId ? db.contratos.find((c) => c.id === reserva.contratoId) ?? null : null;
  const tarifa = contrato ? db.tarifas.find((t) => t.id === contrato.tarifaId) ?? null : null;

  if (recuperable) {
    if (reserva.origen === 'RECUPERACION' && reserva.recuperacionUsadaId) {
      // Devolver la recuperación que se había consumido.
      nuevo = { ...nuevo, recuperaciones: nuevo.recuperaciones.map((r) => (r.id === reserva.recuperacionUsadaId ? { ...r, estado: 'DISPONIBLE', usadaEnReservaId: null } : r)) };
    } else if (reserva.origen === 'BONO' && contrato) {
      // Devolver la sesión al bono.
      nuevo = { ...nuevo, contratos: nuevo.contratos.map((c) => (c.id === contrato.id ? { ...c, sesionesRestantes: (c.sesionesRestantes ?? 0) + 1 } : c)) };
    } else if (reserva.origen !== 'CLASE_SUELTA') {
      const pendientes = db.recuperaciones.filter((r) => r.clienteId === reserva.clienteId && r.estado === 'DISPONIBLE').length;
      if (puedeGenerarRecuperacion(tarifa, pendientes)) {
        const rec: Recuperacion = {
          id: nuevoId('rec'), clienteId: reserva.clienteId, contratoId: contrato?.id ?? null, reservaOrigenId: reserva.id,
          categoriaOrigen: actividad.categoria, categoriasPermitidas: categoriasPermitidasRecuperacion(actividad.categoria, tarifa),
          motivo: 'CANCELACION_CLIENTE', estado: 'DISPONIBLE', caducaEl: caducidadRecuperacion(contrato, clase.fecha, db.config),
          usadaEnReservaId: null, creadaEl: ahora.toISOString(), creadaPor: sesion.userId, nota: '',
        };
        nuevo = { ...nuevo, recuperaciones: [...nuevo.recuperaciones, rec] };
      }
    }
  }
  nuevo = auditar(nuevo, sesion, ahora, 'CANCELAR_RESERVA', 'reserva', reserva.id, `${nombreCliente(db, reserva.clienteId)} · ${descClase(db, clase)} · ${estado} (${clasif.minutosAntelacion} min antelación)`);
  // 0021: la plaza que se libera puede ser para alguien de la lista de espera.
  nuevo = promoverListaEspera(nuevo, sesion, ahora, clase.id);
  return ok(nuevo, { recuperable });
}

// ---------------------------------------------------------------------------
// Lista de espera (0021). Espejo de apuntar_lista_espera / _promover_lista_espera.
// ---------------------------------------------------------------------------

/** Entradas de la lista de espera de una clase, por orden de llegada. */
function listaDeClase(db: Db, claseId: Id): EntradaListaEspera[] {
  return db.listaEspera.filter((e) => e.claseId === claseId).sort((a, b) => a.creadaEl.localeCompare(b.creadaEl) || a.id.localeCompare(b.id));
}

function contextoCambio(db: Db, ahora: Date, reserva: Reserva | null, claseDestino: Clase) {
  const claseOrigen = reserva ? db.clases.find((c) => c.id === reserva.claseId) ?? null : null;
  return {
    reserva, claseOrigen, claseDestino,
    actividadOrigen: claseOrigen ? db.actividades.find((a) => a.id === claseOrigen.actividadId) ?? null : null,
    actividadDestino: db.actividades.find((a) => a.id === claseDestino.actividadId)!,
    contrato: reserva?.contratoId ? db.contratos.find((c) => c.id === reserva.contratoId) ?? null : null,
    config: db.config, ahora,
  };
}

/** El alumno se apunta a la lista de espera de una clase completa (opcionalmente a cambio de una reserva suya). */
export function apuntarListaEspera(ctx: Ctx, args: { claseId: Id; reservaCambioId?: Id | null }): Resultado<{ id: Id; posicion: number }> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'CLIENTE') return fallo('Solo los alumnos pueden apuntarse a la lista de espera.');
  const clienteId = sesion.clienteId;
  const clase = db.clases.find((c) => c.id === args.claseId);
  if (!clase) return fallo('La clase no existe.');
  if (clase.estado !== 'PROGRAMADA') return fallo('Esta clase ha sido cancelada por el centro.');
  if (listaEsperaCerrada(clase, ahora)) return fallo('La lista de espera se cierra 2 horas antes de la clase.');
  if (db.reservas.some((r) => r.claseId === clase.id && r.clienteId === clienteId && r.estado === 'RESERVADA')) return fallo('Ya tienes plaza en esta clase.');
  if (plazasLibres(clase, db.reservas) > 0) return fallo('Quedan plazas libres: puedes reservar directamente.');

  const reservaCambioId = args.reservaCambioId ?? null;
  if (reservaCambioId) {
    const reserva = db.reservas.find((r) => r.id === reservaCambioId && r.clienteId === clienteId);
    if (!reserva) return fallo('La reserva que quieres cambiar no es tuya.');
    const motivo = motivoNoCambio(contextoCambio(db, ahora, reserva, clase));
    if (motivo) return fallo(motivo);
  } else {
    // Sin cambio: tendría que poder reservar con su tarifa si hubiera plaza.
    const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
    const contrato = contratoActivo(db, clienteId, clase.fecha);
    const tarifa = contrato ? db.tarifas.find((t) => t.id === contrato.tarifaId) ?? null : null;
    const hoy = aISODate(ahora);
    const ev = evaluarReserva({
      ahora, config: db.config, contrato, tarifa, clase: { ...clase, ocupadas: 0 }, actividad,
      reservasCliente: db.reservas.filter((r) => r.clienteId === clienteId), reservasClase: [],
      recuperaciones: db.recuperaciones.filter((r) => r.clienteId === clienteId && r.estado === 'DISPONIBLE' && r.caducaEl >= hoy),
      clasesPorId: indexar(db.clases), actividadesPorId: indexar(db.actividades),
    });
    if (!ev.ok) return fallo(ev.motivo);
  }

  const existente = db.listaEspera.find((e) => e.claseId === clase.id && e.clienteId === clienteId);
  const entrada: EntradaListaEspera = existente
    ? { ...existente, reservaCambioId }
    : { id: nuevoId('esp'), claseId: clase.id, clienteId, reservaCambioId, creadaEl: ahora.toISOString() };
  const listaEspera = existente ? db.listaEspera.map((e) => (e.id === entrada.id ? entrada : e)) : [...db.listaEspera, entrada];
  const nuevo: Db = { ...db, listaEspera };
  const posicion = listaDeClase(nuevo, clase.id).findIndex((e) => e.id === entrada.id) + 1;
  const cambioTxt = reservaCambioId ? `, a cambio de ${descClase(db, db.clases.find((c) => c.id === db.reservas.find((r) => r.id === reservaCambioId)!.claseId)!)}` : '';
  return ok(auditar(nuevo, sesion, ahora, 'LISTA_ESPERA', 'clase', clase.id, `${nombreCliente(db, clienteId)} se apunta (posición ${posicion}${cambioTxt}) · ${descClase(db, clase)}`), { id: entrada.id, posicion });
}

/** El alumno se quita de la lista de espera de una clase. */
export function salirListaEspera(ctx: Ctx, args: { claseId: Id }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'CLIENTE') return fallo('Solo para alumnos.');
  const entrada = db.listaEspera.find((e) => e.claseId === args.claseId && e.clienteId === sesion.clienteId);
  if (!entrada) return ok(db, undefined);
  const clase = db.clases.find((c) => c.id === args.claseId);
  const nuevo: Db = { ...db, listaEspera: db.listaEspera.filter((e) => e.id !== entrada.id) };
  return ok(auditar(nuevo, sesion, ahora, 'LISTA_ESPERA', 'clase', args.claseId, `${nombreCliente(db, sesion.clienteId)} sale de la lista · ${clase ? descClase(db, clase) : args.claseId}`), undefined);
}

/** El personal quita a un alumno de la lista de espera. */
export function quitarDeListaEspera(ctx: Ctx, args: { id: Id }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'TRABAJADOR') return fallo('Solo para el personal.');
  const e = exigir(sesion, 'RESERVAS_GESTIONAR');
  if (e) return fallo(e);
  const entrada = db.listaEspera.find((x) => x.id === args.id);
  if (!entrada) return ok(db, undefined);
  const clase = db.clases.find((c) => c.id === entrada.claseId);
  if (clase) {
    const ea = exigirClaseMia(db, sesion, clase);
    if (ea) return fallo(ea);
  }
  const nuevo: Db = { ...db, listaEspera: db.listaEspera.filter((x) => x.id !== entrada.id) };
  return ok(auditar(nuevo, sesion, ahora, 'LISTA_ESPERA', 'clase', entrada.claseId, `${nombreCliente(db, entrada.clienteId)} quitado de la lista por el personal · ${clase ? descClase(db, clase) : entrada.claseId}`), undefined);
}

/**
 * Da las plazas libres de una clase a los primeros de su lista de espera (hasta 2 horas antes).
 * Con "cambio" se mueve la reserva antigua; si no, se reserva con la tarifa (cupo, bono o recuperación).
 * Quien no puede entrar recibe un aviso y sale de la lista; el turno pasa al siguiente.
 */
function promoverListaEspera(db: Db, sesion: Sesion, ahora: Date, claseId: Id): Db {
  const clase = db.clases.find((c) => c.id === claseId);
  if (!clase || clase.estado !== 'PROGRAMADA' || listaEsperaCerrada(clase, ahora)) return db;
  const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
  const titulo = (prefijo: string) => `${prefijo} ${actividad.nombre} ${clase.fecha.slice(8, 10)}/${clase.fecha.slice(5, 7)} ${clase.horaInicio}`;
  let nuevo = db;
  for (const e of listaDeClase(db, claseId)) {
    if (plazasLibres(clase, nuevo.reservas) <= 0) break;
    nuevo = { ...nuevo, listaEspera: nuevo.listaEspera.filter((x) => x.id !== e.id) };
    let motivo: string | null = null;
    let cuerpo = '';
    let via = '';
    if (e.reservaCambioId) {
      const reserva = nuevo.reservas.find((r) => r.id === e.reservaCambioId && r.clienteId === e.clienteId) ?? null;
      motivo = motivoNoCambio(contextoCambio(nuevo, ahora, reserva, clase));
      if (!motivo && reserva) {
        const origen = nuevo.clases.find((c) => c.id === reserva.claseId)!;
        // 0022: la antigua queda cancelada en su clase (así el mantenimiento no la vuelve a apuntar allí) y se crea una nueva aquí.
        const nueva: Reserva = {
          id: nuevoId('res'), claseId: clase.id, clienteId: e.clienteId, contratoId: reserva.contratoId,
          origen: reserva.origen === 'AUTOMATICA' || reserva.origen === 'MANUAL' ? 'CLIENTE' : reserva.origen, estado: 'RESERVADA', asistencia: 'PENDIENTE',
          recuperacionUsadaId: reserva.recuperacionUsadaId, creadaEl: ahora.toISOString(), creadaPor: 'sistema', canceladaEl: null, canceladaPor: null,
        };
        nuevo = {
          ...nuevo,
          reservas: nuevo.reservas.map((r) => (r.id === reserva.id ? { ...r, estado: 'CANCELADA_RECUPERABLE' as const, canceladaEl: ahora.toISOString(), canceladaPor: 'sistema', recuperacionUsadaId: null } : r)).concat(nueva),
          recuperaciones: reserva.recuperacionUsadaId ? nuevo.recuperaciones.map((x) => (x.id === reserva.recuperacionUsadaId ? { ...x, usadaEnReservaId: nueva.id } : x)) : nuevo.recuperaciones,
        };
        via = 'CAMBIO';
        cuerpo = `Se ha liberado una plaza y te hemos apuntado desde la lista de espera. Tu clase del ${origen.fecha.slice(8, 10)}/${origen.fecha.slice(5, 7)} a las ${origen.horaInicio} queda cambiada por esta.`;
        // La plaza que deja en su clase antigua puede ser para otro.
        nuevo = promoverListaEspera(nuevo, sesion, ahora, origen.id);
      }
    } else {
      const r = reservar({ db: nuevo, sesion: { tipo: 'CLIENTE', userId: 'sistema', clienteId: e.clienteId, nombre: nombreCliente(nuevo, e.clienteId) }, ahora }, { claseId: clase.id });
      if (r.ok) {
        nuevo = r.db;
        via = r.valor.origen;
        cuerpo = 'Se ha liberado una plaza y te hemos apuntado desde la lista de espera.';
      } else if (r.error === 'Ya tienes plaza en esta clase.') {
        continue;
      } else {
        motivo = r.error;
      }
    }
    const aviso: Aviso = {
      id: nuevoId('avi'), importante: !motivo, publicadoEl: ahora.toISOString(), publicadoPor: 'sistema',
      destino: { tipo: 'CLIENTES', clienteIds: [e.clienteId] }, destinatariosIds: [e.clienteId],
      titulo: motivo ? titulo('Lista de espera:') : titulo('¡Tienes plaza!'),
      cuerpo: motivo ? `Se ha liberado una plaza pero no hemos podido reservártela: ${motivo} Te hemos quitado de la lista de espera.` : cuerpo,
    };
    nuevo = { ...nuevo, avisos: [aviso, ...nuevo.avisos] };
    nuevo = auditar(nuevo, sesion, ahora, 'LISTA_ESPERA', 'clase', clase.id,
      motivo ? `${nombreCliente(db, e.clienteId)} no entra desde la lista (${motivo}) · ${descClase(db, clase)}` : `${nombreCliente(db, e.clienteId)} entra desde la lista de espera (${via}) · ${descClase(db, clase)}`);
  }
  return nuevo;
}

/** Un trabajador añade a un alumno a una clase (manual, clase suelta o usando una recuperación). */
export function anadirAlumno(ctx: Ctx, args: { claseId: Id; clienteId: Id; modo: 'TARIFA' | 'CLASE_SUELTA' | 'MANUAL' }): Resultado<Reserva> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, args.modo === 'CLASE_SUELTA' ? 'CLASES_SUELTAS' : 'RESERVAS_GESTIONAR');
  if (e) return fallo(e);
  const clase = db.clases.find((c) => c.id === args.claseId);
  if (!clase) return fallo('La clase no existe.');
  const ea = exigirClaseMia(db, sesion, clase);
  if (ea) return fallo(ea);
  if (args.modo === 'TARIFA') return reservar(ctx, { claseId: args.claseId, clienteId: args.clienteId });
  if (clase.estado === 'CANCELADA') return fallo('La clase está cancelada.');
  if (plazasLibres(clase, db.reservas) <= 0) return fallo('No quedan plazas libres.');
  if (db.reservas.some((r) => r.claseId === clase.id && r.clienteId === args.clienteId && r.estado === 'RESERVADA')) return fallo('El cliente ya tiene plaza en esta clase.');
  const reserva: Reserva = {
    id: nuevoId('res'), claseId: clase.id, clienteId: args.clienteId, contratoId: contratoActivo(db, args.clienteId, clase.fecha)?.id ?? null,
    origen: args.modo, estado: 'RESERVADA', asistencia: 'PENDIENTE', recuperacionUsadaId: null,
    creadaEl: ahora.toISOString(), creadaPor: sesion.userId, canceladaEl: null, canceladaPor: null,
  };
  const nuevo = auditar({ ...db, reservas: [...db.reservas, reserva] }, sesion, ahora, 'ANADIR_ALUMNO', 'reserva', reserva.id, `${nombreCliente(db, args.clienteId)} → ${descClase(db, clase)} (${args.modo})`);
  return ok(nuevo, reserva);
}

/** Quita a un alumno de una clase sin penalizarle (siempre recuperable si tenía tarifa). */
export function quitarAlumno(ctx: Ctx, args: { reservaId: Id }): Resultado<void> {
  const r = cancelarReserva(ctx, { reservaId: args.reservaId, forzarRecuperable: true });
  return r.ok ? ok(r.db, undefined) : r;
}

export function registrarAsistencia(ctx: Ctx, args: { reservaId: Id; asistencia: Asistencia }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'ASISTENCIA_REGISTRAR');
  if (e) return fallo(e);
  const reserva = db.reservas.find((r) => r.id === args.reservaId);
  if (!reserva) return fallo('La reserva no existe.');
  const clase = db.clases.find((c) => c.id === reserva.claseId);
  if (clase) {
    const ea = exigirClaseMia(db, sesion, clase);
    if (ea) return fallo(ea);
  }
  const nuevo = { ...db, reservas: db.reservas.map((r) => (r.id === reserva.id ? { ...r, asistencia: args.asistencia } : r)) };
  return ok(auditar(nuevo, sesion, ahora, 'ASISTENCIA', 'reserva', reserva.id, `${nombreCliente(db, reserva.clienteId)}: ${args.asistencia}`), undefined);
}

export function autorizarRecuperacion(ctx: Ctx, args: { clienteId: Id; categoriaOrigen: Categoria; categoriasPermitidas: Categoria[]; caducaEl: ISODate; nota: string }): Resultado<Recuperacion> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'RESERVAS_GESTIONAR');
  if (e) return fallo(e);
  const rec: Recuperacion = {
    id: nuevoId('rec'), clienteId: args.clienteId, contratoId: contratoActivo(db, args.clienteId, aISODate(ahora))?.id ?? null, reservaOrigenId: null,
    categoriaOrigen: args.categoriaOrigen, categoriasPermitidas: Array.from(new Set([args.categoriaOrigen, ...args.categoriasPermitidas])),
    motivo: 'AUTORIZACION_MANUAL', estado: 'DISPONIBLE', caducaEl: args.caducaEl, usadaEnReservaId: null,
    creadaEl: ahora.toISOString(), creadaPor: sesion.userId, nota: args.nota,
  };
  return ok(auditar({ ...db, recuperaciones: [...db.recuperaciones, rec] }, sesion, ahora, 'AUTORIZAR_RECUPERACION', 'recuperacion', rec.id, `${nombreCliente(db, args.clienteId)}: ${rec.categoriasPermitidas.join('/')} hasta ${args.caducaEl}`), rec);
}

// ---------------------------------------------------------------------------
// Clases y horarios
// ---------------------------------------------------------------------------

export function cancelarClase(ctx: Ctx, args: { claseId: Id; motivo: string; claseAlternativaId: Id | null; avisar: boolean }): Resultado<{ afectados: number }> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLASES_CREAR_CANCELAR');
  if (e) return fallo(e);
  const clase = db.clases.find((c) => c.id === args.claseId);
  if (!clase) return fallo('La clase no existe.');
  const ea = exigirClaseMia(db, sesion, clase);
  if (ea) return fallo(ea);
  if (clase.estado === 'CANCELADA') return fallo('La clase ya está cancelada.');
  const r = cancelarClaseInterna(db, sesion, ahora, clase, args.motivo, args.claseAlternativaId, args.avisar);
  return ok(r.db, { afectados: r.afectados });
}

/**
 * Cancela una clase por el centro (sin comprobar permisos; espejo de _cancelar_clase, 0020):
 * devuelve lo gastado (bono, recuperación usada), da recuperación salvo en día de cierre
 * (los festivos no se recuperan) y, si se pide, avisa a los alumnos.
 */
function cancelarClaseInterna(db: Db, sesion: Sesion, ahora: Date, clase: Clase, motivo: string, claseAlternativaId: Id | null, avisar: boolean): { db: Db; afectados: number; avisoId: Id | null } {
  const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
  const festivo = db.config.diasCierre.some((d) => d.fecha === clase.fecha);
  const afectadas = db.reservas.filter((r) => r.claseId === clase.id && r.estado === 'RESERVADA');
  const nuevasRec: Recuperacion[] = [];
  let contratos = db.contratos;
  let recuperaciones = db.recuperaciones;
  for (const r of afectadas) {
    if (r.origen === 'RECUPERACION' && r.recuperacionUsadaId) {
      recuperaciones = recuperaciones.map((x) => (x.id === r.recuperacionUsadaId ? { ...x, estado: 'DISPONIBLE', usadaEnReservaId: null } : x));
      continue;
    }
    if (r.origen === 'BONO' && r.contratoId) {
      contratos = contratos.map((c) => (c.id === r.contratoId ? { ...c, sesionesRestantes: (c.sesionesRestantes ?? 0) + 1 } : c));
      continue;
    }
    if (r.origen === 'CLASE_SUELTA' || festivo) continue;
    const contrato = r.contratoId ? db.contratos.find((c) => c.id === r.contratoId) ?? null : null;
    const tarifa = contrato ? db.tarifas.find((t) => t.id === contrato.tarifaId) ?? null : null;
    nuevasRec.push({
      id: nuevoId('rec'), clienteId: r.clienteId, contratoId: contrato?.id ?? null, reservaOrigenId: r.id, categoriaOrigen: actividad.categoria,
      categoriasPermitidas: categoriasPermitidasRecuperacion(actividad.categoria, tarifa), motivo: 'CANCELACION_CENTRO', estado: 'DISPONIBLE',
      caducaEl: caducidadRecuperacion(contrato, clase.fecha, db.config), usadaEnReservaId: null, creadaEl: ahora.toISOString(), creadaPor: sesion.userId,
      nota: `Clase cancelada por el centro: ${motivo}`,
    });
  }
  let nuevo: Db = {
    ...db,
    contratos,
    recuperaciones: [...recuperaciones, ...nuevasRec],
    listaEspera: db.listaEspera.filter((e) => e.claseId !== clase.id), // 0021: una clase cancelada no tiene lista de espera
    clases: db.clases.map((c) => (c.id === clase.id ? { ...c, estado: 'CANCELADA', motivoCancelacion: motivo, claseAlternativaId, canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : c)),
    reservas: db.reservas.map((r) => (r.claseId === clase.id && r.estado === 'RESERVADA' ? { ...r, estado: 'CANCELADA_CENTRO', canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : r)),
  };
  let avisoId: Id | null = null;
  if (avisar && afectadas.length > 0) {
    const alt = claseAlternativaId ? db.clases.find((c) => c.id === claseAlternativaId) : null;
    const altTxt = festivo ? ' Es día de cierre: esta clase no se recupera.'
      : alt ? ` Se realizará una clase alternativa el ${alt.fecha} a las ${alt.horaInicio}: puedes reservarla con la recuperación que te hemos añadido.`
      : nuevasRec.length > 0 ? ' Te hemos añadido una recuperación para que la uses cuando quieras.' : '';
    const aviso: Aviso = {
      id: nuevoId('avi'), titulo: `Clase cancelada: ${actividad.nombre} ${clase.fecha.slice(8, 10)}/${clase.fecha.slice(5, 7)} ${clase.horaInicio}`,
      cuerpo: `${motivo ? motivo + '.' : 'La clase queda cancelada.'}${altTxt}`,
      destino: { tipo: 'CLASE', claseId: clase.id }, destinatariosIds: Array.from(new Set(afectadas.map((r) => r.clienteId))), importante: true,
      publicadoEl: ahora.toISOString(), publicadoPor: sesion.userId,
    };
    nuevo = { ...nuevo, avisos: [aviso, ...nuevo.avisos] };
    avisoId = aviso.id;
  }
  nuevo = auditar(nuevo, sesion, ahora, 'CANCELAR_CLASE', 'clase', clase.id, `${descClase(db, clase)} · ${afectadas.length} afectados · ${motivo}${festivo ? ' (festivo, sin recuperación)' : ''}`);
  return { db: nuevo, afectados: afectadas.length, avisoId };
}

/** Clases futuras de una franja con alumnos que dejarían de impartirse con estos datos (activa / vigencia). */
export function clasesQueSeCancelarian(db: Db, p: Pick<PlantillaClase, 'id' | 'activa' | 'vigenciaDesde' | 'vigenciaHasta'>, hoy: ISODate): { clases: Clase[]; alumnos: number } {
  const fuera = (c: Clase) => !p.activa || (!!p.vigenciaDesde && c.fecha < p.vigenciaDesde) || (!!p.vigenciaHasta && c.fecha > p.vigenciaHasta);
  const conAlumnos = (c: Clase) => db.reservas.some((r) => r.claseId === c.id && r.estado === 'RESERVADA' && r.origen !== 'AUTOMATICA');
  const clases = db.clases.filter((c) => c.plantillaId === p.id && c.estado === 'PROGRAMADA' && c.fecha >= hoy && fuera(c) && conAlumnos(c));
  const ids = new Set(clases.map((c) => c.id));
  return { clases, alumnos: db.reservas.filter((r) => ids.has(r.claseId) && r.estado === 'RESERVADA').length };
}

export function crearClaseExtraordinaria(ctx: Ctx, args: { actividadId: Id; fecha: ISODate; horaInicio: string; duracionMin: number; monitorId: Id; plazas: number }): Resultado<Clase> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLASES_CREAR_CANCELAR');
  if (e) return fallo(e);
  if (limitadoASusClases(db, sesion)) return fallo(MENSAJE_CLASE_EXTRA_LIMITADA);
  const clase: Clase = {
    id: nuevoId('cla'), plantillaId: null, actividadId: args.actividadId, fecha: args.fecha, horaInicio: args.horaInicio, duracionMin: args.duracionMin,
    monitorId: args.monitorId, plazas: args.plazas, estado: 'PROGRAMADA', extraordinaria: true, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null,
  };
  return ok(auditar({ ...db, clases: [...db.clases, clase] }, sesion, ahora, 'CREAR_CLASE_EXTRA', 'clase', clase.id, descClase(db, clase)), clase);
}

/**
 * Crea o edita una franja del horario semanal. Al editar, las clases futuras de la franja se
 * recrean con los datos nuevos: se eliminan las que no tienen reservas o solo tienen reservas
 * automáticas (horario fijo, que se regeneran) y se conservan las que tienen reservas de
 * clientes o del centro. Devuelve cuántas se han conservado para avisar al administrador.
 */
export function guardarPlantilla(ctx: Ctx, args: { plantilla: Omit<PlantillaClase, 'id'> & { id?: Id } }): Resultado<{ plantilla: PlantillaClase; conservadas: number; canceladas: number; afectados: number; avisoIds: Id[] }> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'HORARIOS_GESTIONAR');
  if (e) return fallo(e);
  if (limitadoASusClases(db, sesion)) return fallo(MENSAJE_HORARIO_LIMITADO);
  const p: PlantillaClase = { ...args.plantilla, id: args.plantilla.id ?? nuevoId('pl') };
  const existe = db.plantillas.some((x) => x.id === p.id);
  let nuevo: Db = { ...db, plantillas: existe ? db.plantillas.map((x) => (x.id === p.id ? p : x)) : [...db.plantillas, p] };
  let conservadas = 0;
  let canceladas = 0;
  let afectados = 0;
  const avisoIds: Id[] = [];
  if (existe) {
    const hoy = aISODate(ahora);
    const soloAutomatica = (r: Reserva) => r.origen === 'AUTOMATICA' && r.estado === 'RESERVADA';
    const futuras = nuevo.clases.filter((c) => c.plantillaId === p.id && c.estado === 'PROGRAMADA' && c.fecha >= hoy);
    const borrables = new Set(futuras.filter((c) => nuevo.reservas.every((r) => r.claseId !== c.id || soloAutomatica(r))).map((c) => c.id));
    conservadas = futuras.length - borrables.size;
    // Las conservadas mantienen su día y hora (sus alumnos ya cuentan con ellas), pero toman la
    // actividad, el monitor, la duración y las plazas nuevas (nunca menos plazas que alumnos apuntados).
    const conservar = new Set(futuras.filter((c) => !borrables.has(c.id)).map((c) => c.id));
    const ocupadas = (claseId: Id) => nuevo.reservas.filter((r) => r.claseId === claseId && r.estado === 'RESERVADA').length;
    nuevo = {
      ...nuevo,
      clases: nuevo.clases.filter((c) => !borrables.has(c.id)).map((c) => (conservar.has(c.id) ? { ...c, actividadId: p.actividadId, monitorId: p.monitorId, duracionMin: p.duracionMin, plazas: Math.max(p.plazas, ocupadas(c.id)) } : c)),
      reservas: nuevo.reservas.filter((r) => !borrables.has(r.claseId)),
      listaEspera: nuevo.listaEspera.filter((e) => !borrables.has(e.claseId)),
    };
    // 0021: si ahora hay más plazas, entran los de la lista de espera.
    for (const id of conservar) nuevo = promoverListaEspera(nuevo, sesion, ahora, id);
    // 0020: las que tienen alumnos y la franja ya no se imparte ese día se cancelan avisando (con recuperación).
    for (const c of clasesQueSeCancelarian(nuevo, p, hoy).clases) {
      const r = cancelarClaseInterna(nuevo, sesion, ahora, c, 'Esta clase deja de impartirse', null, true);
      nuevo = r.db;
      canceladas += 1;
      afectados += r.afectados;
      if (r.avisoId) avisoIds.push(r.avisoId);
    }
    conservadas -= canceladas;
  }
  nuevo = generarClasesPendientes(nuevo, ahora);
  const detalle = existe ? `${p.diaSemana} ${p.horaInicio} · clases futuras recreadas; ${conservadas} conservadas con reservas; ${canceladas} canceladas` : `${p.diaSemana} ${p.horaInicio}`;
  return ok(auditar(nuevo, sesion, ahora, existe ? 'EDITAR_HORARIO' : 'CREAR_HORARIO', 'plantilla', p.id, detalle), { plantilla: p, conservadas, canceladas, afectados, avisoIds });
}

/**
 * Elimina una franja del horario (0021). Se bloquea si algún contrato activo la tiene como clase
 * fija. Sus clases futuras con alumnos se cancelan avisando (con recuperación); las vacías se
 * borran. La franja se conserva marcada como eliminada (historial de sus clases pasadas).
 */
export function eliminarPlantilla(ctx: Ctx, args: { plantillaId: Id }): Resultado<{ borradas: number; canceladas: number; afectados: number; avisoIds: Id[] }> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'HORARIOS_GESTIONAR');
  if (e) return fallo(e);
  if (limitadoASusClases(db, sesion)) return fallo(MENSAJE_HORARIO_LIMITADO);
  const p = db.plantillas.find((x) => x.id === args.plantillaId);
  if (!p) return fallo('La franja no existe.');
  if (p.eliminadaEl) return fallo('La franja ya está eliminada.');
  const fijos = db.contratos.filter((c) => c.estado === 'ACTIVO' && c.franjasFijas.some((f) => f.plantillaId === p.id)).map((c) => nombreCliente(db, c.clienteId)).sort((a, b) => a.localeCompare(b, 'es'));
  if (fijos.length > 0) return fallo(`No se puede eliminar: la tienen como clase fija ${fijos.join(', ')}. Cambia antes sus horarios fijos.`);

  let nuevo: Db = db;
  let borradas = 0;
  let canceladas = 0;
  let afectados = 0;
  const avisoIds: Id[] = [];
  const futuras = db.clases.filter((c) => c.plantillaId === p.id && c.estado === 'PROGRAMADA' && !esPasada(c.fecha, c.horaInicio, ahora));
  for (const c of futuras) {
    if (nuevo.reservas.some((r) => r.claseId === c.id && r.estado === 'RESERVADA')) {
      const r = cancelarClaseInterna(nuevo, sesion, ahora, c, 'Esta clase deja de impartirse', null, true);
      nuevo = r.db;
      canceladas += 1;
      afectados += r.afectados;
      if (r.avisoId) avisoIds.push(r.avisoId);
    } else {
      nuevo = { ...nuevo, clases: nuevo.clases.filter((x) => x.id !== c.id), reservas: nuevo.reservas.filter((r) => r.claseId !== c.id), listaEspera: nuevo.listaEspera.filter((x) => x.claseId !== c.id) };
      borradas += 1;
    }
  }
  nuevo = { ...nuevo, plantillas: nuevo.plantillas.map((x) => (x.id === p.id ? { ...x, activa: false, eliminadaEl: ahora.toISOString() } : x)) };
  const actividad = db.actividades.find((a) => a.id === p.actividadId);
  nuevo = auditar(nuevo, sesion, ahora, 'ELIMINAR_FRANJA', 'plantilla', p.id, `${actividad?.nombre ?? 'Clase'} ${p.horaInicio} · ${borradas} clases vacías borradas; ${canceladas} canceladas (${afectados} alumnos avisados)`);
  return ok(nuevo, { borradas, canceladas, afectados, avisoIds });
}

/** Genera las clases (y reservas automáticas) que falten hasta 2 meses vista. Se ejecuta a diario en producción. */
export function generarClasesPendientes(db: Db, ahora: Date): Db {
  const desde = aISODate(ahora);
  const hasta = sumarDias(desde, 70);
  const nuevas = generarClases(db.plantillas, desde, hasta, db.config, db.clases, () => nuevoId('cla'));
  let clases = nuevas.length ? [...db.clases, ...nuevas] : db.clases;
  // Días de cierre añadidos después: cancelar clases programadas en esos días.
  const cierres = new Set(db.config.diasCierre.map((d) => d.fecha));
  clases = clases.map((c) => (c.estado === 'PROGRAMADA' && cierres.has(c.fecha) && c.fecha >= desde ? { ...c, estado: 'CANCELADA', motivoCancelacion: 'Día de cierre', canceladaEl: ahora.toISOString(), canceladaPor: 'sistema' } : c));
  let reservas = db.reservas;
  for (const c of db.contratos) reservas = generarReservasAutomaticas(c, clases, reservas, () => nuevoId('res'), ahora.toISOString()).reservas;
  // Reservas de clases canceladas por cierre pasan a CANCELADA_CENTRO sin penalizar (sin recuperación: el periodo ya descuenta los cierres).
  const canceladasIds = new Set(clases.filter((c) => c.estado === 'CANCELADA').map((c) => c.id));
  reservas = reservas.map((r) => (r.estado === 'RESERVADA' && canceladasIds.has(r.claseId) ? { ...r, estado: 'CANCELADA_CENTRO', canceladaEl: ahora.toISOString(), canceladaPor: 'sistema' } : r));
  const recuperaciones = caducarVencidas(db.recuperaciones, desde);
  const contratos = db.contratos.map((c) => (c.estado === 'ACTIVO' && c.fechaFin < desde ? { ...c, estado: 'FINALIZADO' as const } : c));
  return { ...db, clases, reservas, recuperaciones, contratos };
}

// ---------------------------------------------------------------------------
// Clientes y contratos
// ---------------------------------------------------------------------------

export function guardarCliente(ctx: Ctx, args: { cliente: Omit<Cliente, 'id'> & { id?: Id } }): Resultado<Cliente> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  const existente = args.cliente.id ? db.clientes.find((c) => c.id === args.cliente.id) : undefined;
  let cliente: Cliente = { ...args.cliente, id: args.cliente.id ?? nuevoId('cli') };
  if (existente && !tienePermiso(sesion, 'CLINICA_VER')) cliente = { ...cliente, clinica: existente.clinica };
  const nuevo: Db = { ...db, clientes: existente ? db.clientes.map((c) => (c.id === cliente.id ? cliente : c)) : [...db.clientes, cliente] };
  return ok(auditar(nuevo, sesion, ahora, existente ? 'EDITAR_CLIENTE' : 'CREAR_CLIENTE', 'cliente', cliente.id, `${cliente.nombre} ${cliente.apellidos}`), cliente);
}

/** Cuota o cobro que se crea junto con el contrato (plan de cobros). */
export type CobroNuevo = Pick<Pago, 'concepto' | 'importeCentimos' | 'venceEl' | 'estado' | 'metodo' | 'pagadoEl'>;

export function crearContrato(ctx: Ctx, args: { contrato: Omit<Contrato, 'id' | 'creadoEl' | 'creadoPor' | 'estado'>; cobros?: CobroNuevo[]; incluirPasadas?: boolean }): Resultado<Contrato> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  const tarifa = db.tarifas.find((t) => t.id === args.contrato.tarifaId);
  if (!tarifa) return fallo('Tarifa no válida.');
  const contrato: Contrato = {
    ...args.contrato, id: nuevoId('con'), estado: 'ACTIVO', creadoEl: ahora.toISOString(), creadoPor: sesion.userId,
    sesionesRestantes: tarifa.tipo === 'BONO' ? (args.contrato.sesionesRestantes ?? tarifa.bono?.sesiones ?? 0) : null,
  };
  // Un cliente solo tiene un contrato activo: los anteriores se finalizan.
  const previos = new Set(db.contratos.filter((c) => c.clienteId === contrato.clienteId && c.estado === 'ACTIVO').map((c) => c.id));
  const contratos = db.contratos.map((c) => (previos.has(c.id) ? { ...c, estado: 'FINALIZADO' as const } : c)).concat(contrato);
  let nuevo: Db = { ...db, contratos };
  // Como en el servidor: desde hoy, salvo que se pidan también las clases pasadas desde el inicio.
  const hoy = aISODate(ahora);
  // 0022: las clases fijas futuras del contrato anterior pasan al nuevo si la franja sigue; si no, se quitan.
  const desde = contrato.fechaInicio > hoy ? contrato.fechaInicio : hoy;
  const franjasNuevas = new Set(contrato.modalidad === 'FIJO' ? contrato.franjasFijas.map((f) => f.plantillaId) : []);
  const claseDe = indexar(db.clases);
  const fijaPrevia = (r: Reserva) => previos.has(r.contratoId ?? '') && r.origen === 'AUTOMATICA' && r.estado === 'RESERVADA' && (claseDe.get(r.claseId)?.fecha ?? '') >= desde;
  const sigue = (r: Reserva) => { const c = claseDe.get(r.claseId); return !!c && !!c.plantillaId && franjasNuevas.has(c.plantillaId) && c.fecha <= contrato.fechaFin; };
  nuevo = { ...nuevo, reservas: nuevo.reservas.filter((r) => !fijaPrevia(r) || sigue(r)).map((r) => (fijaPrevia(r) && sigue(r) ? { ...r, contratoId: contrato.id } : r)) };
  const reservas = generarReservasAutomaticas(contrato, nuevo.clases.filter((c) => args.incluirPasadas || c.fecha >= hoy), nuevo.reservas, () => nuevoId('res'), ahora.toISOString()).reservas;
  const pagos = (args.cobros ?? []).map((q): Pago => ({
    ...q, id: nuevoId('pag'), contratoId: contrato.id, clienteId: contrato.clienteId, creadoEl: ahora.toISOString(),
    pagadoEl: q.estado === 'PAGADO' ? q.pagadoEl ?? ahora.toISOString() : null,
  }));
  nuevo = { ...nuevo, reservas, pagos: [...nuevo.pagos, ...pagos] };
  return ok(auditar(nuevo, sesion, ahora, 'CREAR_CONTRATO', 'contrato', contrato.id, `${nombreCliente(db, contrato.clienteId)}: ${tarifa.nombre} ${contrato.fechaInicio}→${contrato.fechaFin}`), contrato);
}

/** Datos de un contrato que se pueden cambiar después de crearlo (la tarifa y el inicio no). */
export interface CambiosContrato {
  fechaFin: ISODate;
  franjasFijas: Contrato['franjasFijas'];
  notas: string;
  oferta: Oferta;
  importeCentimos: number | null;
  metodoPago: MetodoPago | null;
  /** Solo bonos: corregir las sesiones que quedan. */
  sesionesRestantes: number | null;
  /** Horario fijo con inicio anterior a hoy: apuntar también a las clases ya pasadas desde el inicio. */
  incluirPasadas?: boolean;
}

/**
 * Modifica un contrato activo. Si cambian las franjas fijas o la fecha de fin, las reservas
 * automáticas futuras que ya no corresponden se eliminan y se generan las que falten.
 * Las reservas pasadas y las hechas a mano no se tocan.
 */
export function editarContrato(ctx: Ctx, args: { contratoId: Id; cambios: CambiosContrato }): Resultado<Contrato> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  const actual = db.contratos.find((c) => c.id === args.contratoId);
  if (!actual) return fallo('El contrato no existe.');
  if (actual.estado !== 'ACTIVO') return fallo('Solo se puede modificar un contrato activo.');
  const k = args.cambios;
  if (k.fechaFin < actual.fechaInicio) return fallo('La fecha de fin debe ser posterior al inicio.');
  if (actual.modalidad === 'FIJO' && k.franjasFijas.length === 0) return fallo('Un contrato de horario fijo necesita al menos una franja.');
  const tarifa = db.tarifas.find((t) => t.id === actual.tarifaId);
  const contrato: Contrato = {
    ...actual, fechaFin: k.fechaFin, notas: k.notas, oferta: k.oferta, importeCentimos: k.importeCentimos, metodoPago: k.metodoPago,
    franjasFijas: actual.modalidad === 'FIJO' ? k.franjasFijas : [],
    sesionesRestantes: tarifa?.tipo === 'BONO' ? Math.max(0, k.sesionesRestantes ?? actual.sesionesRestantes ?? 0) : actual.sesionesRestantes,
  };
  const hoy = aISODate(ahora);
  const franjas = new Set(contrato.franjasFijas.map((f) => f.plantillaId));
  const claseDe = indexar(db.clases);
  const sobra = (r: Reserva) => {
    if (r.contratoId !== contrato.id || r.origen !== 'AUTOMATICA' || r.estado !== 'RESERVADA') return false;
    const c = claseDe.get(r.claseId);
    return !!c && c.fecha >= hoy && (!c.plantillaId || !franjas.has(c.plantillaId) || c.fecha > contrato.fechaFin);
  };
  let reservas = db.reservas.filter((r) => !sobra(r));
  reservas = generarReservasAutomaticas(contrato, db.clases.filter((c) => args.cambios.incluirPasadas || c.fecha >= hoy), reservas, () => nuevoId('res'), ahora.toISOString()).reservas;
  const nuevo: Db = { ...db, contratos: db.contratos.map((c) => (c.id === contrato.id ? contrato : c)), reservas };
  return ok(auditar(nuevo, sesion, ahora, 'EDITAR_CONTRATO', 'contrato', contrato.id, `${nombreCliente(db, contrato.clienteId)}: fin ${contrato.fechaFin}`), contrato);
}

/** Crea o modifica un cobro (cuota del plan o cobro suelto). */
export function guardarPago(ctx: Ctx, args: { pago: Omit<Pago, 'id' | 'creadoEl'> & { id?: Id } }): Resultado<Pago> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  if (!Number.isFinite(args.pago.importeCentimos) || args.pago.importeCentimos < 0) return fallo('El importe no es válido.');
  if (!args.pago.concepto.trim()) return fallo('Escribe un concepto (por ejemplo, "Mes 1").');
  const existente = args.pago.id ? db.pagos.find((p) => p.id === args.pago.id) : undefined;
  const pago: Pago = {
    ...args.pago, concepto: args.pago.concepto.trim(), id: existente?.id ?? nuevoId('pag'), creadoEl: existente?.creadoEl ?? ahora.toISOString(),
    pagadoEl: args.pago.estado === 'PAGADO' ? args.pago.pagadoEl ?? ahora.toISOString() : null,
  };
  const nuevo: Db = { ...db, pagos: existente ? db.pagos.map((p) => (p.id === pago.id ? pago : p)) : [...db.pagos, pago] };
  return ok(auditar(nuevo, sesion, ahora, existente ? 'EDITAR_PAGO' : 'CREAR_PAGO', 'pago', pago.id, `${nombreCliente(db, pago.clienteId)}: ${pago.concepto} · ${pago.importeCentimos / 100} € · ${pago.estado}`), pago);
}

export function borrarPago(ctx: Ctx, args: { id: Id }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  const pago = db.pagos.find((p) => p.id === args.id);
  if (!pago) return fallo('El cobro no existe.');
  return ok(auditar({ ...db, pagos: db.pagos.filter((p) => p.id !== args.id) }, sesion, ahora, 'BORRAR_PAGO', 'pago', pago.id, `${nombreCliente(db, pago.clienteId)}: ${pago.concepto}`), undefined);
}

/**
 * Vuelve a generar las reservas de horario fijo que falten de un contrato (clases
 * futuras de sus franjas con plaza). Útil si al contratar no se apuntó a ninguna clase
 * (franja sin clases o completa) o tras cambios en el horario. Devuelve cuántas crea.
 */
export function rehacerReservasFijas(ctx: Ctx, args: { contratoId: Id }): Resultado<{ creadas: number }> {
  const { db, sesion, ahora } = ctx;
  if (!tienePermiso(sesion, 'RESERVAS_GESTIONAR') && !tienePermiso(sesion, 'CLIENTES_EDITAR')) return fallo('No tienes permiso para: RESERVAS_GESTIONAR');
  const contrato = db.contratos.find((c) => c.id === args.contratoId);
  if (!contrato) return fallo('El contrato no existe.');
  if (contrato.modalidad !== 'FIJO' || contrato.estado !== 'ACTIVO') return fallo('Solo para contratos activos de horario fijo.');
  const hoy = aISODate(ahora);
  const g = generarReservasAutomaticas(contrato, db.clases.filter((c) => c.fecha >= hoy), db.reservas, () => nuevoId('res'), ahora.toISOString());
  const nuevo: Db = { ...db, reservas: g.reservas };
  return ok(auditar(nuevo, sesion, ahora, 'RESERVAS_AUTOMATICAS', 'contrato', contrato.id, `${nombreCliente(db, contrato.clienteId)}: ${g.creadas} reservas generadas`), { creadas: g.creadas });
}

/** Lo mismo para todos los contratos activos de horario fijo (administrador). */
export function rehacerTodasReservasFijas(ctx: Ctx, _args: Record<string, never>): Resultado<{ contratos: number; creadas: number }> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'TRABAJADOR' || sesion.rol !== 'ADMIN') return fallo('Solo el administrador puede rehacer las reservas de todos.');
  const hoy = aISODate(ahora);
  let reservas = db.reservas;
  let contratos = 0;
  let creadas = 0;
  for (const c of db.contratos) {
    if (c.modalidad !== 'FIJO' || c.estado !== 'ACTIVO') continue;
    const g = generarReservasAutomaticas(c, db.clases.filter((x) => x.fecha >= hoy), reservas, () => nuevoId('res'), ahora.toISOString());
    if (g.creadas === 0) continue;
    reservas = g.reservas;
    contratos += 1;
    creadas += g.creadas;
  }
  return ok(auditar({ ...db, reservas }, sesion, ahora, 'RESERVAS_AUTOMATICAS', 'sistema', '-', `${creadas} reservas generadas en ${contratos} contratos`), { contratos, creadas });
}

export function finalizarContrato(ctx: Ctx, args: { contratoId: Id; cancelarReservasFuturas: boolean }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  const hoy = aISODate(ahora);
  const clasesFuturas = new Set(db.clases.filter((c) => c.fecha >= hoy).map((c) => c.id));
  const nuevo: Db = {
    ...db,
    contratos: db.contratos.map((c) => (c.id === args.contratoId ? { ...c, estado: 'CANCELADO', fechaFin: hoy < c.fechaFin ? hoy : c.fechaFin } : c)),
    // 0023: las clases fijas futuras se quitan (el horario fijo va con el contrato); las demás se cancelan por el centro.
    reservas: args.cancelarReservasFuturas
      ? db.reservas
          .filter((r) => !(r.contratoId === args.contratoId && r.estado === 'RESERVADA' && r.origen === 'AUTOMATICA' && clasesFuturas.has(r.claseId)))
          .map((r) => (r.contratoId === args.contratoId && r.estado === 'RESERVADA' && clasesFuturas.has(r.claseId) ? { ...r, estado: 'CANCELADA_CENTRO', canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : r))
      : db.reservas,
  };
  return ok(auditar(nuevo, sesion, ahora, 'FINALIZAR_CONTRATO', 'contrato', args.contratoId, ''), undefined);
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

export function publicarAviso(ctx: Ctx, args: { titulo: string; cuerpo: string; destino: DestinoAviso; importante: boolean }): Resultado<Aviso> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'AVISOS_ENVIAR');
  if (e) return fallo(e);
  if (limitadoASusClases(db, sesion)) {
    const destino = args.destino;
    if (destino.tipo !== 'CLASE') return fallo(MENSAJE_AVISO_LIMITADO);
    const clase = db.clases.find((c) => c.id === destino.claseId);
    if (!clase) return fallo('La clase no existe.');
    const ea = exigirClaseMia(db, sesion, clase);
    if (ea) return fallo(ea);
  }
  const destinatariosIds = resolverDestinatarios(db, args.destino);
  const aviso: Aviso = { id: nuevoId('avi'), ...args, destinatariosIds, publicadoEl: ahora.toISOString(), publicadoPor: sesion.userId };
  return ok(auditar({ ...db, avisos: [aviso, ...db.avisos] }, sesion, ahora, 'PUBLICAR_AVISO', 'aviso', aviso.id, `${aviso.titulo} → ${destinatariosIds.length} clientes`), aviso);
}

export function resolverDestinatarios(db: Db, destino: DestinoAviso): Id[] {
  switch (destino.tipo) {
    case 'TODOS':
      return db.clientes.filter((c) => c.activo).map((c) => c.id);
    case 'CLIENTES':
      return destino.clienteIds;
    case 'CLASE':
      return Array.from(new Set(db.reservas.filter((r) => r.claseId === destino.claseId && (r.estado === 'RESERVADA' || r.estado === 'CANCELADA_CENTRO')).map((r) => r.clienteId)));
    case 'ACTIVIDAD': {
      const clasesAct = new Set(db.clases.filter((c) => c.actividadId === destino.actividadId).map((c) => c.id));
      return Array.from(new Set(db.reservas.filter((r) => clasesAct.has(r.claseId) && r.estado === 'RESERVADA').map((r) => r.clienteId)));
    }
  }
}

export function marcarAvisoLeido(ctx: Ctx, args: { avisoId: Id }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'CLIENTE') return ok(db, undefined);
  if (db.lecturas.some((l) => l.avisoId === args.avisoId && l.clienteId === sesion.clienteId)) return ok(db, undefined);
  return ok({ ...db, lecturas: [...db.lecturas, { avisoId: args.avisoId, clienteId: sesion.clienteId, leidoEl: ahora.toISOString() }] }, undefined);
}

export function actualizarPreferenciasCliente(ctx: Ctx, args: { notificacionesPush?: boolean; telefono?: string; email?: string; direccion?: string; fechaNacimiento?: ISODate | null }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'CLIENTE') return fallo('Solo para clientes.');
  const nuevo: Db = { ...db, clientes: db.clientes.map((c) => (c.id === sesion.clienteId ? { ...c, ...limpiar(args) } : c)) };
  return ok(auditar(nuevo, sesion, ahora, 'EDITAR_PERFIL', 'cliente', sesion.clienteId, Object.keys(limpiar(args)).join(',')), undefined);
}

/**
 * Pone o quita la foto de un cliente. Un cliente solo la suya; un trabajador con
 * CLIENTES_EDITAR (y, con ámbito SUS_CLASES, solo de sus alumnos). `fotoUrl` null = quitar.
 */
export function actualizarFotoCliente(ctx: Ctx, args: { clienteId?: Id; fotoUrl: string | null }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  let clienteId: Id;
  if (sesion.tipo === 'CLIENTE') {
    if (args.clienteId && args.clienteId !== sesion.clienteId) return fallo('Solo puedes cambiar tu propia foto.');
    clienteId = sesion.clienteId;
  } else {
    const e = exigir(sesion, 'CLIENTES_EDITAR');
    if (e) return fallo(e);
    if (!args.clienteId) return fallo('Falta el cliente.');
    clienteId = args.clienteId;
    if (limitadoASusClases(db, sesion) && !esAlumnoMio(db, sesion, clienteId)) return fallo(MENSAJE_CLIENTE_AJENO);
  }
  if (!db.clientes.some((c) => c.id === clienteId)) return fallo('Cliente no encontrado.');
  const fotoUrl = args.fotoUrl && args.fotoUrl.trim() ? args.fotoUrl : null;
  const nuevo: Db = { ...db, clientes: db.clientes.map((c) => (c.id === clienteId ? { ...c, fotoUrl } : c)) };
  return ok(auditar(nuevo, sesion, ahora, fotoUrl ? 'FOTO_CLIENTE' : 'QUITAR_FOTO_CLIENTE', 'cliente', clienteId, nombreCliente(db, clienteId)), undefined);
}

/**
 * El cliente acepta la política de privacidad (docs/PRIVACIDAD.md) desde la app: se guarda el
 * instante y la versión vigente. Solo el propio cliente; el personal usa registrarConsentimientoPapel.
 */
export function registrarConsentimiento(ctx: Ctx, _args: Record<string, never>): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'CLIENTE') return fallo('Solo el propio cliente puede aceptar la política de privacidad.');
  const consentimientoEl = ahora.toISOString();
  const nuevo: Db = { ...db, clientes: db.clientes.map((c) => (c.id === sesion.clienteId ? { ...c, consentimientoEl, consentimientoVersion: VERSION_POLITICA_PRIVACIDAD } : c)) };
  return ok(auditar(nuevo, sesion, ahora, 'CONSENTIMIENTO', 'cliente', sesion.clienteId, `${nombreCliente(db, sesion.clienteId)}: versión ${VERSION_POLITICA_PRIVACIDAD}`), undefined);
}

/**
 * El personal (CLIENTES_EDITAR; con ámbito SUS_CLASES solo sus alumnos) registra que el cliente
 * firmó el consentimiento en papel en recepción. Versión 'papel'.
 */
export function registrarConsentimientoPapel(ctx: Ctx, args: { clienteId: Id }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  if (!args.clienteId) return fallo('Falta el cliente.');
  if (!db.clientes.some((c) => c.id === args.clienteId)) return fallo('Cliente no encontrado.');
  if (limitadoASusClases(db, sesion) && !esAlumnoMio(db, sesion, args.clienteId)) return fallo(MENSAJE_CLIENTE_AJENO);
  const consentimientoEl = ahora.toISOString();
  const nuevo: Db = { ...db, clientes: db.clientes.map((c) => (c.id === args.clienteId ? { ...c, consentimientoEl, consentimientoVersion: CONSENTIMIENTO_PAPEL } : c)) };
  return ok(auditar(nuevo, sesion, ahora, 'CONSENTIMIENTO_PAPEL', 'cliente', args.clienteId, `${nombreCliente(db, args.clienteId)}: firmado en papel`), undefined);
}

function limpiar<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------------------
// Catálogo y configuración
// ---------------------------------------------------------------------------

export function guardarTarifa(ctx: Ctx, args: { tarifa: Omit<Tarifa, 'id'> & { id?: Id } }): Resultado<Tarifa> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'TARIFAS_GESTIONAR');
  if (e) return fallo(e);
  const t: Tarifa = { ...args.tarifa, id: args.tarifa.id ?? nuevoId('tar') };
  const existe = db.tarifas.some((x) => x.id === t.id);
  return ok(auditar({ ...db, tarifas: existe ? db.tarifas.map((x) => (x.id === t.id ? t : x)) : [...db.tarifas, t] }, sesion, ahora, existe ? 'EDITAR_TARIFA' : 'CREAR_TARIFA', 'tarifa', t.id, t.nombre), t);
}

export function guardarActividad(ctx: Ctx, args: { actividad: Omit<Actividad, 'id'> & { id?: Id } }): Resultado<Actividad> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'TARIFAS_GESTIONAR');
  if (e) return fallo(e);
  const a: Actividad = { ...args.actividad, id: args.actividad.id ?? nuevoId('act') };
  const existe = db.actividades.some((x) => x.id === a.id);
  return ok(auditar({ ...db, actividades: existe ? db.actividades.map((x) => (x.id === a.id ? a : x)) : [...db.actividades, a] }, sesion, ahora, existe ? 'EDITAR_ACTIVIDAD' : 'CREAR_ACTIVIDAD', 'actividad', a.id, a.nombre), a);
}

export function guardarTrabajador(ctx: Ctx, args: { trabajador: Omit<Trabajador, 'id'> & { id?: Id } }): Resultado<Trabajador> {
  const { db, sesion, ahora } = ctx;
  // La gestión del equipo (fichas, permisos y ámbito) es exclusiva del rol ADMIN.
  if (sesion.tipo !== 'TRABAJADOR' || sesion.rol !== 'ADMIN') return fallo(MENSAJE_SOLO_ADMIN_EQUIPO);
  const t: Trabajador = { ...args.trabajador, id: args.trabajador.id ?? nuevoId('tra') };
  if (t.rol === 'ADMIN') t.ambito = 'CENTRO'; // un administrador siempre tiene ámbito CENTRO
  const existe = db.trabajadores.some((x) => x.id === t.id);
  let usuarios = db.usuarios;
  if (!t.userId) {
    const userId = nuevoId('usr');
    t.userId = userId;
    usuarios = [...usuarios, { id: userId, email: t.email, tipo: 'TRABAJADOR', clienteId: null, trabajadorId: t.id }];
  }
  return ok(auditar({ ...db, usuarios, trabajadores: existe ? db.trabajadores.map((x) => (x.id === t.id ? t : x)) : [...db.trabajadores, t] }, sesion, ahora, existe ? 'EDITAR_TRABAJADOR' : 'CREAR_TRABAJADOR', 'trabajador', t.id, `${t.nombre} ${t.apellidos} · ${t.permisos.length} permisos`), t);
}

export function actualizarConfig(ctx: Ctx, args: { config: Partial<ConfigCentro> }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'TRABAJADOR' || sesion.rol !== 'ADMIN') return fallo('Solo el administrador puede cambiar la configuración.');
  let nuevo: Db = { ...db, config: { ...db.config, ...args.config } };
  if (args.config.diasCierre) nuevo = generarClasesPendientes(nuevo, ahora);
  return ok(auditar(nuevo, sesion, ahora, 'CONFIG', 'config', '-', Object.keys(args.config).join(',')), undefined);
}

// ---------------------------------------------------------------------------
// Portada del cliente (carrusel): solo el administrador
// ---------------------------------------------------------------------------

export const MENSAJE_SOLO_ADMIN_PORTADA = 'Solo el administrador puede cambiar las fotos de la portada.';
/** Tope razonable de fotos en el carrusel (peso de la portada en el móvil). */
export const MAX_PORTADA = 12;

function exigirAdmin(sesion: Sesion): string | null {
  return sesion.tipo === 'TRABAJADOR' && sesion.rol === 'ADMIN' ? null : MENSAJE_SOLO_ADMIN_PORTADA;
}

/** Crea o actualiza una foto de la portada (url, pie, orden, activa). Sin `orden` al crear, se pone al final. */
export function guardarPortadaImagen(ctx: Ctx, args: { imagen: Omit<PortadaImagen, 'id' | 'creadoEl' | 'orden'> & { id?: Id; orden?: number } }): Resultado<PortadaImagen> {
  const { db, sesion, ahora } = ctx;
  const e = exigirAdmin(sesion);
  if (e) return fallo(e);
  const existente = args.imagen.id ? db.portada.find((x) => x.id === args.imagen.id) : undefined;
  if (args.imagen.id && !existente) return fallo('Foto no encontrada.');
  const url = (args.imagen.url ?? '').trim();
  if (!url) return fallo('Falta la imagen.');
  if (!existente && db.portada.length >= MAX_PORTADA) return fallo(`La portada admite como mucho ${MAX_PORTADA} fotos. Borra alguna antes de añadir otra.`);
  const siguienteOrden = db.portada.reduce((m, x) => Math.max(m, x.orden), 0) + 1;
  const img: PortadaImagen = {
    id: existente?.id ?? nuevoId('por'),
    url,
    pie: (args.imagen.pie ?? '').trim(),
    orden: args.imagen.orden ?? existente?.orden ?? siguienteOrden,
    activa: args.imagen.activa ?? true,
    creadoEl: existente?.creadoEl ?? ahora.toISOString(),
  };
  const portada = existente ? db.portada.map((x) => (x.id === img.id ? img : x)) : [...db.portada, img];
  return ok(auditar({ ...db, portada: portadaOrdenada(portada) }, sesion, ahora, existente ? 'EDITAR_PORTADA' : 'CREAR_PORTADA', 'portada', img.id, img.pie || `Foto ${img.orden}`), img);
}

export function borrarPortadaImagen(ctx: Ctx, args: { id: Id }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigirAdmin(sesion);
  if (e) return fallo(e);
  const img = db.portada.find((x) => x.id === args.id);
  if (!img) return fallo('Foto no encontrada.');
  return ok(auditar({ ...db, portada: db.portada.filter((x) => x.id !== args.id) }, sesion, ahora, 'BORRAR_PORTADA', 'portada', img.id, img.pie || `Foto ${img.orden}`), undefined);
}

/** Reordena el carrusel: `ids` en el orden deseado (las que falten conservan su sitio relativo al final). */
export function ordenarPortada(ctx: Ctx, args: { ids: Id[] }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigirAdmin(sesion);
  if (e) return fallo(e);
  const posicion = new Map(args.ids.map((id, i) => [id, i]));
  if (args.ids.some((id) => !db.portada.some((x) => x.id === id))) return fallo('Foto no encontrada.');
  const ordenadas = [...db.portada].sort((a, b) => (posicion.get(a.id) ?? Infinity) - (posicion.get(b.id) ?? Infinity) || a.orden - b.orden);
  const portada = ordenadas.map((x, i) => ({ ...x, orden: i + 1 }));
  return ok(auditar({ ...db, portada }, sesion, ahora, 'ORDENAR_PORTADA', 'portada', '-', `${portada.length} fotos`), undefined);
}

// ---------------------------------------------------------------------------
// Cliente del mes (0016)
// ---------------------------------------------------------------------------

/**
 * Anuncia (o cambia) el cliente del mes. Con `aviso`, el ganador recibe un aviso personal
 * (y, en Supabase, la notificación en el móvil). Solo el administrador.
 */
export function anunciarClienteDelMes(
  ctx: Ctx,
  args: { mes: ISODate; clienteId: Id; clases: number; motivo: string; aviso?: { titulo: string; cuerpo: string } | null },
): Resultado<{ avisoId: Id | null }> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'TRABAJADOR' || sesion.rol !== 'ADMIN') return fallo('Solo el administrador puede elegir al cliente del mes.');
  if (!db.clientes.some((c) => c.id === args.clienteId)) return fallo('El cliente no existe.');
  const mes = `${args.mes.slice(0, 7)}-01`;
  const anterior = db.premios.find((p) => p.mes === mes);
  const mismo = anterior?.clienteId === args.clienteId;
  const premio: PremioMes = {
    mes, clienteId: args.clienteId, clases: Math.max(0, Math.round(args.clases)), motivo: args.motivo, anunciadoEl: ahora.toISOString(),
    publico: mismo ? anterior!.publico : null, nombrePublico: mismo ? anterior!.nombrePublico : '',
  };
  let nuevo: Db = { ...db, premios: [premio, ...db.premios.filter((p) => p.mes !== mes)].sort((a, b) => b.mes.localeCompare(a.mes)) };
  let avisoId: Id | null = null;
  if (args.aviso?.titulo.trim()) {
    const r = publicarAviso({ db: nuevo, sesion, ahora }, { titulo: args.aviso.titulo, cuerpo: args.aviso.cuerpo, destino: { tipo: 'CLIENTES', clienteIds: [args.clienteId] }, importante: true });
    if (!r.ok) return fallo(r.error);
    nuevo = r.db;
    avisoId = r.valor.id;
  }
  return ok(auditar(nuevo, sesion, ahora, 'CLIENTE_DEL_MES', 'cliente', args.clienteId, `Cliente del mes de ${mes.slice(5, 7)}/${mes.slice(0, 4)}`), { avisoId });
}

export function quitarClienteDelMes(ctx: Ctx, args: { mes: ISODate }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  if (sesion.tipo !== 'TRABAJADOR' || sesion.rol !== 'ADMIN') return fallo('Solo el administrador puede quitar el premio.');
  const mes = `${args.mes.slice(0, 7)}-01`;
  return ok(auditar({ ...db, premios: db.premios.filter((p) => p.mes !== mes) }, sesion, ahora, 'QUITAR_CLIENTE_DEL_MES', 'premio', mes.slice(0, 7), ''), undefined);
}

/** El ganador decide si los demás alumnos lo ven en la app. */
export function responderClienteDelMes(ctx: Ctx, args: { mes: ISODate; publico: boolean }): Resultado<void> {
  const { db, sesion } = ctx;
  if (sesion.tipo !== 'CLIENTE') return fallo('Solo para alumnos.');
  const mes = `${args.mes.slice(0, 7)}-01`;
  const premio = db.premios.find((p) => p.mes === mes && p.clienteId === sesion.clienteId);
  if (!premio) return fallo('Ese premio no es tuyo.');
  const c = db.clientes.find((x) => x.id === sesion.clienteId);
  const inicial = c?.apellidos.trim().charAt(0);
  const nombrePublico = args.publico && c ? `${c.nombre}${inicial ? ` ${inicial}.` : ''}` : '';
  return ok({ ...db, premios: db.premios.map((p) => (p === premio ? { ...p, publico: args.publico, nombrePublico } : p)) }, undefined);
}
