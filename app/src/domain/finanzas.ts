/**
 * Qué ve del dinero quien no tiene acceso a las finanzas: nada. El servidor ya no le devuelve
 * cobros ni importes (0024); en la demo, y por si acaso, la instantánea se limpia también aquí,
 * así las pantallas no tienen que preguntarse nada: sin cobros no hay "Pago pendiente", y sin
 * importe no hay nada que enseñar.
 */
import type { Contrato, Pago } from './types';

export function ocultarFinanzas<T extends { contratos: Contrato[]; pagos: Pago[] }>(db: T): T {
  return {
    ...db,
    pagos: [] as Pago[],
    contratos: db.contratos.map((c) => (c.oferta === 'NINGUNA' && c.importeCentimos == null && c.metodoPago == null ? c : { ...c, oferta: 'NINGUNA' as const, importeCentimos: null, metodoPago: null })),
  };
}
