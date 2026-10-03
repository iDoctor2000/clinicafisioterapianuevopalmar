/**
 * Modelo de dominio de Nuevo Palmar Pilates.
 *
 * Convenciones:
 *  - Fechas de calendario: 'YYYY-MM-DD' (hora local del centro, Europe/Madrid).
 *  - Horas: 'HH:mm'.
 *  - Instantes (auditoría): ISO 8601 completo.
 *  - Los identificadores son cadenas (uuid en producción).
 */

export type ISODate = string; // 'YYYY-MM-DD'
export type HoraHHmm = string; // 'HH:mm'
export type ISOInstant = string; // '2026-09-26T10:00:00.000Z'
export type Id = string;

/** Familia de actividad. Es la unidad sobre la que se definen los derechos de una tarifa. */
export type Categoria = 'DIRIGIDA' | 'REFORMER';

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  DIRIGIDA: 'Actividades dirigidas',
  REFORMER: 'Reformer',
};

// ---------------------------------------------------------------------------
// Configuración del centro
// ---------------------------------------------------------------------------

export interface DiaCierre {
  fecha: ISODate;
  motivo: string;
}

export interface ConfigCentro {
  nombre: string;
  /** Antelación mínima (en minutos) para que una cancelación sea recuperable. */
  minutosAntelacionCancelacion: number;
  /** Con cuántos días de antelación puede reservar un cliente de turno libre. */
  diasVentanaReserva: number;
  /** Las recuperaciones caducan al finalizar el contrato (true) o a los N días (false). */
  recuperacionCaducaConContrato: boolean;
  diasCaducidadRecuperacion: number;
  /** Días de cierre y festivos: no se generan clases ni reservas. */
  diasCierre: DiaCierre[];
  /** Zona horaria del centro. */
  zonaHoraria: string;
}

// ---------------------------------------------------------------------------
// Actividades y tarifas
// ---------------------------------------------------------------------------

export interface Actividad {
  id: Id;
  nombre: string;
  categoria: Categoria;
  descripcion: string;
  /** Color de la actividad en calendarios (clase Tailwind o hex). */
  color: string;
  activa: boolean;
}

export type TipoTarifa = 'RECURRENTE' | 'BONO' | 'CLASE_SUELTA';

/** Cupo semanal por categoría. Ej. Mixta = [{REFORMER,1},{DIRIGIDA,1}]. */
export interface CupoSemanal {
  categoria: Categoria;
  sesionesSemana: number;
}

export interface ReglasRecuperacion {
  permitida: boolean;
  /** Categorías en las que se puede usar la recuperación además de la de origen. */
  categoriasExtra: Categoria[];
  /** Máximo de recuperaciones pendientes simultáneas (null = sin límite). */
  maxPendientes: number | null;
}

export interface Tarifa {
  id: Id;
  nombre: string;
  descripcion: string;
  tipo: TipoTarifa;
  /** Solo RECURRENTE: cupos semanales por categoría. */
  cupos: CupoSemanal[];
  /** Solo BONO: número de sesiones y categoría. */
  bono: { sesiones: number; categoria: Categoria; validezMeses: number } | null;
  recuperacion: ReglasRecuperacion;
  /** Precio en céntimos (preparado para pagos online). null = consultar. */
  precioCentimos: number | null;
  activa: boolean;
  orden: number;
}

// ---------------------------------------------------------------------------
// Clientes y contratos
// ---------------------------------------------------------------------------

export interface InformacionClinica {
  lesiones: string;
  patologias: string;
  observaciones: string;
  actualizadaEl: ISOInstant | null;
}

export interface Cliente {
  id: Id;
  nombre: string;
  apellidos: string;
  dni: string;
  direccion: string;
  email: string;
  telefono: string;
  /** Información clínica: acceso restringido por permiso. */
  clinica: InformacionClinica;
  notificacionesPush: boolean;
  activo: boolean;
  /** Usuario de acceso (auth) vinculado, si lo tiene. */
  userId: Id | null;
  altaEl: ISODate;
  bajaEl: ISODate | null;
  /**
   * Foto del cliente (para identificarle en clase). null = sin foto (se muestran las iniciales).
   * En demo es una data URL; en Supabase es la ruta del objeto en el bucket privado
   * `fotos-clientes` (`<clienteId>/avatar.jpg?v=<marca>`), que la app convierte en URL firmada.
   */
  fotoUrl: string | null;
  /**
   * Instante en que el cliente aceptó la política de privacidad (en la app o firmada en papel).
   * null = consentimiento pendiente: en producción la app se lo pide antes de dejarle entrar.
   */
  consentimientoEl: ISOInstant | null;
  /** Versión de la política aceptada ('2026-09-27') o 'papel' si lo registró el personal. */
  consentimientoVersion: string | null;
}

