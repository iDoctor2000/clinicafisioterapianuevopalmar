import type { Cliente, Contrato, Sesion, Tarifa } from '@/domain/types';
import { useStore } from '@/data/store';
import { contratoActivoDe, tarifaDe } from '@/data/selectores';
import type { Db } from '@/data/db';

export type SesionCliente = Extract<Sesion, { tipo: 'CLIENTE' }>;

export interface ContextoCliente {
  db: Db;
  sesion: SesionCliente;
  cliente: Cliente;
  contrato: Contrato | null;
  tarifa: Tarifa | null;
}

/**
 * Datos del cliente con sesión iniciada. La zona cliente solo se monta con una
 * sesión de tipo CLIENTE (ver App.tsx), así que cualquier otra cosa es un error de programación.
 */
export function useCliente(): ContextoCliente {
  const db = useStore((s) => s.db);
  const sesion = useStore((s) => s.sesion);
  if (!sesion || sesion.tipo !== 'CLIENTE') throw new Error('La zona cliente requiere una sesión de cliente.');
  const cliente = db.clientes.find((c) => c.id === sesion.clienteId);
  if (!cliente) throw new Error('Cliente no encontrado.');
  const contrato = contratoActivoDe(db, cliente.id);
  const tarifa = tarifaDe(db, contrato);
  return { db, sesion, cliente, contrato, tarifa };
}
