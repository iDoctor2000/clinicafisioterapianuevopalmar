import type { Actividad, Clase, ConfigCentro, Contrato, PlantillaClase, Recuperacion, Reserva, Tarifa } from '../types';

export const config: ConfigCentro = {
  nombre: 'Test',
  minutosAntelacionCancelacion: 60,
  diasVentanaReserva: 14,
  recuperacionCaducaConContrato: true,
  diasCaducidadRecuperacion: 30,
  diasCierre: [{ fecha: '2026-10-12', motivo: 'Fiesta Nacional' }],
  zonaHoraria: 'Europe/Madrid',
};

export const actDirigida: Actividad = { id: 'a-dir', nombre: 'Pilates suelo', categoria: 'DIRIGIDA', descripcion: '', color: '#86735F', activa: true };
export const actReformer: Actividad = { id: 'a-ref', nombre: 'Reformer', categoria: 'REFORMER', descripcion: '', color: '#3B82C4', activa: true };
export const actividadesPorId = new Map([[actDirigida.id, actDirigida], [actReformer.id, actReformer]]);

export const tarifaDir2: Tarifa = {
  id: 't-dir2', nombre: 'Dirigidas 2 días', descripcion: '', tipo: 'RECURRENTE',
  cupos: [{ categoria: 'DIRIGIDA', sesionesSemana: 2 }], bono: null,
  recuperacion: { permitida: true, categoriasExtra: [], maxPendientes: null }, precioCentimos: null, activa: true, orden: 1,
};
export const tarifaMixta: Tarifa = {
  ...tarifaDir2, id: 't-mixta', nombre: 'Mixta',
  cupos: [{ categoria: 'DIRIGIDA', sesionesSemana: 1 }, { categoria: 'REFORMER', sesionesSemana: 1 }],
};
export const tarifaBonoDir: Tarifa = {
  ...tarifaDir2, id: 't-bono', nombre: 'Bono 10 dirigidas', tipo: 'BONO', cupos: [],
  bono: { sesiones: 10, categoria: 'DIRIGIDA', validezMeses: 6 },
};

export function contrato(over: Partial<Contrato> = {}): Contrato {
  return {
    id: 'c1', clienteId: 'cli1', tarifaId: 't-dir2', fechaInicio: '2026-10-01', fechaFin: '2026-12-31',
    modalidad: 'LIBRE', franjasFijas: [], sesionesRestantes: null, estado: 'ACTIVO', actividadesPermitidasIds: [],
    notas: '', creadoEl: '2026-09-26T00:00:00.000Z', creadoPor: 'w1', ...over,
  };
}

export function clase(over: Partial<Clase> = {}): Clase {
  return {
    id: 'k1', plantillaId: 'p-mar-18', actividadId: 'a-dir', fecha: '2026-10-06', horaInicio: '18:00', duracionMin: 55,
    monitorId: 'w1', plazas: 8, estado: 'PROGRAMADA', extraordinaria: false, claseAlternativaId: null,
    motivoCancelacion: null, canceladaEl: null, canceladaPor: null, ...over,
  };
}

export function reserva(over: Partial<Reserva> = {}): Reserva {
  return {
    id: 'r1', claseId: 'k1', clienteId: 'cli1', contratoId: 'c1', origen: 'CLIENTE', estado: 'RESERVADA',
    asistencia: 'PENDIENTE', recuperacionUsadaId: null, creadaEl: '2026-09-26T00:00:00.000Z', creadaPor: 'cli1',
    canceladaEl: null, canceladaPor: null, ...over,
  };
}

export function recuperacion(over: Partial<Recuperacion> = {}): Recuperacion {
  return {
    id: 'rec1', clienteId: 'cli1', contratoId: 'c1', reservaOrigenId: 'r0', categoriaOrigen: 'DIRIGIDA',
    categoriasPermitidas: ['DIRIGIDA'], motivo: 'CANCELACION_CLIENTE', estado: 'DISPONIBLE', caducaEl: '2026-12-31',
    usadaEnReservaId: null, creadaEl: '2026-09-26T00:00:00.000Z', creadaPor: 'cli1', nota: '', ...over,
  };
}

export function plantilla(over: Partial<PlantillaClase> = {}): PlantillaClase {
  return {
    id: 'p-mar-18', actividadId: 'a-dir', diaSemana: 2, horaInicio: '18:00', duracionMin: 55, monitorId: 'w1', plazas: 8,
    activa: true, vigenciaDesde: null, vigenciaHasta: null, ...over,
  };
}
