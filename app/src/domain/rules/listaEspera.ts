/**
 * Lista de espera (0021): quién puede apuntarse a una clase completa y cuándo entra.
 * Las reglas de verdad viven en SQL (_promover_lista_espera); esto es el espejo para la demo y la UI.
 */
import type { Actividad, Clase, ConfigCentro, Contrato, Reserva, Tarifa } from '../types';
import { minutosHasta, mismaSemana } from '../fechas';

/** Horas antes de la clase a partir de las cuales la lista de espera deja de actuar. */
export const HORAS_CIERRE_LISTA_ESPERA = 2;

/** true si ya es demasiado tarde para que la lista de espera actúe en esta clase. */
export function listaEsperaCerrada(clase: Pick<Clase, 'fecha' | 'horaInicio'>, ahora: Date): boolean {
  return minutosHasta(clase.fecha, clase.horaInicio, ahora) < HORAS_CIERRE_LISTA_ESPERA * 60;
}

export interface ContextoCambio {
  reserva: Pick<Reserva, 'estado' | 'claseId' | 'contratoId'> | null;
  claseOrigen: Pick<Clase, 'id' | 'fecha' | 'horaInicio' | 'estado' | 'actividadId'> | null;
  claseDestino: Pick<Clase, 'id' | 'fecha' | 'actividadId'>;
  actividadOrigen: Pick<Actividad, 'nombre' | 'categoria'> | null;
  actividadDestino: Pick<Actividad, 'id' | 'nombre' | 'categoria'>;
  contrato: Pick<Contrato, 'actividadesPermitidasIds'> | null;
  tarifa?: Pick<Tarifa, 'clasesTambienEn' | 'cupos' | 'bono'> | null;
  config: Pick<ConfigCentro, 'minutosAntelacionCancelacion'>;
  ahora: Date;
}

/** ¿Puede usarse esa reserva como "cambio" para entrar en la clase? Devuelve null si sí, o el motivo. */
export function motivoNoCambio(c: ContextoCambio): string | null {
  const { reserva, claseOrigen, claseDestino, actividadOrigen, actividadDestino } = c;
  if (!reserva || !claseOrigen) return 'La reserva que quieres cambiar no existe.';
  if (reserva.estado !== 'RESERVADA') return 'La reserva que quieres cambiar ya está cancelada.';
  if (claseOrigen.id === claseDestino.id) return 'Es la misma clase.';
  if (claseOrigen.estado !== 'PROGRAMADA') return 'La clase que quieres cambiar está cancelada.';
  if (minutosHasta(claseOrigen.fecha, claseOrigen.horaInicio, c.ahora) < c.config.minutosAntelacionCancelacion) {
    return `Tu clase del ${claseOrigen.fecha.slice(8, 10)}/${claseOrigen.fecha.slice(5, 7)} a las ${claseOrigen.horaInicio} ya no se puede cambiar (hay que hacerlo con ${Math.floor(c.config.minutosAntelacionCancelacion / 60)} horas de antelación).`;
  }
  if (!mismaSemana(claseOrigen.fecha, claseDestino.fecha)) {
    return 'Solo se puede cambiar por una clase de la misma semana. Para otra semana, cancela tu clase y apúntate a la lista normalmente.';
  }
  // 0034: el cambio de categoría vale si la de destino es de la tarifa (volver a su Reformer) o una en la que sus clases también valen.
  const deLaTarifa = (c.tarifa?.cupos ?? []).some((q) => q.categoria === actividadDestino.categoria) || c.tarifa?.bono?.categoria === actividadDestino.categoria;
  if (actividadOrigen && actividadOrigen.categoria !== actividadDestino.categoria && !deLaTarifa && !(c.tarifa?.clasesTambienEn ?? []).includes(actividadDestino.categoria)) {
    return `No se puede cambiar una clase de ${actividadOrigen.nombre.toLowerCase()} por una de ${actividadDestino.nombre.toLowerCase()}.`;
  }
  if (c.contrato && c.contrato.actividadesPermitidasIds.length > 0 && !c.contrato.actividadesPermitidasIds.includes(actividadDestino.id)) {
    return `Tu tarifa no incluye ${actividadDestino.nombre}.`;
  }
  return null;
}
