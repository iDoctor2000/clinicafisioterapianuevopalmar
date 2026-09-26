/**
 * Conversión entre las filas SQL de Supabase (snake_case; `date`, `time`,
 * `timestamptz`) y los tipos del dominio (camelCase; 'YYYY-MM-DD', 'HH:mm', ISO).
 *
 * Los tipos `Fila*` reflejan las columnas de supabase/migrations/0001_esquema.sql.
 * Las funciones `a*` van de fila → dominio y las `de*` de dominio → fila.
 */
import type {
  Actividad, Asistencia, Aviso, Categoria, Clase, Cliente, ConfigCentro, Contrato, DestinoAviso, DiaSemana, EstadoClase,
  EstadoContrato, EstadoRecuperacion, EstadoReserva, Id, InformacionClinica, LecturaAviso, Modalidad, MotivoRecuperacion,
  Ambito, OrigenReserva, Permiso, PlantillaClase, Recuperacion, RegistroAuditoria, Reserva, RolTrabajador, Tarifa, TipoTarifa, Trabajador,
} from '@/domain/types';
import type { Usuario } from '../db';

// ---------------------------------------------------------------------------
// Tipos de fila (columnas exactas del esquema)
// ---------------------------------------------------------------------------

export interface FilaConfigCentro {
  id: boolean;
  nombre: string;
  minutos_antelacion_cancelacion: number;
  dias_ventana_reserva: number;
  recuperacion_caduca_con_contrato: boolean;
  dias_caducidad_recuperacion: number;
  dias_generacion_clases: number;
  zona_horaria: string;
}
export interface FilaDiaCierre { fecha: string; motivo: string }

export interface FilaActividad {
  id: string; nombre: string; categoria: Categoria; descripcion: string; color: string; activa: boolean; orden: number;
}

export interface FilaTarifa {
  id: string; nombre: string; descripcion: string; tipo: TipoTarifa;
  bono_sesiones: number | null; bono_categoria: Categoria | null; bono_validez_meses: number | null;
  recuperacion_permitida: boolean; recuperacion_categorias_extra: Categoria[]; recuperacion_max_pendientes: number | null;
  precio_centimos: number | null; activa: boolean; orden: number;
}
export interface FilaTarifaCupo { tarifa_id: string; categoria: Categoria; sesiones_semana: number }

export interface FilaTrabajador {
  id: string; nombre: string; apellidos: string; email: string; telefono: string; rol: RolTrabajador;
  /** Columna añadida en 0005_ambito.sql (default CENTRO). */
  ambito?: Ambito | null;
  es_monitor: boolean; color: string; activo: boolean; user_id: string | null;
}
export interface FilaTrabajadorPermiso { trabajador_id: string; permiso: Permiso }
/** Vista `monitores`: lo que ve un cliente de los trabajadores (sin contacto). */
export interface FilaMonitor { id: string; nombre: string; apellidos: string; color: string; es_monitor: boolean; activo: boolean }

export interface FilaCliente {
  id: string; nombre: string; apellidos: string; dni: string; direccion: string; email: string; telefono: string;
  notificaciones_push: boolean; activo: boolean; user_id: string | null; alta_el: string; baja_el: string | null;
  /** Ruta del objeto en el bucket `fotos-clientes` (+ `?v=` para invalidar caché); null = sin foto. Columna de 0006. */
  foto_url?: string | null;
}
export interface FilaClienteClinica {
  cliente_id: string; lesiones: string; patologias: string; observaciones: string; actualizada_por: string | null; actualizado_el: string;
}

export interface FilaPlantillaClase {
  id: string; actividad_id: string; dia_semana: number; hora_inicio: string; duracion_min: number; monitor_id: string | null;
  plazas: number; activa: boolean; vigencia_desde: string | null; vigencia_hasta: string | null;
}

