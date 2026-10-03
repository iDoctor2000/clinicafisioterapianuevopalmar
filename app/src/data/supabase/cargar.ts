/**
 * Carga la instantánea completa (`Db`) desde Supabase.
 * Lee todas las tablas en paralelo respetando lo que RLS deje ver: una tabla
 * no visible (o que falle) se convierte en lista vacía y se avisa por consola.
 * Solo si falla la configuración del centro (visible para cualquier usuario
 * autenticado) se considera que la carga entera ha fallado.
 */
import { addMonths } from 'date-fns';
import { aISODate } from '@/domain/fechas';
import { DB_VERSION, type Db } from '../db';
import { mensajeError, servidor } from './cliente';
import {
  aActividad, aAuditoria, aAviso, aClase, aCliente, aConfig, aContrato, aLectura, aPlantilla, aRecuperacion, aReserva, aTarifa,
  aPortadaImagen, aTrabajador, aTrabajadorDesdeMonitor, derivarUsuarios,
  type FilaActividad, type FilaAuditoria, type FilaAviso, type FilaAvisoDestinatario, type FilaAvisoLectura, type FilaClase, type FilaCliente,
  type FilaClienteClinica, type FilaConfigCentro, type FilaContrato, type FilaContratoFranja, type FilaDiaCierre, type FilaMonitor,
  type FilaPlantillaClase, type FilaPortadaImagen, type FilaRecuperacion, type FilaReserva, type FilaTarifa, type FilaTarifaCupo, type FilaTrabajador, type FilaTrabajadorPermiso,
} from './mapeo';

/** Meses hacia atrás y hacia delante que se cargan de clases y reservas. */
export const MESES_RANGO = 3;
const LIMITE_FILAS = 10000;

interface Rango { desde: string; hasta: string }
export function rangoCarga(ahora: Date = new Date()): Rango {
  return { desde: aISODate(addMonths(ahora, -MESES_RANGO)), hasta: aISODate(addMonths(ahora, MESES_RANGO)) };
}

type Consulta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Ejecuta una consulta; si falla devuelve [] y avisa (no tumba la carga). */
async function tabla<T>(nombre: string, consulta: Consulta<T>): Promise<T[]> {
  try {
    const { data, error } = await consulta;
    if (error) {
      console.warn(`[supabase] No se ha podido leer "${nombre}": ${error.message}`);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.warn(`[supabase] Error leyendo "${nombre}": ${mensajeError(e)}`);
    return [];
  }
}

export async function cargarDb(ahora: Date = new Date()): Promise<Db> {
  const sb = servidor();
  const { desde, hasta } = rangoCarga(ahora);
  const de = <T>(t: string) => sb.from(t).select('*').limit(LIMITE_FILAS) as unknown as Consulta<T>;

  // La configuración es visible para cualquier usuario autenticado: si falla, falla la carga.
  const configRes = await sb.from('config_centro').select('*').limit(1).maybeSingle();
  if (configRes.error) throw new Error(`No se han podido cargar los datos del centro: ${mensajeError(configRes.error)}`);

  const [
    cierres, actividades, tarifas, cupos, trabajadores, permisos, monitores, clientes, clinicas, plantillas, clases, contratos, franjas,
    reservas, recuperaciones, avisos, destinatarios, lecturas, auditoria, portada,
  ] = await Promise.all([
    tabla<FilaDiaCierre>('dias_cierre', de('dias_cierre')),
    tabla<FilaActividad>('actividades', sb.from('actividades').select('*').order('orden').order('nombre') as unknown as Consulta<FilaActividad>),
    tabla<FilaTarifa>('tarifas', sb.from('tarifas').select('*').order('orden').order('nombre') as unknown as Consulta<FilaTarifa>),
    tabla<FilaTarifaCupo>('tarifa_cupos', de('tarifa_cupos')),
    tabla<FilaTrabajador>('trabajadores', de('trabajadores')),
    tabla<FilaTrabajadorPermiso>('trabajador_permisos', de('trabajador_permisos')),
    tabla<FilaMonitor>('monitores', de('monitores')),
    tabla<FilaCliente>('clientes', sb.from('clientes').select('*').order('apellidos').order('nombre').limit(LIMITE_FILAS) as unknown as Consulta<FilaCliente>),
    tabla<FilaClienteClinica>('clientes_clinica', de('clientes_clinica')),
    tabla<FilaPlantillaClase>('plantillas_clase', de('plantillas_clase')),
    tabla<FilaClase>('clases', sb.from('clases').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora_inicio').limit(LIMITE_FILAS) as unknown as Consulta<FilaClase>),
    tabla<FilaContrato>('contratos', de('contratos')),
    tabla<FilaContratoFranja>('contrato_franjas', de('contrato_franjas')),
    // Las reservas no tienen fecha propia: se filtran por la de su clase (relación embebida clases!inner).
    tabla<FilaReserva>('reservas', sb.from('reservas').select('*, clases!inner(fecha)').gte('clases.fecha', desde).lte('clases.fecha', hasta).limit(LIMITE_FILAS) as unknown as Consulta<FilaReserva>),
    tabla<FilaRecuperacion>('recuperaciones', de('recuperaciones')),
    tabla<FilaAviso>('avisos', sb.from('avisos').select('*').order('publicado_el', { ascending: false }).limit(500) as unknown as Consulta<FilaAviso>),
    tabla<FilaAvisoDestinatario>('aviso_destinatarios', de('aviso_destinatarios')),
    tabla<FilaAvisoLectura>('aviso_lecturas', de('aviso_lecturas')),
    tabla<FilaAuditoria>('auditoria', sb.from('auditoria').select('*').order('instante', { ascending: false }).limit(2000) as unknown as Consulta<FilaAuditoria>),
    // Carrusel de la portada (0008). Si la migración no está aplicada, la tabla no existe y queda vacío (aviso en consola).
    tabla<FilaPortadaImagen>('portada_imagenes', sb.from('portada_imagenes').select('*').order('orden').limit(50) as unknown as Consulta<FilaPortadaImagen>),
  ]);

  const clinicaPorCliente = new Map(clinicas.map((c) => [c.cliente_id, c]));
  const listaClientes = clientes.map((c) => aCliente(c, clinicaPorCliente.get(c.id)));
  // Un trabajador ve la tabla `trabajadores`; un cliente solo la vista `monitores`.
  const listaTrabajadores = trabajadores.length > 0 ? trabajadores.map((t) => aTrabajador(t, permisos)) : monitores.map(aTrabajadorDesdeMonitor);

  return {
    version: DB_VERSION,
    config: aConfig((configRes.data as FilaConfigCentro | null) ?? null, cierres),
    actividades: actividades.map(aActividad),
    tarifas: tarifas.map((t) => aTarifa(t, cupos)),
    clientes: listaClientes,
    contratos: contratos.map((c) => aContrato(c, franjas)),
    plantillas: plantillas.map(aPlantilla),
    clases: clases.map(aClase),
    reservas: reservas.map(aReserva),
    recuperaciones: recuperaciones.map(aRecuperacion),
    avisos: avisos.map((a) => aAviso(a, destinatarios)),
    lecturas: lecturas.map(aLectura),
    trabajadores: listaTrabajadores,
    usuarios: derivarUsuarios(listaClientes, listaTrabajadores),
    auditoria: auditoria.map(aAuditoria),
    portada: portada.map(aPortadaImagen),
  };
}
