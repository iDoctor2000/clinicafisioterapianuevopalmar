import type {
  Actividad,
  Categoria,
  Clase,
  ConfigCentro,
  Contrato,
  Recuperacion,
  Reserva,
  Tarifa,
} from '../types';
import { CATEGORIA_LABEL } from '../types';
import { esPasada, estaEntre, mismaSemana, sumarDias } from '../fechas';

export function plazasOcupadas(claseId: string, reservas: Pick<Reserva, 'claseId' | 'estado'>[]): number {
  return reservas.filter((r) => r.claseId === claseId && r.estado === 'RESERVADA').length;
}

/**
 * Plazas ocupadas de una clase: las reservas activas cargadas o, si es mayor, la cifra del
 * servidor (`clase.ocupadas`): un alumno no recibe las reservas de los demás.
 */
export function ocupacionDe(clase: Pick<Clase, 'id' | 'ocupadas'>, reservas: Pick<Reserva, 'claseId' | 'estado'>[]): number {
  return Math.max(clase.ocupadas ?? 0, plazasOcupadas(clase.id, reservas));
}

/**
 * Plazas libres de una clase. `paraAlumnos`: descuenta también las plazas retenidas por el equipo
 * (cambios sin publicar, 0039), que un alumno no puede ocupar; el personal sí.
 */
export function plazasLibres(clase: Pick<Clase, 'id' | 'plazas' | 'ocupadas' | 'plazasRetenidas'>, reservas: Pick<Reserva, 'claseId' | 'estado'>[], paraAlumnos = false): number {
  return Math.max(0, clase.plazas - ocupacionDe(clase, reservas) - (paraAlumnos ? clase.plazasRetenidas ?? 0 : 0));
}

/** Una reserva "consume" cupo si está activa o se canceló sin derecho a recuperación. */
export function consumeCupo(r: Pick<Reserva, 'estado' | 'origen'>): boolean {
  if (r.origen === 'RECUPERACION') return false; // las recuperaciones no cuentan contra el cupo semanal
  return r.estado === 'RESERVADA' || r.estado === 'CANCELADA_NO_RECUPERABLE';
}

/**
 * Reservas del contrato que consumen cupo en la misma semana que la clase (categoría null = todas, 0034).
 * Con `estricto` (horario fijo), una cancelación que dio recuperación también cuenta: el derecho está en la recuperación.
 */
export function cupoConsumidoEnSemana(
  contrato: Pick<Contrato, 'id'>,
  categoria: Categoria | null,
  fecha: string,
  reservas: Reserva[],
  clasesPorId: Map<string, Clase>,
  actividadesPorId: Map<string, Actividad>,
  estricto: { recuperaciones: Pick<Recuperacion, 'reservaOrigenId'>[] } | null = null,
): number {
  const conRecuperacion = new Set((estricto?.recuperaciones ?? []).map((x) => x.reservaOrigenId).filter((x): x is string => x != null));
  return reservas.filter((r) => {
    if (r.contratoId !== contrato.id) return false;
    if (!consumeCupo(r) && !(r.origen !== 'RECUPERACION' && conRecuperacion.has(r.id))) return false;
    const c = clasesPorId.get(r.claseId);
    if (!c || !mismaSemana(c.fecha, fecha)) return false;
    return categoria == null || actividadesPorId.get(c.actividadId)?.categoria === categoria;
  }).length;
}

export type ViaReserva =
  | { via: 'CUPO_SEMANAL' }
  | { via: 'BONO' }
  | { via: 'RECUPERACION'; recuperacionId: string };

export type EvaluacionReserva =
  | ({ ok: true; mensaje: string } & ViaReserva)
  | { ok: false; motivo: string; codigo: CodigoBloqueo };

export type CodigoBloqueo =
  | 'SIN_CONTRATO'
  | 'CLASE_CANCELADA'
  | 'CLASE_PASADA'
  | 'SIN_PLAZAS'
  | 'YA_RESERVADA'
  | 'FUERA_PERIODO'
  | 'FUERA_VENTANA'
  | 'ACTIVIDAD_NO_PERMITIDA'
  | 'CUPO_AGOTADO'
  | 'BONO_AGOTADO'
  | 'HORARIO_FIJO'
  | 'SIN_PUBLICAR';

export interface ContextoReserva {
  ahora: Date;
  config: Pick<ConfigCentro, 'diasVentanaReserva'>;
  contrato: Contrato | null;
  tarifa: Tarifa | null;
  clase: Clase;
  actividad: Actividad;
  /** Todas las reservas del cliente. */
  reservasCliente: Reserva[];
  /** Todas las reservas de la clase (para plazas). */
  reservasClase: Pick<Reserva, 'claseId' | 'estado'>[];
  recuperaciones: Recuperacion[];
  clasesPorId: Map<string, Clase>;
  actividadesPorId: Map<string, Actividad>;
  /** true cuando reserva el personal: puede usar las plazas retenidas por el equipo (0039). */
  paraElCentro?: boolean;
}

/**
 * Regla central (18): decide si un cliente puede reservar una clase y por qué vía.
 * Orden: estado de la clase → plazas → duplicados → recuperación válida → derechos de tarifa.
 * Las recuperaciones se evalúan antes que el cupo para que el cliente pueda usarlas
 * aunque su semana esté completa, pero solo si la tarifa no cubre ya la clase.
 */
