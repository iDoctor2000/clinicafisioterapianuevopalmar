import type {
  Actividad, Aviso, Clase, Cliente, ConfigCentro, Contrato, LecturaAviso, PlantillaClase,
  Recuperacion, RegistroAuditoria, Reserva, Trabajador, Id,
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
  plantillas: PlantillaClase[];
  clases: Clase[];
  reservas: Reserva[];
  recuperaciones: Recuperacion[];
  avisos: Aviso[];
  lecturas: LecturaAviso[];
  trabajadores: Trabajador[];
  usuarios: Usuario[];
  auditoria: RegistroAuditoria[];
}

import type { Tarifa } from '@/domain/types';

export const DB_VERSION = 1;

let contador = 0;
export function nuevoId(prefijo = 'id'): Id {
  contador += 1;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefijo}-${Date.now().toString(36)}${contador.toString(36)}${rnd}`;
}

export function indexar<T extends { id: Id }>(items: T[]): Map<Id, T> {
  return new Map(items.map((i) => [i.id, i]));
}
