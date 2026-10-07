import type {
  Actividad, Aviso, Clase, Cliente, ConfigCentro, Contrato, LecturaAviso, Pago, PlantillaClase,
  PortadaImagen, PremioMes, Recuperacion, RegistroAuditoria, Reserva, Trabajador, Id,
} from '@/domain/types';

/** Usuario de acceso (en producción lo gestiona Supabase Auth). */
export interface Usuario {
  id: Id;
  email: string;
  tipo: 'CLIENTE' | 'TRABAJADOR';
  clienteId: Id | null;
  trabajadorId: Id | null;
}

/** Instantánea completa de los datos del centro. */
export interface Db {
  version: number;
  config: ConfigCentro;
  actividades: Actividad[];
  tarifas: Tarifa[];
  clientes: Cliente[];
  contratos: Contrato[];
  /** Cobros de los contratos (cuotas y cobros sueltos). */
  pagos: Pago[];
  plantillas: PlantillaClase[];
  clases: Clase[];
  reservas: Reserva[];
  recuperaciones: Recuperacion[];
  avisos: Aviso[];
  lecturas: LecturaAviso[];
  trabajadores: Trabajador[];
  usuarios: Usuario[];
  auditoria: RegistroAuditoria[];
  /** Fotos del carrusel de la portada del cliente (gestiona el administrador en Ajustes). */
  portada: PortadaImagen[];
  /** Premios "Cliente del mes" (uno por mes). */
  premios: PremioMes[];
}

import type { Tarifa } from '@/domain/types';

/** Versión de la instantánea persistida en demo: al cambiar, la demo se regenera desde el seed. */
export const DB_VERSION = 4;

let contador = 0;
export function nuevoId(prefijo = 'id'): Id {
  contador += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefijo}-${Date.now().toString(36)}${contador.toString(36)}${rnd}`;
}

export function indexar<T extends { id: Id }>(items: T[]): Map<Id, T> {
  return new Map(items.map((i) => [i.id, i]));
}

/** Instantánea sin datos (estado inicial en modo Supabase, antes de cargar). */
export function dbVacio(): Db {
  return {
    version: DB_VERSION,
    config: { nombre: 'Nuevo Palmar Pilates', minutosAntelacionCancelacion: 60, diasVentanaReserva: 14, recuperacionCaducaConContrato: true, diasCaducidadRecuperacion: 30, diasCierre: [], zonaHoraria: 'Europe/Madrid' },
    actividades: [], tarifas: [], clientes: [], contratos: [], pagos: [], plantillas: [], clases: [], reservas: [], recuperaciones: [],
    avisos: [], lecturas: [], trabajadores: [], usuarios: [], auditoria: [], portada: [], premios: [],
  };
}