export interface FilaClase {
  id: string; plantilla_id: string | null; actividad_id: string; fecha: string; hora_inicio: string; duracion_min: number;
  monitor_id: string | null; plazas: number; estado: EstadoClase; extraordinaria: boolean; clase_alternativa_id: string | null;
  motivo_cancelacion: string | null; cancelado_el: string | null; cancelado_por: string | null;
}

export interface FilaContrato {
  id: string; cliente_id: string; tarifa_id: string; fecha_inicio: string; fecha_fin: string; modalidad: Modalidad;
  sesiones_restantes: number | null; estado: EstadoContrato; actividades_permitidas_ids: string[]; notas: string;
  creado_por: string | null; creado_el: string;
}
export interface FilaContratoFranja { contrato_id: string; plantilla_id: string }

export interface FilaReserva {
  id: string; clase_id: string; cliente_id: string; contrato_id: string | null; origen: OrigenReserva; estado: EstadoReserva;
  asistencia: Asistencia; recuperacion_usada_id: string | null; creado_por: string | null; creado_el: string;
  cancelado_el: string | null; cancelado_por: string | null;
}

export interface FilaRecuperacion {
  id: string; cliente_id: string; contrato_id: string | null; reserva_origen_id: string | null; categoria_origen: Categoria;
  categorias_permitidas: Categoria[]; motivo: MotivoRecuperacion; estado: EstadoRecuperacion; caduca_el: string;
  usada_en_reserva_id: string | null; nota: string; creado_por: string | null; creado_el: string;
}

export interface FilaAviso {
  id: string; titulo: string; cuerpo: string; destino_tipo: DestinoAviso['tipo']; destino_clase_id: string | null;
  destino_actividad_id: string | null; importante: boolean; publicado_el: string; publicado_por: string | null;
}
export interface FilaAvisoDestinatario { aviso_id: string; cliente_id: string }
export interface FilaAvisoLectura { aviso_id: string; cliente_id: string; leido_el: string }

export interface FilaAuditoria {
  id: string; instante: string; actor_id: string | null; actor_nombre: string; accion: string; entidad: string; entidad_id: string; detalle: string;
}

// ---------------------------------------------------------------------------
// Conversión de valores escalares
// ---------------------------------------------------------------------------

/** `time` de Postgres ('09:00:00') → 'HH:mm'. */
export function aHora(t: string): string {
  return t.slice(0, 5);
}
/** 'HH:mm' → `time` ('09:00:00'). */
export function deHora(h: string): string {
  return h.length === 5 ? `${h}:00` : h;
}
/** `date` de Postgres → 'YYYY-MM-DD' (por si llega con hora). */
export function aFecha(d: string): string {
  return d.slice(0, 10);
}
/** `timestamptz` ('2026-09-26 10:00:00.123+00' o ISO) → ISO 8601 en UTC. */
export function aInstante(t: string): string {
  // Normaliza el formato textual de Postgres: espacio en vez de 'T', hasta 6 decimales y desfase '+00' sin minutos.
  const iso = t.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? t : d.toISOString();
}
export function aInstanteONull(t: string | null | undefined): string | null {
  return t == null ? null : aInstante(t);
}
/** Los `*_por` guardan auth.users.id; NULL significa "sistema". */
const actor = (id: string | null | undefined): Id => id ?? 'sistema';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

export const CONFIG_POR_DEFECTO: ConfigCentro = {
  nombre: 'Nuevo Palmar Pilates', minutosAntelacionCancelacion: 60, diasVentanaReserva: 14, recuperacionCaducaConContrato: true,
  diasCaducidadRecuperacion: 30, diasCierre: [], zonaHoraria: 'Europe/Madrid',
};

export function aConfig(fila: FilaConfigCentro | null, cierres: FilaDiaCierre[]): ConfigCentro {
  const diasCierre = cierres.map((d) => ({ fecha: aFecha(d.fecha), motivo: d.motivo })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!fila) return { ...CONFIG_POR_DEFECTO, diasCierre };
  return {
    nombre: fila.nombre,
    minutosAntelacionCancelacion: fila.minutos_antelacion_cancelacion,
    diasVentanaReserva: fila.dias_ventana_reserva,
    recuperacionCaducaConContrato: fila.recuperacion_caduca_con_contrato,
    diasCaducidadRecuperacion: fila.dias_caducidad_recuperacion,
    zonaHoraria: fila.zona_horaria,
    diasCierre,
  };
}

