import { addMonths, startOfMonth, subMonths } from 'date-fns';
import type { Actividad, Cliente, Contrato, PlantillaClase, Reserva, Tarifa, Trabajador } from '@/domain/types';
import { aISODate, sumarDias } from '@/domain/fechas';
import { generarClases, generarReservasAutomaticas, clasificarCancelacion, caducidadRecuperacion, categoriasPermitidasRecuperacion } from '@/domain/rules';
import { DB_VERSION, type Db, type Usuario } from './db';

/**
 * Datos de demostración. Las fechas son relativas a hoy para que la demo
 * siempre tenga clases pasadas y futuras.
 */
/** Retrato esquemático (SVG) como data URL: fondo de color y silueta. Ligero y sin depender de ficheros. */
function fotoDemo(fondo: string, piel: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fondo}"/><circle cx="32" cy="25" r="11" fill="${piel}"/><path d="M12 60c2-14 10-20 20-20s18 6 20 20z" fill="${piel}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const FOTOS_DEMO: Record<string, string> = { maria: fotoDemo('#cfe3c2', '#8d6e63'), juan: fotoDemo('#c7d7ea', '#a1887f') };

export function crearSeed(ahora: Date = new Date()): Db {
  let n = 0;
  const id = (p: string) => `${p}-${(++n).toString().padStart(3, '0')}`;
  const ahoraISO = ahora.toISOString();
  const hoy = aISODate(ahora);
  const inicioPeriodo = aISODate(startOfMonth(subMonths(ahora, 1)));
  const finPeriodo = sumarDias(aISODate(startOfMonth(addMonths(ahora, 2))), -1); // 3 meses naturales
  const finClases = aISODate(addMonths(ahora, 2));

  const actividades: Actividad[] = [
    { id: 'act-suelo', nombre: 'Pilates suelo', categoria: 'DIRIGIDA', descripcion: 'Trabajo de control postural, core y movilidad en colchoneta. Grupo reducido dirigido por fisioterapeuta.', color: '#548C2F', activa: true },
    { id: 'act-espalda', nombre: 'Espalda sana', categoria: 'DIRIGIDA', descripcion: 'Sesión terapéutica centrada en columna: movilidad, estabilidad y prevención del dolor.', color: '#7FB356', activa: true },
    { id: 'act-hipo', nombre: 'Hipopresivos', categoria: 'DIRIGIDA', descripcion: 'Técnicas hipopresivas para suelo pélvico, postura y respiración.', color: '#A3CB80', activa: true },
    { id: 'act-reformer', nombre: 'Reformer', categoria: 'REFORMER', descripcion: 'Pilates en máquina Reformer. Máximo 4 personas por sesión, supervisión individualizada.', color: '#3B82C4', activa: true },
  ];

  const recupBasica = { permitida: true, categoriasExtra: [] as never[], maxPendientes: null };
  const tarifas: Tarifa[] = [
    { id: 'tar-dir2', nombre: 'Dirigidas · 2 días/semana', descripcion: 'Dos sesiones semanales de actividades dirigidas (suelo, espalda sana, hipopresivos).', tipo: 'RECURRENTE', cupos: [{ categoria: 'DIRIGIDA', sesionesSemana: 2 }], bono: null, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 1 },
    { id: 'tar-dir3', nombre: 'Dirigidas · 3 días/semana', descripcion: 'Tres sesiones semanales de actividades dirigidas.', tipo: 'RECURRENTE', cupos: [{ categoria: 'DIRIGIDA', sesionesSemana: 3 }], bono: null, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 2 },
    { id: 'tar-ref2', nombre: 'Reformer · 2 días/semana', descripcion: 'Dos sesiones semanales de Reformer.', tipo: 'RECURRENTE', cupos: [{ categoria: 'REFORMER', sesionesSemana: 2 }], bono: null, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 3 },
    { id: 'tar-ref3', nombre: 'Reformer · 3 días/semana', descripcion: 'Tres sesiones semanales de Reformer.', tipo: 'RECURRENTE', cupos: [{ categoria: 'REFORMER', sesionesSemana: 3 }], bono: null, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 4 },
    { id: 'tar-mixta', nombre: 'Mixta · 1 Reformer + 1 dirigida', descripcion: 'Una sesión semanal de Reformer y una de actividades dirigidas.', tipo: 'RECURRENTE', cupos: [{ categoria: 'REFORMER', sesionesSemana: 1 }, { categoria: 'DIRIGIDA', sesionesSemana: 1 }], bono: null, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 5 },
    { id: 'tar-bono-dir', nombre: 'Bono 10 clases dirigidas', descripcion: '10 sesiones de actividades dirigidas. Validez 6 meses.', tipo: 'BONO', cupos: [], bono: { sesiones: 10, categoria: 'DIRIGIDA', validezMeses: 6 }, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 6 },
    { id: 'tar-bono-ref', nombre: 'Bono 10 Reformer', descripcion: '10 sesiones de Reformer. Validez 6 meses.', tipo: 'BONO', cupos: [], bono: { sesiones: 10, categoria: 'REFORMER', validezMeses: 6 }, recuperacion: recupBasica, precioCentimos: null, activa: true, orden: 7 },
    { id: 'tar-cs', nombre: 'Clase suelta (CS)', descripcion: 'Una sesión individual, sin compromiso. Se gestiona en recepción.', tipo: 'CLASE_SUELTA', cupos: [], bono: null, recuperacion: { permitida: false, categoriasExtra: [], maxPendientes: 0 }, precioCentimos: null, activa: true, orden: 8 },
  ];

  const TODOS = ['CLIENTES_EDITAR', 'CLIENTES_VER', 'CLINICA_VER', 'RESERVAS_GESTIONAR', 'HORARIOS_GESTIONAR', 'CLASES_CREAR_CANCELAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'TARIFAS_GESTIONAR', 'ESTADISTICAS_VER', 'TRABAJADORES_GESTIONAR', 'ASISTENCIA_REGISTRAR'] as const;
  const trabajadores: Trabajador[] = [
    { id: 'tra-jose', nombre: 'José Diego', apellidos: 'Frutos', email: 'josediego@fisioterapianuevopalmar.com', telefono: '968 885 931', rol: 'ADMIN', permisos: [...TODOS], ambito: 'CENTRO', esMonitor: true, color: '#548C2F', activo: true, userId: 'usr-jose' },
    { id: 'tra-ana', nombre: 'Ana', apellidos: 'Martínez', email: 'ana@fisioterapianuevopalmar.com', telefono: '', rol: 'MONITOR', permisos: ['CLIENTES_VER', 'CLINICA_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ASISTENCIA_REGISTRAR'], ambito: 'SUS_CLASES', esMonitor: true, color: '#3B82C4', activo: true, userId: 'usr-ana' },
    { id: 'tra-laura', nombre: 'Laura', apellidos: 'Pérez', email: 'recepcion@fisioterapianuevopalmar.com', telefono: '', rol: 'RECEPCION', permisos: ['CLIENTES_EDITAR', 'CLIENTES_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ESTADISTICAS_VER'], ambito: 'CENTRO', esMonitor: false, color: '#C9713F', activo: true, userId: 'usr-laura' },
  ];

  const P = (id: string, actividadId: string, diaSemana: 1 | 2 | 3 | 4 | 5 | 6 | 7, horaInicio: string, monitorId: string, plazas: number): PlantillaClase => ({
    id, actividadId, diaSemana, horaInicio, duracionMin: 55, monitorId, plazas, activa: true, vigenciaDesde: null, vigenciaHasta: null,
  });
  const plantillas: PlantillaClase[] = [
    P('pl-lun-0900', 'act-suelo', 1, '09:00', 'tra-ana', 10), P('pl-mie-0900', 'act-suelo', 3, '09:00', 'tra-ana', 10), P('pl-vie-0900', 'act-suelo', 5, '09:00', 'tra-ana', 10),
    P('pl-lun-1000', 'act-reformer', 1, '10:00', 'tra-jose', 4), P('pl-mie-1000', 'act-reformer', 3, '10:00', 'tra-jose', 4), P('pl-vie-1000', 'act-reformer', 5, '10:00', 'tra-jose', 4),
    P('pl-mar-1100', 'act-espalda', 2, '11:00', 'tra-jose', 8), P('pl-jue-1100', 'act-espalda', 4, '11:00', 'tra-jose', 8),
    P('pl-mar-1700', 'act-reformer', 2, '17:00', 'tra-ana', 4), P('pl-jue-1700', 'act-reformer', 4, '17:00', 'tra-ana', 4),
    P('pl-lun-1800', 'act-suelo', 1, '18:00', 'tra-ana', 10), P('pl-mie-1800', 'act-suelo', 3, '18:00', 'tra-ana', 10),
    P('pl-mar-1800', 'act-suelo', 2, '18:00', 'tra-jose', 10), P('pl-jue-1800', 'act-suelo', 4, '18:00', 'tra-jose', 10),
    P('pl-lun-1900', 'act-reformer', 1, '19:00', 'tra-jose', 4), P('pl-mie-1900', 'act-reformer', 3, '19:00', 'tra-jose', 4), P('pl-vie-1900', 'act-reformer', 5, '19:00', 'tra-jose', 4),
    P('pl-mar-2000', 'act-hipo', 2, '20:00', 'tra-ana', 8), P('pl-jue-2000', 'act-hipo', 4, '20:00', 'tra-ana', 8),
    P('pl-sab-1100', 'act-reformer', 6, '11:00', 'tra-jose', 4),
  ];

  // Dos clientes de la demo con foto (SVG mínimo en data URL) para ver cómo queda; el resto con iniciales.
  const C = (id: string, nombre: string, apellidos: string, dni: string, telefono: string, email: string, clinica: Partial<Cliente['clinica']> = {}): Cliente => ({
    id, nombre, apellidos, dni, direccion: 'El Palmar, Murcia', email, telefono,
    clinica: { lesiones: '', patologias: '', observaciones: '', actualizadaEl: null, ...clinica },
    notificacionesPush: true, activo: true, userId: `usr-${id}`, altaEl: inicioPeriodo, bajaEl: null,
    fotoUrl: FOTOS_DEMO[id] ?? null,
  });
  const clientes: Cliente[] = [
    C('maria', 'María', 'García López', '23456789A', '600 111 222', 'maria@example.com', { lesiones: 'Esguince tobillo derecho (2024), recuperado.', patologias: 'Lumbalgia crónica leve.', observaciones: 'Evitar hiperextensión lumbar. Progresar despacio en flexiones.', actualizadaEl: ahoraISO }),
    C('juan', 'Juan', 'Sánchez Ruiz', '34567890B', '600 222 333', 'juan@example.com', { lesiones: 'Hernia discal L4-L5 (2022).', patologias: '', observaciones: 'Sin cargas axiales. Prefiere clases de tarde.', actualizadaEl: ahoraISO }),
    C('lucia', 'Lucía', 'Fernández Moreno', '45678901C', '600 333 444', 'lucia@example.com', { observaciones: 'Postparto (6 meses). Trabajar suelo pélvico.', actualizadaEl: ahoraISO }),
    C('carmen', 'Carmen', 'Martínez Gil', '56789012D', '600 444 555', 'carmen@example.com', { patologias: 'Osteoporosis leve.', actualizadaEl: ahoraISO }),
    C('antonio', 'Antonio', 'López Navarro', '67890123E', '600 555 666', 'antonio@example.com', { lesiones: 'Prótesis de rodilla izquierda (2023).', actualizadaEl: ahoraISO }),
    C('isabel', 'Isabel', 'Romero Díaz', '78901234F', '600 666 777', 'isabel@example.com'),
    C('pedro', 'Pedro', 'Hernández Ortiz', '89012345G', '600 777 888', 'pedro@example.com', { patologias: 'Cervicalgia.', actualizadaEl: ahoraISO }),
    C('rosa', 'Rosa', 'Jiménez Vidal', '90123456H', '600 888 999', 'rosa@example.com'),
    C('miguel', 'Miguel', 'Torres Alcaraz', '01234567J', '600 999 000', 'miguel@example.com'),
    C('elena', 'Elena', 'Molina Serrano', '12345678K', '611 111 111', 'elena@example.com', { observaciones: 'Embarazo 20 semanas. Adaptar ejercicios.', actualizadaEl: ahoraISO }),
    C('paco', 'Francisco', 'Ros Belmonte', '22222222L', '611 222 222', 'paco@example.com'),
    C('nuria', 'Nuria', 'Cano Pardo', '33333333M', '611 333 333', 'nuria@example.com'),
  ];

  const K = (id: string, clienteId: string, tarifaId: string, modalidad: 'FIJO' | 'LIBRE', franjas: string[] = [], extra: Partial<Contrato> = {}): Contrato => ({
    id, clienteId, tarifaId, fechaInicio: inicioPeriodo, fechaFin: finPeriodo, modalidad,
    franjasFijas: franjas.map((plantillaId) => ({ plantillaId })), sesionesRestantes: null, estado: 'ACTIVO',
    actividadesPermitidasIds: [], notas: '', creadoEl: ahoraISO, creadoPor: 'tra-laura', ...extra,
  });
  const contratos: Contrato[] = [
    K('con-maria', 'maria', 'tar-dir2', 'LIBRE'),
    K('con-juan', 'juan', 'tar-dir2', 'FIJO', ['pl-mar-1800', 'pl-jue-1800']),
    K('con-lucia', 'lucia', 'tar-bono-dir', 'LIBRE', [], { sesionesRestantes: 6, fechaFin: sumarDias(inicioPeriodo, 182) }),
    K('con-carmen', 'carmen', 'tar-ref2', 'FIJO', ['pl-lun-1000', 'pl-mie-1000']),
    K('con-antonio', 'antonio', 'tar-mixta', 'LIBRE'),
    K('con-isabel', 'isabel', 'tar-dir3', 'FIJO', ['pl-lun-0900', 'pl-mie-0900', 'pl-vie-0900']),
    K('con-pedro', 'pedro', 'tar-ref3', 'FIJO', ['pl-lun-1900', 'pl-mie-1900', 'pl-vie-1900']),
    K('con-rosa', 'rosa', 'tar-dir2', 'FIJO', ['pl-mar-1100', 'pl-jue-1100']),
    K('con-miguel', 'miguel', 'tar-bono-ref', 'LIBRE', [], { sesionesRestantes: 9, fechaFin: sumarDias(inicioPeriodo, 182) }),
    K('con-elena', 'elena', 'tar-dir2', 'FIJO', ['pl-mar-2000', 'pl-jue-2000']),
    K('con-paco', 'paco', 'tar-ref2', 'FIJO', ['pl-mar-1700', 'pl-jue-1700']),
    K('con-nuria', 'nuria', 'tar-dir2', 'FIJO', ['pl-lun-1800', 'pl-mie-1800']),
  ];

  const usuarios: Usuario[] = [
    ...trabajadores.map((t): Usuario => ({ id: t.userId!, email: t.email, tipo: 'TRABAJADOR', clienteId: null, trabajadorId: t.id })),
    ...clientes.map((c): Usuario => ({ id: c.userId!, email: c.email, tipo: 'CLIENTE', clienteId: c.id, trabajadorId: null })),
  ];

  const config = {
    nombre: 'Clínica Nuevo Palmar · Pilates',
    minutosAntelacionCancelacion: 60,
    diasVentanaReserva: 14,
    recuperacionCaducaConContrato: true,
    diasCaducidadRecuperacion: 30,
    diasCierre: [
      { fecha: `${ahora.getFullYear()}-10-12`, motivo: 'Fiesta Nacional' },
      { fecha: `${ahora.getFullYear()}-11-01`, motivo: 'Todos los Santos' },
      { fecha: `${ahora.getFullYear()}-12-06`, motivo: 'Día de la Constitución' },
      { fecha: `${ahora.getFullYear()}-12-08`, motivo: 'Inmaculada' },
      { fecha: `${ahora.getFullYear()}-12-25`, motivo: 'Navidad' },
    ],
    zonaHoraria: 'Europe/Madrid',
  };

  const clases = generarClases(plantillas, inicioPeriodo, finClases, config, [], () => id('cla'));

  // Reservas automáticas de los contratos con horario fijo
  let reservas: Reserva[] = [];
  for (const c of contratos) reservas = reservas.concat(generarReservasAutomaticas(c, clases, reservas, () => id('res'), ahoraISO));

  // Reservas de turno libre (María: lunes 18:00 y miércoles 18:00; Antonio: martes 17:00 reformer + jueves 11:00)
  const porPlantillaFecha = new Map(clases.map((c) => [`${c.plantillaId}|${c.fecha}`, c]));
  const reservaLibre = (clienteId: string, contratoId: string, plantillaId: string, fecha: string, origen: Reserva['origen'] = 'CLIENTE') => {
    const cl = porPlantillaFecha.get(`${plantillaId}|${fecha}`);
    if (!cl) return null;
    const r: Reserva = { id: id('res'), claseId: cl.id, clienteId, contratoId, origen, estado: 'RESERVADA', asistencia: 'PENDIENTE', recuperacionUsadaId: null, creadaEl: ahoraISO, creadaPor: clienteId, canceladaEl: null, canceladaPor: null };
    reservas.push(r);
    return r;
  };
  for (const cl of clases) {
    if (cl.fecha > sumarDias(hoy, 10)) continue;
    if (cl.plantillaId === 'pl-lun-1800' || cl.plantillaId === 'pl-mie-1800') reservaLibre('maria', 'con-maria', cl.plantillaId, cl.fecha);
    if (cl.plantillaId === 'pl-mar-1700') reservaLibre('antonio', 'con-antonio', cl.plantillaId, cl.fecha);
    if (cl.plantillaId === 'pl-jue-1100') reservaLibre('antonio', 'con-antonio', cl.plantillaId, cl.fecha);
    if ((cl.plantillaId === 'pl-mar-1800') && cl.fecha <= hoy) reservaLibre('lucia', 'con-lucia', cl.plantillaId, cl.fecha, 'BONO');
    if (cl.plantillaId === 'pl-sab-1100' && cl.fecha <= hoy) reservaLibre('miguel', 'con-miguel', cl.plantillaId, cl.fecha, 'BONO');
  }

  // Asistencia de clases pasadas: la mayoría asiste
  const semilla = (s: string) => s.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 997, 7);
  reservas = reservas.map((r) => {
    const cl = clases.find((c) => c.id === r.claseId)!;
    if (cl.fecha >= hoy) return r;
    return { ...r, asistencia: semilla(r.id) % 9 === 0 ? 'NO_ASISTE' : 'ASISTE' };
  });

  // Cancelaciones de ejemplo: Juan canceló un jueves pasado con antelación (recuperable) y otro sin antelación
  const recuperaciones: Db['recuperaciones'] = [];
  const pasadasJuan = reservas.filter((r) => r.clienteId === 'juan' && clases.find((c) => c.id === r.claseId)!.fecha < hoy);
  const [cancRec, cancNoRec] = [pasadasJuan[pasadasJuan.length - 1], pasadasJuan[pasadasJuan.length - 3]];
  if (cancRec) {
    const cl = clases.find((c) => c.id === cancRec.claseId)!;
    const res = clasificarCancelacion(cl, new Date(`${cl.fecha}T08:00:00`), config);
    Object.assign(cancRec, { estado: res.estado, asistencia: 'PENDIENTE', canceladaEl: `${cl.fecha}T08:00:00.000Z`, canceladaPor: 'juan' });
    recuperaciones.push({
      id: id('rec'), clienteId: 'juan', contratoId: 'con-juan', reservaOrigenId: cancRec.id, categoriaOrigen: 'DIRIGIDA',
      categoriasPermitidas: categoriasPermitidasRecuperacion('DIRIGIDA', tarifas[0]), motivo: 'CANCELACION_CLIENTE', estado: 'DISPONIBLE',
      caducaEl: caducidadRecuperacion(contratos[1], cl.fecha, config), usadaEnReservaId: null, creadaEl: `${cl.fecha}T08:00:00.000Z`, creadaPor: 'juan', nota: '',
    });
  }
  if (cancNoRec) {
    const cl = clases.find((c) => c.id === cancNoRec.claseId)!;
    Object.assign(cancNoRec, { estado: 'CANCELADA_NO_RECUPERABLE', asistencia: 'PENDIENTE', canceladaEl: `${cl.fecha}T17:30:00.000Z`, canceladaPor: 'juan' });
  }
  // María tiene una recuperación disponible autorizada como excepción para Reformer
  recuperaciones.push({
    id: id('rec'), clienteId: 'maria', contratoId: 'con-maria', reservaOrigenId: null, categoriaOrigen: 'DIRIGIDA',
    categoriasPermitidas: ['DIRIGIDA', 'REFORMER'], motivo: 'AUTORIZACION_MANUAL', estado: 'DISPONIBLE',
    caducaEl: finPeriodo, usadaEnReservaId: null, creadaEl: ahoraISO, creadaPor: 'tra-jose', nota: 'Compensación por clase de prueba de Reformer.',
  });

  const avisos: Db['avisos'] = [
    {
      id: id('avi'), titulo: 'Bienvenidos a la nueva app', cuerpo: 'Desde aquí puedes ver tu horario, reservar y cancelar clases y recibir los avisos del centro. Si tienes dudas, pregúntanos en recepción.',
      destino: { tipo: 'TODOS' }, destinatariosIds: clientes.map((c) => c.id), importante: false, publicadoEl: sumarDias(hoy, -3) + 'T09:00:00.000Z', publicadoPor: 'tra-jose',
    },
  ];

  return {
    version: DB_VERSION,
    config, actividades, tarifas, clientes, contratos, plantillas, clases, reservas, recuperaciones, avisos,
    lecturas: [], trabajadores, usuarios,
    auditoria: [{ id: id('aud'), instante: ahoraISO, actorId: 'sistema', actorNombre: 'Sistema', accion: 'SEED', entidad: 'db', entidadId: '-', detalle: 'Datos de demostración generados' }],
  };
}
