/**
 * Comandos: todas las modificaciones de datos pasan por aquí.
 * Son funciones puras (Db, sesión, argumentos) → nuevo Db o error, de modo que
 * la misma lógica puede ejecutarse en el navegador (demo) o en el servidor
 * (Supabase Edge Functions) sin cambios.
 */
import type {
  Actividad, Asistencia, Aviso, Categoria, Clase, Cliente, ConfigCentro, Contrato, DestinoAviso, Id, ISODate, MetodoPago, Oferta, Pago,
  PlantillaClase, PortadaImagen, Recuperacion, RegistroAuditoria, Reserva, Sesion, Tarifa, Trabajador, Permiso,
} from '@/domain/types';
import { tienePermiso } from '@/domain/types';
import {
  MENSAJE_AVISO_LIMITADO, MENSAJE_CLASE_AJENA, MENSAJE_CLASE_EXTRA_LIMITADA, MENSAJE_CLIENTE_AJENO, MENSAJE_HORARIO_LIMITADO, MENSAJE_SOLO_ADMIN_EQUIPO,
  esAlumnoMio, limitadoASusClases, puedeGestionarClase,
} from '@/domain/ambito';
import { aISODate, sumarDias } from '@/domain/fechas';
import { CONSENTIMIENTO_PAPEL, VERSION_POLITICA_PRIVACIDAD } from '@/domain/privacidad';
import {
  caducidadRecuperacion, categoriasPermitidasRecuperacion, clasificarCancelacion, evaluarReserva, generarClases,
  generarReservasAutomaticas, plazasLibres, puedeCancelarCliente, puedeGenerarRecuperacion, caducarVencidas,
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
  return ok(nuevo, { recuperable });
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
  const actividad = db.actividades.find((a) => a.id === clase.actividadId)!;
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
    if (r.origen === 'CLASE_SUELTA') continue;
    const contrato = r.contratoId ? db.contratos.find((c) => c.id === r.contratoId) ?? null : null;
    const tarifa = contrato ? db.tarifas.find((t) => t.id === contrato.tarifaId) ?? null : null;
    nuevasRec.push({
      id: nuevoId('rec'), clienteId: r.clienteId, contratoId: contrato?.id ?? null, reservaOrigenId: r.id, categoriaOrigen: actividad.categoria,
      categoriasPermitidas: categoriasPermitidasRecuperacion(actividad.categoria, tarifa), motivo: 'CANCELACION_CENTRO', estado: 'DISPONIBLE',
      caducaEl: caducidadRecuperacion(contrato, clase.fecha, db.config), usadaEnReservaId: null, creadaEl: ahora.toISOString(), creadaPor: sesion.userId,
      nota: `Clase cancelada por el centro: ${args.motivo}`,
    });
  }
  let nuevo: Db = {
    ...db,
    contratos,
    recuperaciones: [...recuperaciones, ...nuevasRec],
    clases: db.clases.map((c) => (c.id === clase.id ? { ...c, estado: 'CANCELADA', motivoCancelacion: args.motivo, claseAlternativaId: args.claseAlternativaId, canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : c)),
    reservas: db.reservas.map((r) => (r.claseId === clase.id && r.estado === 'RESERVADA' ? { ...r, estado: 'CANCELADA_CENTRO', canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : r)),
  };
  if (args.avisar && afectadas.length > 0) {
    const alt = args.claseAlternativaId ? db.clases.find((c) => c.id === args.claseAlternativaId) : null;
    const altTxt = alt ? ` Se realizará una clase alternativa el ${alt.fecha} a las ${alt.horaInicio}: puedes reservarla con la recuperación que te hemos añadido.` : ' Te hemos añadido una recuperación para que la uses cuando quieras.';
    const aviso: Aviso = {
      id: nuevoId('avi'), titulo: `Clase cancelada: ${actividad.nombre} ${clase.fecha} ${clase.horaInicio}`,
      cuerpo: `${args.motivo ? args.motivo + '.' : 'La clase queda cancelada.'}${altTxt}`,
      destino: { tipo: 'CLASE', claseId: clase.id }, destinatariosIds: Array.from(new Set(afectadas.map((r) => r.clienteId))), importante: true,
      publicadoEl: ahora.toISOString(), publicadoPor: sesion.userId,
    };
    nuevo = { ...nuevo, avisos: [aviso, ...nuevo.avisos] };
  }
  nuevo = auditar(nuevo, sesion, ahora, 'CANCELAR_CLASE', 'clase', clase.id, `${descClase(db, clase)} · ${afectadas.length} afectados · ${args.motivo}`);
  return ok(nuevo, { afectados: afectadas.length });
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
export function guardarPlantilla(ctx: Ctx, args: { plantilla: Omit<PlantillaClase, 'id'> & { id?: Id } }): Resultado<{ plantilla: PlantillaClase; conservadas: number }> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'HORARIOS_GESTIONAR');
  if (e) return fallo(e);
  if (limitadoASusClases(db, sesion)) return fallo(MENSAJE_HORARIO_LIMITADO);
  const p: PlantillaClase = { ...args.plantilla, id: args.plantilla.id ?? nuevoId('pl') };
  const existe = db.plantillas.some((x) => x.id === p.id);
  let nuevo: Db = { ...db, plantillas: existe ? db.plantillas.map((x) => (x.id === p.id ? p : x)) : [...db.plantillas, p] };
  let conservadas = 0;
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
    };
  }
  nuevo = generarClasesPendientes(nuevo, ahora);
  const detalle = existe ? `${p.diaSemana} ${p.horaInicio} · clases futuras recreadas; ${conservadas} conservadas con reservas` : `${p.diaSemana} ${p.horaInicio}`;
  return ok(auditar(nuevo, sesion, ahora, existe ? 'EDITAR_HORARIO' : 'CREAR_HORARIO', 'plantilla', p.id, detalle), { plantilla: p, conservadas });
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
  for (const c of db.contratos) reservas = reservas.concat(generarReservasAutomaticas(c, clases, reservas, () => nuevoId('res'), ahora.toISOString()));
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