/** Columnas de config_centro a actualizar (solo las presentes en el parcial). */
export function deConfig(c: Partial<ConfigCentro>): Partial<Omit<FilaConfigCentro, 'id' | 'dias_generacion_clases'>> {
  const fila: Partial<Omit<FilaConfigCentro, 'id' | 'dias_generacion_clases'>> = {};
  if (c.nombre !== undefined) fila.nombre = c.nombre;
  if (c.minutosAntelacionCancelacion !== undefined) fila.minutos_antelacion_cancelacion = c.minutosAntelacionCancelacion;
  if (c.diasVentanaReserva !== undefined) fila.dias_ventana_reserva = c.diasVentanaReserva;
  if (c.recuperacionCaducaConContrato !== undefined) fila.recuperacion_caduca_con_contrato = c.recuperacionCaducaConContrato;
  if (c.diasCaducidadRecuperacion !== undefined) fila.dias_caducidad_recuperacion = c.diasCaducidadRecuperacion;
  if (c.zonaHoraria !== undefined) fila.zona_horaria = c.zonaHoraria;
  return fila;
}

export function deDiasCierre(dias: ConfigCentro['diasCierre']): FilaDiaCierre[] {
  return dias.map((d) => ({ fecha: d.fecha, motivo: d.motivo }));
}

// ---------------------------------------------------------------------------
// Actividades y tarifas
// ---------------------------------------------------------------------------

export function aActividad(f: FilaActividad): Actividad {
  return { id: f.id, nombre: f.nombre, categoria: f.categoria, descripcion: f.descripcion, color: f.color, activa: f.activa };
}
export function deActividad(a: Actividad): Omit<FilaActividad, 'orden'> {
  return { id: a.id, nombre: a.nombre, categoria: a.categoria, descripcion: a.descripcion, color: a.color, activa: a.activa };
}

export function aTarifa(f: FilaTarifa, cupos: FilaTarifaCupo[]): Tarifa {
  return {
    id: f.id, nombre: f.nombre, descripcion: f.descripcion, tipo: f.tipo,
    cupos: cupos.filter((c) => c.tarifa_id === f.id).map((c) => ({ categoria: c.categoria, sesionesSemana: c.sesiones_semana })),
    bono: f.tipo === 'BONO' && f.bono_sesiones != null && f.bono_categoria != null
      ? { sesiones: f.bono_sesiones, categoria: f.bono_categoria, validezMeses: f.bono_validez_meses ?? 6 }
      : null,
    recuperacion: { permitida: f.recuperacion_permitida, categoriasExtra: f.recuperacion_categorias_extra ?? [], maxPendientes: f.recuperacion_max_pendientes },
    precioCentimos: f.precio_centimos, activa: f.activa, orden: f.orden,
  };
}
export function deTarifa(t: Tarifa): { tarifa: FilaTarifa; cupos: FilaTarifaCupo[] } {
  return {
    tarifa: {
      id: t.id, nombre: t.nombre, descripcion: t.descripcion, tipo: t.tipo,
      bono_sesiones: t.tipo === 'BONO' ? t.bono?.sesiones ?? null : null,
      bono_categoria: t.tipo === 'BONO' ? t.bono?.categoria ?? null : null,
      bono_validez_meses: t.tipo === 'BONO' ? t.bono?.validezMeses ?? null : null,
      recuperacion_permitida: t.recuperacion.permitida,
      recuperacion_categorias_extra: t.recuperacion.categoriasExtra,
      recuperacion_max_pendientes: t.recuperacion.maxPendientes,
      precio_centimos: t.precioCentimos, activa: t.activa, orden: t.orden,
    },
    cupos: (t.tipo === 'RECURRENTE' ? t.cupos : []).map((c) => ({ tarifa_id: t.id, categoria: c.categoria, sesiones_semana: c.sesionesSemana })),
  };
}

