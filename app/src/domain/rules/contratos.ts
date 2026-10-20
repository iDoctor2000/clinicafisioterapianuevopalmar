import type { Clase, ConfigCentro, Contrato, ISODate, PlantillaClase, Reserva, Tarifa } from '../types';
import { fechasDePlantilla } from './clases';

/**
 * Sesiones previstas de un contrato de horario fijo dentro de su periodo,
 * descontando días de cierre. Sirve para informar al cliente y al centro.
 */
export function sesionesPrevistas(
  contrato: Pick<Contrato, 'fechaInicio' | 'fechaFin' | 'franjasFijas'>,
  plantillas: PlantillaClase[],
  config: Pick<ConfigCentro, 'diasCierre'>,
): { total: number; porFranja: { plantillaId: string; fechas: ISODate[] }[] } {
  const porFranja = contrato.franjasFijas.map((f) => {
    const p = plantillas.find((x) => x.id === f.plantillaId);
    return { plantillaId: f.plantillaId, fechas: p ? fechasDePlantilla(p, contrato.fechaInicio, contrato.fechaFin, config) : [] };
  });
  return { total: porFranja.reduce((n, f) => n + f.fechas.length, 0), porFranja };
}

/**
 * Regla 5: con horario fijo, el sistema genera automáticamente las reservas del cliente
 * durante la vigencia de su tarifa. Devuelve las reservas que faltan por crear
 * (solo para clases ya generadas, programadas y con plaza).
 */
/**
 * Apunta al alumno de horario fijo a las clases de sus franjas que le falten (espejo de
 * _generar_reservas_automaticas). Bloquean: tener ya plaza, o haberla cancelado el propio alumno.
 * Una reserva cancelada por el centro en una clase que sigue programada (p. ej. al finalizar el
 * contrato anterior) no bloquea: se vuelve a activar con este contrato (0022).
 * Devuelve la lista completa de reservas resultante y cuántas se han apuntado.
 */
export function generarReservasAutomaticas(
  contrato: Contrato,
  clases: Clase[],
  reservasExistentes: Reserva[],
  crearId: () => string,
  ahoraISO: string,
): { reservas: Reserva[]; creadas: number } {
  if (contrato.modalidad !== 'FIJO' || contrato.estado !== 'ACTIVO') return { reservas: reservasExistentes, creadas: 0 };
  const franjas = new Set(contrato.franjasFijas.map((f) => f.plantillaId));
  const bloqueadas = new Set(
    reservasExistentes.filter((r) => r.clienteId === contrato.clienteId && r.estado !== 'CANCELADA_CENTRO').map((r) => r.claseId),
  );
  const ocupacion = new Map<string, number>();
  for (const r of reservasExistentes) {
    if (r.estado === 'RESERVADA') ocupacion.set(r.claseId, (ocupacion.get(r.claseId) ?? 0) + 1);
  }
  let reservas = reservasExistentes;
  const nuevas: Reserva[] = [];
  let revividas = 0;
  for (const c of clases) {
    if (c.estado !== 'PROGRAMADA' || !c.plantillaId || !franjas.has(c.plantillaId)) continue;
    if (c.fecha < contrato.fechaInicio || c.fecha > contrato.fechaFin) continue;
    if (bloqueadas.has(c.id)) continue;
    if ((ocupacion.get(c.id) ?? 0) >= c.plazas) continue; // sin plaza: el centro lo verá en el calendario
    const revivir = reservas.filter((r) => r.claseId === c.id && r.clienteId === contrato.clienteId && r.estado === 'CANCELADA_CENTRO').sort((a, b) => (b.canceladaEl ?? '').localeCompare(a.canceladaEl ?? ''))[0];
    if (revivir) {
      reservas = reservas.map((r) => (r.id === revivir.id ? { ...r, estado: 'RESERVADA', contratoId: contrato.id, origen: 'AUTOMATICA', recuperacionUsadaId: null, canceladaEl: null, canceladaPor: null, asistencia: 'PENDIENTE' } : r));
      ocupacion.set(c.id, (ocupacion.get(c.id) ?? 0) + 1);
      revividas += 1;
      continue;
    }
    nuevas.push({
      id: crearId(),
      claseId: c.id,
      clienteId: contrato.clienteId,
      contratoId: contrato.id,
      origen: 'AUTOMATICA',
      estado: 'RESERVADA',
      asistencia: 'PENDIENTE',
      recuperacionUsadaId: null,
      creadaEl: ahoraISO,
      creadaPor: 'sistema',
      canceladaEl: null,
      canceladaPor: null,
    });
    ocupacion.set(c.id, (ocupacion.get(c.id) ?? 0) + 1);
  }
  return { reservas: nuevas.length ? reservas.concat(nuevas) : reservas, creadas: nuevas.length + revividas };
}

/** Fecha de fin por defecto de un contrato según su tarifa (bono: validez; recurrente: 3 meses). */
export function fechaFinPorDefecto(tarifa: Tarifa, fechaInicio: ISODate, sumarMeses: (f: ISODate, m: number) => ISODate): ISODate {
  if (tarifa.tipo === 'BONO' && tarifa.bono) return sumarMeses(fechaInicio, tarifa.bono.validezMeses);
  if (tarifa.tipo === 'CLASE_SUELTA') return fechaInicio;
  return sumarMeses(fechaInicio, 3);
}