export function evaluarReserva(ctx: ContextoReserva): EvaluacionReserva {
  const { clase, actividad, contrato, tarifa, ahora } = ctx;

  if (clase.estado === 'CANCELADA') return bloqueo('CLASE_CANCELADA', 'Esta clase ha sido cancelada por el centro.');
  // 0039: lo que no está publicado solo lo puede reservar el personal.
  if (clase.publicada === false && !ctx.paraElCentro) return bloqueo('SIN_PUBLICAR', 'Esta clase todavía no está publicada.');
  if (esPasada(clase.fecha, clase.horaInicio, ahora)) return bloqueo('CLASE_PASADA', 'Esta clase ya ha pasado.');
  if (ctx.reservasCliente.some((r) => r.claseId === clase.id && r.estado === 'RESERVADA')) {
    return bloqueo('YA_RESERVADA', 'Ya tienes plaza en esta clase.');
  }
  if (plazasLibres(clase, ctx.reservasClase, !ctx.paraElCentro) <= 0) return bloqueo('SIN_PLAZAS', 'No quedan plazas libres.');

  const limiteVentana = sumarDias(hoy(ahora), ctx.config.diasVentanaReserva);
  if (clase.fecha > limiteVentana) {
    return bloqueo('FUERA_VENTANA', `Solo se puede reservar con ${ctx.config.diasVentanaReserva} días de antelación.`);
  }

  // 1) Recuperación disponible que cubra esta categoría.
  const recuperacion = ctx.recuperaciones.find(
    (rec) =>
      rec.estado === 'DISPONIBLE' &&
      rec.caducaEl >= clase.fecha &&
      rec.categoriasPermitidas.includes(actividad.categoria),
  );

  if (!contrato || !tarifa || contrato.estado !== 'ACTIVO') {
    if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
    return bloqueo('SIN_CONTRATO', 'No tienes una tarifa activa. Consulta en recepción.');
  }

  if (!estaEntre(clase.fecha, contrato.fechaInicio, contrato.fechaFin)) {
    if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
    return bloqueo('FUERA_PERIODO', 'La clase está fuera del periodo de tu tarifa.');
  }

  if (contrato.actividadesPermitidasIds.length > 0 && !contrato.actividadesPermitidasIds.includes(actividad.id)) {
    if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
    return bloqueo('ACTIVIDAD_NO_PERMITIDA', `Tu tarifa no incluye ${actividad.nombre}.`);
  }

  // 0034: la categoría de la clase no es de la tarifa, pero vale a cambio de una de las suyas.
  const tambien = tarifa.clasesTambienEn.includes(actividad.categoria);

  if (tarifa.tipo === 'BONO' && tarifa.bono) {
    if (tarifa.bono.categoria !== actividad.categoria && !tambien) {
      if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
      return bloqueo('ACTIVIDAD_NO_PERMITIDA', `Tu bono es de ${CATEGORIA_LABEL[tarifa.bono.categoria]}.`);
    }
    if ((contrato.sesionesRestantes ?? 0) > 0) {
      return { ok: true, via: 'BONO', mensaje: `Se descontará 1 sesión de tu bono (te quedarán ${(contrato.sesionesRestantes ?? 1) - 1}).` };
    }
    if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
    return bloqueo('BONO_AGOTADO', 'Tu bono no tiene sesiones disponibles.');
  }

  if (tarifa.tipo === 'RECURRENTE') {
    const cupo = tarifa.cupos.find((c) => c.categoria === actividad.categoria);
    // Con cupo propio se cuenta por categoría; "a cambio", contra el total semanal de la tarifa.
    let limite: number;
    let categoriaCupo: Categoria | null;
    if (cupo) { limite = cupo.sesionesSemana; categoriaCupo = actividad.categoria; }
    else if (tambien) { limite = tarifa.cupos.reduce((s, c) => s + c.sesionesSemana, 0); categoriaCupo = null; }
    else {
      if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
      return bloqueo('ACTIVIDAD_NO_PERMITIDA', `Tu tarifa no incluye ${CATEGORIA_LABEL[actividad.categoria].toLowerCase()}.`);
    }
    const fijo = contrato.modalidad === 'FIJO';
    if (fijo && clase.plantillaId != null && contrato.franjasFijas.some((f) => f.plantillaId === clase.plantillaId)) {
      return { ok: true, via: 'CUPO_SEMANAL', mensaje: 'Es tu clase habitual.' };
    }
    // 0034: con horario fijo, fuera de su franja solo si esa semana no tiene su clase ni recuperación por ella.
    const usadas = cupoConsumidoEnSemana(contrato, categoriaCupo, clase.fecha, ctx.reservasCliente, ctx.clasesPorId, ctx.actividadesPorId, fijo ? { recuperaciones: ctx.recuperaciones } : null);
    if (usadas < limite) {
      return { ok: true, via: 'CUPO_SEMANAL', mensaje: fijo ? 'A cambio de tu clase habitual de esta semana.' : tambien ? `Clase ${usadas + 1} de ${limite} de esta semana (a cambio de una de las tuyas).` : `Clase ${usadas + 1} de ${limite} de esta semana.` };
    }
    if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Semana completa: se utilizará una recuperación.' };
    if (fijo) return bloqueo('HORARIO_FIJO', 'Tienes horario fijo y esta semana ya tienes tu clase. Para asistir a otra necesitas una recuperación disponible.');
    return bloqueo('CUPO_AGOTADO', `Ya tienes las ${limite} clases de esta semana.`);
  }

  // CLASE_SUELTA: solo la introduce el personal.
  if (recuperacion) return { ok: true, via: 'RECUPERACION', recuperacionId: recuperacion.id, mensaje: 'Se utilizará una recuperación.' };
  return bloqueo('SIN_CONTRATO', 'Las clases sueltas se reservan en recepción.');
}

function bloqueo(codigo: CodigoBloqueo, motivo: string): EvaluacionReserva {
  return { ok: false, codigo, motivo };
}

function hoy(ahora: Date): string {
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