// ---------------------------------------------------------------------------
// Trabajadores
// ---------------------------------------------------------------------------

export function aTrabajador(f: FilaTrabajador, permisos: FilaTrabajadorPermiso[]): Trabajador {
  return {
    id: f.id, nombre: f.nombre, apellidos: f.apellidos, email: f.email, telefono: f.telefono, rol: f.rol,
    permisos: permisos.filter((p) => p.trabajador_id === f.id).map((p) => p.permiso),
    ambito: f.rol === 'ADMIN' ? 'CENTRO' : f.ambito ?? 'CENTRO',
    esMonitor: f.es_monitor, color: f.color, activo: f.activo, userId: f.user_id,
  };
}
/** Un cliente solo ve la vista `monitores`: sin contacto, rol MONITOR y sin permisos. */
export function aTrabajadorDesdeMonitor(f: FilaMonitor): Trabajador {
  return {
    id: f.id, nombre: f.nombre, apellidos: f.apellidos, email: '', telefono: '', rol: 'MONITOR', permisos: [], ambito: 'CENTRO',
    esMonitor: f.es_monitor, color: f.color, activo: f.activo, userId: null,
  };
}
/** No incluye user_id: la vinculación con la cuenta de acceso se hace desde Supabase, no desde la app. */
export function deTrabajador(t: Trabajador): { trabajador: Omit<FilaTrabajador, 'user_id'>; permisos: FilaTrabajadorPermiso[] } {
  return {
    trabajador: {
      id: t.id, nombre: t.nombre, apellidos: t.apellidos, email: t.email, telefono: t.telefono, rol: t.rol,
      ambito: t.rol === 'ADMIN' ? 'CENTRO' : t.ambito, es_monitor: t.esMonitor, color: t.color, activo: t.activo,
    },
    permisos: t.permisos.map((p) => ({ trabajador_id: t.id, permiso: p })),
  };
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export const CLINICA_VACIA: InformacionClinica = { lesiones: '', patologias: '', observaciones: '', actualizadaEl: null };

export function aCliente(f: FilaCliente, clinica: FilaClienteClinica | null | undefined): Cliente {
  return {
    id: f.id, nombre: f.nombre, apellidos: f.apellidos, dni: f.dni, direccion: f.direccion, email: f.email, telefono: f.telefono,
    clinica: clinica
      ? { lesiones: clinica.lesiones, patologias: clinica.patologias, observaciones: clinica.observaciones, actualizadaEl: aInstanteONull(clinica.actualizado_el) }
      : { ...CLINICA_VACIA },
    notificacionesPush: f.notificaciones_push, activo: f.activo, userId: f.user_id, altaEl: aFecha(f.alta_el), bajaEl: f.baja_el ? aFecha(f.baja_el) : null,
    fotoUrl: f.foto_url ?? null,
  };
}
/**
 * Sin user_id (se vincula desde Supabase), sin la parte clínica (tabla aparte) y sin la foto
 * (la gestiona `actualizarFotoCliente` junto con el bucket; así guardar la ficha nunca la pisa).
 */
export function deCliente(c: Cliente): Omit<FilaCliente, 'user_id' | 'foto_url'> {
  return {
    id: c.id, nombre: c.nombre, apellidos: c.apellidos, dni: c.dni, direccion: c.direccion, email: c.email, telefono: c.telefono,
    notificaciones_push: c.notificacionesPush, activo: c.activo, alta_el: c.altaEl, baja_el: c.bajaEl,
  };
}
export function deClinica(clienteId: Id, clinica: InformacionClinica, actualizadaPor: Id | null): Omit<FilaClienteClinica, 'actualizado_el'> {
  return { cliente_id: clienteId, lesiones: clinica.lesiones, patologias: clinica.patologias, observaciones: clinica.observaciones, actualizada_por: actualizadaPor };
}

// ---------------------------------------------------------------------------
// Horario y clases
// ---------------------------------------------------------------------------

export function aPlantilla(f: FilaPlantillaClase): PlantillaClase {
  return {
    id: f.id, actividadId: f.actividad_id, diaSemana: f.dia_semana as DiaSemana, horaInicio: aHora(f.hora_inicio), duracionMin: f.duracion_min,
    monitorId: f.monitor_id ?? '', plazas: f.plazas, activa: f.activa,
    vigenciaDesde: f.vigencia_desde ? aFecha(f.vigencia_desde) : null, vigenciaHasta: f.vigencia_hasta ? aFecha(f.vigencia_hasta) : null,
  };
}
export function dePlantilla(p: PlantillaClase): FilaPlantillaClase {
  return {
    id: p.id, actividad_id: p.actividadId, dia_semana: p.diaSemana, hora_inicio: deHora(p.horaInicio), duracion_min: p.duracionMin,
    monitor_id: p.monitorId || null, plazas: p.plazas, activa: p.activa, vigencia_desde: p.vigenciaDesde || null, vigencia_hasta: p.vigenciaHasta || null,
  };
}

export function aClase(f: FilaClase): Clase {
  return {
    id: f.id, plantillaId: f.plantilla_id, actividadId: f.actividad_id, fecha: aFecha(f.fecha), horaInicio: aHora(f.hora_inicio), duracionMin: f.duracion_min,
    monitorId: f.monitor_id ?? '', plazas: f.plazas, estado: f.estado, extraordinaria: f.extraordinaria, claseAlternativaId: f.clase_alternativa_id,
    motivoCancelacion: f.motivo_cancelacion, canceladaEl: aInstanteONull(f.cancelado_el), canceladaPor: f.cancelado_por,
  };
}
/** Fila para insertar una clase extraordinaria (sin plantilla, estado PROGRAMADA). */
export function deClaseNueva(c: Pick<Clase, 'id' | 'actividadId' | 'fecha' | 'horaInicio' | 'duracionMin' | 'monitorId' | 'plazas'>): Pick<FilaClase, 'id' | 'plantilla_id' | 'actividad_id' | 'fecha' | 'hora_inicio' | 'duracion_min' | 'monitor_id' | 'plazas' | 'estado' | 'extraordinaria'> {
  return {
    id: c.id, plantilla_id: null, actividad_id: c.actividadId, fecha: c.fecha, hora_inicio: deHora(c.horaInicio), duracion_min: c.duracionMin,
    monitor_id: c.monitorId || null, plazas: c.plazas, estado: 'PROGRAMADA', extraordinaria: true,
  };
}

// ---------------------------------------------------------------------------
// Contratos, reservas y recuperaciones
// ---------------------------------------------------------------------------

export function aContrato(f: FilaContrato, franjas: FilaContratoFranja[]): Contrato {
  return {
    id: f.id, clienteId: f.cliente_id, tarifaId: f.tarifa_id, fechaInicio: aFecha(f.fecha_inicio), fechaFin: aFecha(f.fecha_fin), modalidad: f.modalidad,
    franjasFijas: franjas.filter((x) => x.contrato_id === f.id).map((x) => ({ plantillaId: x.plantilla_id })),
    sesionesRestantes: f.sesiones_restantes, estado: f.estado, actividadesPermitidasIds: f.actividades_permitidas_ids ?? [], notas: f.notas,
    creadoEl: aInstante(f.creado_el), creadoPor: actor(f.creado_por),
  };
}

export function aReserva(f: FilaReserva): Reserva {
  return {
    id: f.id, claseId: f.clase_id, clienteId: f.cliente_id, contratoId: f.contrato_id, origen: f.origen, estado: f.estado, asistencia: f.asistencia,
    recuperacionUsadaId: f.recuperacion_usada_id, creadaEl: aInstante(f.creado_el), creadaPor: actor(f.creado_por),
    canceladaEl: aInstanteONull(f.cancelado_el), canceladaPor: f.cancelado_por,
  };
}

export function aRecuperacion(f: FilaRecuperacion): Recuperacion {
  return {
    id: f.id, clienteId: f.cliente_id, contratoId: f.contrato_id, reservaOrigenId: f.reserva_origen_id, categoriaOrigen: f.categoria_origen,
    categoriasPermitidas: f.categorias_permitidas ?? [], motivo: f.motivo, estado: f.estado, caducaEl: aFecha(f.caduca_el),
    usadaEnReservaId: f.usada_en_reserva_id, creadaEl: aInstante(f.creado_el), creadaPor: actor(f.creado_por), nota: f.nota,
  };
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

export function aDestino(f: Pick<FilaAviso, 'destino_tipo' | 'destino_clase_id' | 'destino_actividad_id'>, destinatariosIds: Id[]): DestinoAviso {
  switch (f.destino_tipo) {
    case 'CLASE':
      return { tipo: 'CLASE', claseId: f.destino_clase_id ?? '' };
    case 'ACTIVIDAD':
      return { tipo: 'ACTIVIDAD', actividadId: f.destino_actividad_id ?? '' };
    case 'CLIENTES':
      return { tipo: 'CLIENTES', clienteIds: destinatariosIds };
    default:
      return { tipo: 'TODOS' };
  }
}

export function aAviso(f: FilaAviso, destinatarios: FilaAvisoDestinatario[]): Aviso {
  const destinatariosIds = destinatarios.filter((d) => d.aviso_id === f.id).map((d) => d.cliente_id);
  return {
    id: f.id, titulo: f.titulo, cuerpo: f.cuerpo, destino: aDestino(f, destinatariosIds), destinatariosIds, importante: f.importante,
    publicadoEl: aInstante(f.publicado_el), publicadoPor: actor(f.publicado_por),
  };
}

/** Parámetros de la RPC publicar_aviso a partir de un DestinoAviso. */
export function deDestino(d: DestinoAviso): { p_destino_tipo: DestinoAviso['tipo']; p_destino_id: Id | null; p_cliente_ids: Id[] | null } {
  switch (d.tipo) {
    case 'CLASE':
      return { p_destino_tipo: 'CLASE', p_destino_id: d.claseId, p_cliente_ids: null };
    case 'ACTIVIDAD':
      return { p_destino_tipo: 'ACTIVIDAD', p_destino_id: d.actividadId, p_cliente_ids: null };
    case 'CLIENTES':
      return { p_destino_tipo: 'CLIENTES', p_destino_id: null, p_cliente_ids: d.clienteIds };
    default:
      return { p_destino_tipo: 'TODOS', p_destino_id: null, p_cliente_ids: null };
  }
}

export function aLectura(f: FilaAvisoLectura): LecturaAviso {
  return { avisoId: f.aviso_id, clienteId: f.cliente_id, leidoEl: aInstante(f.leido_el) };
}

// ---------------------------------------------------------------------------
// Auditoría y usuarios
// ---------------------------------------------------------------------------

export function aAuditoria(f: FilaAuditoria): RegistroAuditoria {
  return {
    id: f.id, instante: aInstante(f.instante), actorId: actor(f.actor_id), actorNombre: f.actor_nombre, accion: f.accion,
    entidad: f.entidad, entidadId: f.entidad_id, detalle: f.detalle,
  };
}

/** `usuarios` no existe como tabla: se deriva de clientes y trabajadores con cuenta vinculada. */
export function derivarUsuarios(clientes: Cliente[], trabajadores: Trabajador[]): Usuario[] {
  return [
    ...trabajadores.filter((t) => t.userId).map((t): Usuario => ({ id: t.userId!, email: t.email, tipo: 'TRABAJADOR', clienteId: null, trabajadorId: t.id })),
    ...clientes.filter((c) => c.userId).map((c): Usuario => ({ id: c.userId!, email: c.email, tipo: 'CLIENTE', clienteId: c.id, trabajadorId: null })),
  ];
}
