/** Colores y textos de estado, compartidos por todas las pantallas del cliente. */
import type { Clase, EstadoRecuperacion, EstadoReserva, Reserva } from '@/domain/types';
import type { Tono } from '@/ui';
import { esPasada } from '@/domain/fechas';

export interface ChipInfo {
  texto: string;
  tono: Tono;
}

/** Estado de reserva → texto, tono del chip y clase del punto de color (calendario). */
export const ESTADO_RESERVA: Record<EstadoReserva, ChipInfo & { punto: string }> = {
  RESERVADA: { texto: 'Reservada', tono: 'beige', punto: 'bg-brand-500' },
  CANCELADA_RECUPERABLE: { texto: 'Cancelada · recuperable', tono: 'ambar', punto: 'bg-clay' },
  CANCELADA_NO_RECUPERABLE: { texto: 'Cancelada · no recuperable', tono: 'rojo', punto: 'bg-rose' },
  CANCELADA_CENTRO: { texto: 'Cancelada por el centro', tono: 'azul', punto: 'bg-sky' },
};

export const ESTADO_RECUPERACION: Record<EstadoRecuperacion, ChipInfo> = {
  DISPONIBLE: { texto: 'Disponible', tono: 'beige' },
  USADA: { texto: 'Usada', tono: 'gris' },
  CADUCADA: { texto: 'Caducada', tono: 'rojo' },
};

/** Chip principal de una reserva; para clases pasadas muestra la asistencia. */
export function chipEstado(reserva: Reserva, clase: Pick<Clase, 'fecha' | 'horaInicio'>, ahora: Date): ChipInfo {
  if (reserva.estado === 'RESERVADA' && esPasada(clase.fecha, clase.horaInicio, ahora)) {
    if (reserva.asistencia === 'ASISTE') return { texto: 'Asististe', tono: 'beige' };
    if (reserva.asistencia === 'NO_ASISTE') return { texto: 'No asististe', tono: 'gris' };
  }
  return ESTADO_RESERVA[reserva.estado];
}

/** Chip secundario según el origen de la reserva (solo recuperación y bono). */
export function chipOrigen(reserva: Pick<Reserva, 'origen'>): ChipInfo | null {
  if (reserva.origen === 'RECUPERACION') return { texto: 'Recuperación', tono: 'azul' };
  if (reserva.origen === 'BONO') return { texto: 'Bono', tono: 'cocoa' };
  return null;
}

/** Clase Tailwind del punto de color de un día del calendario. */
export function puntoEstado(reserva: Reserva, clase: Pick<Clase, 'fecha' | 'horaInicio'>, ahora: Date): string {
  if (reserva.estado === 'RESERVADA' && reserva.asistencia === 'NO_ASISTE' && esPasada(clase.fecha, clase.horaInicio, ahora)) return 'bg-ink/30';
  return ESTADO_RESERVA[reserva.estado].punto;
}