export function crearContrato(ctx: Ctx, args: { contrato: Omit<Contrato, 'id' | 'creadoEl' | 'creadoPor' | 'estado'>; cobros?: CobroNuevo[] }): Resultado<Contrato> {
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
  const contratos = db.contratos.map((c) => (c.clienteId === contrato.clienteId && c.estado === 'ACTIVO' ? { ...c, estado: 'FINALIZADO' as const } : c)).concat(contrato);
  let nuevo: Db = { ...db, contratos };
  const reservas = nuevo.reservas.concat(generarReservasAutomaticas(contrato, nuevo.clases, nuevo.reservas, () => nuevoId('res'), ahora.toISOString()));
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
  reservas = reservas.concat(generarReservasAutomaticas(contrato, db.clases.filter((c) => c.fecha >= hoy), reservas, () => nuevoId('res'), ahora.toISOString()));
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

export function finalizarContrato(ctx: Ctx, args: { contratoId: Id; cancelarReservasFuturas: boolean }): Resultado<void> {
  const { db, sesion, ahora } = ctx;
  const e = exigir(sesion, 'CLIENTES_EDITAR');
  if (e) return fallo(e);
  const hoy = aISODate(ahora);
  const clasesFuturas = new Set(db.clases.filter((c) => c.fecha >= hoy).map((c) => c.id));
  const nuevo: Db = {
    ...db,
    contratos: db.contratos.map((c) => (c.id === args.contratoId ? { ...c, estado: 'CANCELADO', fechaFin: hoy < c.fechaFin ? hoy : c.fechaFin } : c)),
    reservas: args.cancelarReservasFuturas
      ? db.reservas.map((r) => (r.contratoId === args.contratoId && r.estado === 'RESERVADA' && clasesFuturas.has(r.claseId) ? { ...r, estado: 'CANCELADA_CENTRO', canceladaEl: ahora.toISOString(), canceladaPor: sesion.userId } : r))
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
