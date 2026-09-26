import type { Clase, ConfigCentro, ISODate, PlantillaClase } from '../types';
import { diasEntre, diaSemanaDe, esDiaCierre, estaEntre } from '../fechas';

/**
 * Genera las instancias de clase de un rango de fechas a partir del horario semanal,
 * saltando los días de cierre y respetando la vigencia de cada plantilla.
 * Devuelve solo las que no existen todavía (clave plantillaId+fecha).
 */
export function generarClases(
  plantillas: PlantillaClase[],
  desde: ISODate,
  hasta: ISODate,
  config: Pick<ConfigCentro, 'diasCierre'>,
  existentes: Pick<Clase, 'plantillaId' | 'fecha'>[],
  crearId: () => string,
): Clase[] {
  const yaExiste = new Set(existentes.map((c) => `${c.plantillaId}|${c.fecha}`));
  const nuevas: Clase[] = [];
  for (const fecha of diasEntre(desde, hasta)) {
    if (esDiaCierre(fecha, config)) continue;
    const dia = diaSemanaDe(fecha);
    for (const p of plantillas) {
      if (!p.activa || p.diaSemana !== dia) continue;
      if (p.vigenciaDesde && fecha < p.vigenciaDesde) continue;
      if (p.vigenciaHasta && fecha > p.vigenciaHasta) continue;
      if (yaExiste.has(`${p.id}|${fecha}`)) continue;
      nuevas.push({
        id: crearId(),
        plantillaId: p.id,
        actividadId: p.actividadId,
        fecha,
        horaInicio: p.horaInicio,
        duracionMin: p.duracionMin,
        monitorId: p.monitorId,
        plazas: p.plazas,
        estado: 'PROGRAMADA',
        extraordinaria: false,
        claseAlternativaId: null,
        motivoCancelacion: null,
        canceladaEl: null,
        canceladaPor: null,
      });
    }
  }
  return nuevas;
}

/** Fechas concretas en las que una plantilla tiene clase dentro de un periodo (sin cierres). */
export function fechasDePlantilla(
  plantilla: Pick<PlantillaClase, 'diaSemana' | 'vigenciaDesde' | 'vigenciaHasta'>,
  desde: ISODate,
  hasta: ISODate,
  config: Pick<ConfigCentro, 'diasCierre'>,
): ISODate[] {
  return diasEntre(desde, hasta).filter(
    (f) =>
      diaSemanaDe(f) === plantilla.diaSemana &&
      !esDiaCierre(f, config) &&
      (!plantilla.vigenciaDesde || f >= plantilla.vigenciaDesde) &&
      (!plantilla.vigenciaHasta || f <= plantilla.vigenciaHasta) &&
      estaEntre(f, desde, hasta),
  );
}