export type Modalidad = 'FIJO' | 'LIBRE';
export type EstadoContrato = 'ACTIVO' | 'FINALIZADO' | 'CANCELADO';

/** Franja semanal contratada (horario fijo). Apunta a una plantilla de clase. */
export interface FranjaFija {
  plantillaId: Id;
}

export interface Contrato {
  id: Id;
  clienteId: Id;
  tarifaId: Id;
  fechaInicio: ISODate;
  fechaFin: ISODate;
  modalidad: Modalidad;
  /** Solo modalidad FIJO. */
  franjasFijas: FranjaFija[];
  /** Solo BONO: sesiones restantes. */
  sesionesRestantes: number | null;
  estado: EstadoContrato;
  /** Actividades concretas permitidas (vacío = todas las de las categorías de la tarifa). */
  actividadesPermitidasIds: Id[];
  notas: string;
  creadoEl: ISOInstant;
  creadoPor: Id;
}

// ---------------------------------------------------------------------------
// Horario, clases y reservas
// ---------------------------------------------------------------------------

/** 1 = lunes … 7 = domingo (ISO). */
export type DiaSemana = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PlantillaClase {
  id: Id;
  actividadId: Id;
  diaSemana: DiaSemana;
  horaInicio: HoraHHmm;
  duracionMin: number;
  monitorId: Id;
  plazas: number;
  activa: boolean;
  vigenciaDesde: ISODate | null;
  vigenciaHasta: ISODate | null;
}

export type EstadoClase = 'PROGRAMADA' | 'CANCELADA';

export interface Clase {
  id: Id;
  plantillaId: Id | null;
  actividadId: Id;
  fecha: ISODate;
  horaInicio: HoraHHmm;
  duracionMin: number;
  monitorId: Id;
  plazas: number;
  estado: EstadoClase;
  extraordinaria: boolean;
  /** Si el centro la cancela, puede proponer una clase alternativa. */
  claseAlternativaId: Id | null;
  motivoCancelacion: string | null;
  canceladaEl: ISOInstant | null;
  canceladaPor: Id | null;
}

export type OrigenReserva =
  | 'AUTOMATICA' // generada por horario fijo
  | 'CLIENTE' // reservada por el cliente (turno libre)
  | 'MANUAL' // creada por un trabajador
  | 'RECUPERACION' // usando una recuperación
  | 'BONO' // descontada de un bono
  | 'CLASE_SUELTA'; // CS, sin tarifa

export type EstadoReserva =
  | 'RESERVADA'
  | 'CANCELADA_RECUPERABLE'
  | 'CANCELADA_NO_RECUPERABLE'
  | 'CANCELADA_CENTRO';

export type Asistencia = 'PENDIENTE' | 'ASISTE' | 'NO_ASISTE';

export interface Reserva {
  id: Id;
  claseId: Id;
  clienteId: Id;
  contratoId: Id | null;
  origen: OrigenReserva;
  estado: EstadoReserva;
  asistencia: Asistencia;
  /** Recuperación consumida para hacer esta reserva. */
  recuperacionUsadaId: Id | null;
  creadaEl: ISOInstant;
  creadaPor: Id; // userId (cliente o trabajador) o 'sistema'
  canceladaEl: ISOInstant | null;
  canceladaPor: Id | null;
}

export type EstadoRecuperacion = 'DISPONIBLE' | 'USADA' | 'CADUCADA';
export type MotivoRecuperacion = 'CANCELACION_CLIENTE' | 'CANCELACION_CENTRO' | 'AUTORIZACION_MANUAL';

