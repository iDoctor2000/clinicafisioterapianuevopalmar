import type { Clase, ConfigCentro, EstadoReserva } from '../types';
import { minutosHasta } from '../fechas';

export type ResultadoCancelacion = {
  estado: Extract<EstadoReserva, 'CANCELADA_RECUPERABLE' | 'CANCELADA_NO_RECUPERABLE'>;
  recuperable: boolean;
  minutosAntelacion: number;
};

/**
 * Regla 6: una cancelación del cliente con antelación >= límite es recuperable;
 * con menos antelación es no recuperable. El límite lo fija el administrador.
 */
export function clasificarCancelacion(
  clase: Pick<Clase, 'fecha' | 'horaInicio'>,
  ahora: Date,
  config: Pick<ConfigCentro, 'minutosAntelacionCancelacion'>,
): ResultadoCancelacion {
  const minutos = minutosHasta(clase.fecha, clase.horaInicio, ahora);
  const recuperable = minutos >= config.minutosAntelacionCancelacion;
  return {
    estado: recuperable ? 'CANCELADA_RECUPERABLE' : 'CANCELADA_NO_RECUPERABLE',
    recuperable,
    minutosAntelacion: minutos,
  };
}

/** Un cliente solo puede cancelar reservas activas de clases que aún no han empezado. */
export function puedeCancelarCliente(
  clase: Pick<Clase, 'fecha' | 'horaInicio' | 'estado'>,
  estadoReserva: EstadoReserva,
  ahora: Date,
): { ok: true } | { ok: false; motivo: string } {
  if (estadoReserva !== 'RESERVADA') return { ok: false, motivo: 'La reserva ya está cancelada.' };
  if (clase.estado === 'CANCELADA') return { ok: false, motivo: 'La clase ha sido cancelada por el centro.' };
  if (minutosHasta(clase.fecha, clase.horaInicio, ahora) < 0) {
    return { ok: false, motivo: 'La clase ya ha comenzado.' };
  }
  return { ok: true };
}
