import type { Categoria, ConfigCentro, Contrato, ISODate, Recuperacion, Tarifa } from '../types';
import { sumarDias } from '../fechas';

/** Fecha de caducidad de una recuperación según la configuración del centro. */
export function caducidadRecuperacion(
  contrato: Pick<Contrato, 'fechaFin'> | null,
  fechaOrigen: ISODate,
  config: Pick<ConfigCentro, 'recuperacionCaducaConContrato' | 'diasCaducidadRecuperacion'>,
): ISODate {
  if (config.recuperacionCaducaConContrato && contrato) return contrato.fechaFin;
  return sumarDias(fechaOrigen, config.diasCaducidadRecuperacion);
}

/** Categorías donde puede usarse una recuperación originada en `categoriaOrigen` según la tarifa. */
export function categoriasPermitidasRecuperacion(categoriaOrigen: Categoria, tarifa: Pick<Tarifa, 'recuperacion'> | null): Categoria[] {
  const extra = tarifa?.recuperacion.categoriasExtra ?? [];
  return Array.from(new Set<Categoria>([categoriaOrigen, ...extra]));
}

/** ¿Puede generarse una nueva recuperación con esta tarifa? (límite de pendientes). */
export function puedeGenerarRecuperacion(tarifa: Pick<Tarifa, 'recuperacion'> | null, pendientes: number): boolean {
  if (!tarifa) return true; // cancelación del centro sin tarifa: siempre compensa
  if (!tarifa.recuperacion.permitida) return false;
  if (tarifa.recuperacion.maxPendientes == null) return true;
  return pendientes < tarifa.recuperacion.maxPendientes;
}

export function recuperacionesDisponibles(recs: Recuperacion[], hoy: ISODate): Recuperacion[] {
  return recs.filter((r) => r.estado === 'DISPONIBLE' && r.caducaEl >= hoy);
}

/** Marca como caducadas las recuperaciones vencidas (tarea diaria). */
export function caducarVencidas(recs: Recuperacion[], hoy: ISODate): Recuperacion[] {
  return recs.map((r) => (r.estado === 'DISPONIBLE' && r.caducaEl < hoy ? { ...r, estado: 'CADUCADA' } : r));
}