export interface Recuperacion {
  id: Id;
  clienteId: Id;
  contratoId: Id | null;
  reservaOrigenId: Id | null;
  categoriaOrigen: Categoria;
  /** Categorías en las que puede utilizarse (incluye la de origen; puede ampliarse por excepción). */
  categoriasPermitidas: Categoria[];
  motivo: MotivoRecuperacion;
  estado: EstadoRecuperacion;
  caducaEl: ISODate;
  usadaEnReservaId: Id | null;
  creadaEl: ISOInstant;
  creadaPor: Id;
  nota: string;
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

export type DestinoAviso =
  | { tipo: 'TODOS' }
  | { tipo: 'CLASE'; claseId: Id }
  | { tipo: 'ACTIVIDAD'; actividadId: Id }
  | { tipo: 'CLIENTES'; clienteIds: Id[] };

export interface Aviso {
  id: Id;
  titulo: string;
  cuerpo: string;
  destino: DestinoAviso;
  /** Clientes destinatarios resueltos en el momento de publicar. */
  destinatariosIds: Id[];
  importante: boolean;
  publicadoEl: ISOInstant;
  publicadoPor: Id;
}

export interface LecturaAviso {
  avisoId: Id;
  clienteId: Id;
  leidoEl: ISOInstant;
}

// ---------------------------------------------------------------------------
// Portada del cliente (carrusel de fotos del centro)
// ---------------------------------------------------------------------------

export interface PortadaImagen {
  id: Id;
  /** URL lista para `<img>`: pública del bucket `portada` en Supabase; data URL o ruta local en demo. */
  url: string;
  /** Pie de foto opcional (vacío = sin pie). */
  pie: string;
  /** Posición en el carrusel (ascendente). */
  orden: number;
  /** Solo las activas se muestran a los clientes. */
  activa: boolean;
  creadoEl: ISOInstant;
}

// ---------------------------------------------------------------------------
// Trabajadores, permisos y auditoría
// ---------------------------------------------------------------------------

export const PERMISOS = [
  'CLIENTES_EDITAR',
  'CLIENTES_VER',
  'CLINICA_VER',
  'RESERVAS_GESTIONAR',
  'HORARIOS_GESTIONAR',
  'CLASES_CREAR_CANCELAR',
  'CLASES_SUELTAS',
  'AVISOS_ENVIAR',
  'TARIFAS_GESTIONAR',
  'ESTADISTICAS_VER',
  'TRABAJADORES_GESTIONAR',
  'ASISTENCIA_REGISTRAR',
] as const;

export type Permiso = (typeof PERMISOS)[number];

export const PERMISO_LABEL: Record<Permiso, string> = {
  CLIENTES_EDITAR: 'Crear y modificar fichas de clientes',
  CLIENTES_VER: 'Consultar fichas de clientes',
  CLINICA_VER: 'Consultar información clínica',
  RESERVAS_GESTIONAR: 'Gestionar reservas y recuperaciones',
  HORARIOS_GESTIONAR: 'Gestionar horarios semanales',
  CLASES_CREAR_CANCELAR: 'Crear y cancelar clases',
  CLASES_SUELTAS: 'Introducir clases sueltas',
  AVISOS_ENVIAR: 'Crear y enviar avisos',
  TARIFAS_GESTIONAR: 'Gestionar actividades y tarifas',
  ESTADISTICAS_VER: 'Consultar estadísticas',
  TRABAJADORES_GESTIONAR: 'Gestionar trabajadores y permisos',
  ASISTENCIA_REGISTRAR: 'Registrar asistencia',
};

export type RolTrabajador = 'ADMIN' | 'MONITOR' | 'RECEPCION';

/**
 * Ámbito de un trabajador: sobre qué clases (y, por tanto, qué alumnos, avisos y
 * estadísticas) actúan sus permisos.
 *  - CENTRO: todo el centro.
 *  - SUS_CLASES: solo las clases que imparte (clase.monitorId = trabajador).
 * Un ADMIN siempre tiene ámbito CENTRO.
 */
export type Ambito = 'CENTRO' | 'SUS_CLASES';

export const AMBITO_LABEL: Record<Ambito, string> = {
  CENTRO: 'Todo el centro',
  SUS_CLASES: 'Solo sus clases',
};

export const AMBITO_DESCRIPCION: Record<Ambito, string> = {
  CENTRO: 'Ve y gestiona todas las clases y clientes del centro, según sus permisos.',
  SUS_CLASES: 'Solo ve y gestiona las clases que imparte y a sus alumnos. No puede modificar horarios ni enviar avisos generales.',
};

export interface Trabajador {
  id: Id;
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
  rol: RolTrabajador;
  permisos: Permiso[];
  /** Alcance de sus permisos: todo el centro o solo las clases que imparte. */
  ambito: Ambito;
  /** Puede impartir clases (aparece como monitor en horarios). */
  esMonitor: boolean;
  color: string;
  activo: boolean;
  userId: Id | null;
}

export interface RegistroAuditoria {
  id: Id;
  instante: ISOInstant;
  actorId: Id;
  actorNombre: string;
  accion: string;
  entidad: string;
  entidadId: Id;
  detalle: string;
}

// ---------------------------------------------------------------------------
// Sesión de usuario
// ---------------------------------------------------------------------------

export type Sesion =
  | { tipo: 'CLIENTE'; userId: Id; clienteId: Id; nombre: string }
  | {
      tipo: 'TRABAJADOR'; userId: Id; trabajadorId: Id; nombre: string; permisos: Permiso[]; rol: RolTrabajador;
      /** Ámbito del trabajador. Si falta, se resuelve desde su ficha (ver domain/ambito.ts). */
      ambito?: Ambito;
    };

export function tienePermiso(sesion: Sesion | null, permiso: Permiso): boolean {
  if (!sesion || sesion.tipo !== 'TRABAJADOR') return false;
  return sesion.rol === 'ADMIN' || sesion.permisos.includes(permiso);
}
