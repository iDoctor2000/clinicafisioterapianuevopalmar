/**
 * Carga la instantánea completa (`Db`) desde Supabase.
 * Lee todas las tablas en paralelo respetando lo que RLS deje ver: una tabla
 * no visible (o que falle) se convierte en lista vacía y se avisa por consola.
 * Solo si falla la configuración del centro (visible para cualquier usuario
 * autenticado) se considera que la carga entera ha fallado.
 *
 * La API de Supabase devuelve como mucho 1000 filas por petición ("Max rows") y
 * recorta EN SILENCIO lo que pase de ahí, aunque se pida un límite mayor. Por eso
 * cada tabla se lee por páginas de 1000 hasta que no quedan más (`leerPaginado`).
 */
import { addMonths } from 'date-fns';
import { aISODate } from '@/domain/fechas';
import { DB_VERSION, type Db } from '../db';
import { mensajeError, servidor } from './cliente';
import {
  aActividad, aAuditoria, aAviso, aClase, aCliente, aConfig, aContrato, aLectura, aPago, aPlantilla, aRecuperacion, aReserva, aTarifa,
  aPortadaImagen, aPremioMes, aTrabajador, aTrabajadorDesdeMonitor, derivarUsuarios,
  type FilaActividad, type FilaAuditoria, type FilaAviso, type FilaAvisoDestinatario, type FilaAvisoLectura, type FilaClase, type FilaCliente,
  type FilaClienteClinica, type FilaConfigCentro, type FilaContrato, type FilaContratoFranja, type FilaDiaCierre, type FilaPago, type FilaMonitor,
  type FilaOcupacionClase, type FilaPlantillaClase, type FilaPortadaImagen, type FilaPremioMes, type FilaRecuperacion, type FilaReserva, type FilaTarifa,
  type FilaTarifaCupo, type FilaTrabajador, type FilaTrabajadorPermiso,
} from './mapeo';

/** Meses hacia atrás y hacia delante que se cargan de clases y reservas. */
export const MESES_RANGO = 3;
/** Filas por petición: el máximo que devuelve la API de Supabase ("Max rows" en Settings → API). */
export const PAGINA = 1000;
/** Tope de seguridad por tabla (páginas): 50 000 filas, muy por encima de lo que maneja el centro. */
const MAX_PAGINAS = 50;

interface Rango { desde: string; hasta: string }
export function rangoCarga(ahora: Date = new Date()): Rango {
  return { desde: aISODate(addMonths(ahora, -MESES_RANGO)), hasta: aISODate(addMonths(ahora, MESES_RANGO)) };
}

export type Consulta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>;
/** Construye la consulta de una página: filas desde `desde` hasta `hasta` (ambas incluidas, empezando en 0). */
export type Paginada<T> = (desde: number, hasta: number) => Consulta<T>;

/**
 * Lee una tabla completa por páginas. Si una página falla, devuelve lo leído hasta
 * entonces y avisa (no tumba la carga). La consulta debe llevar un orden estable
 * (p. ej. la clave primaria) para que las páginas no se solapen ni dejen huecos.
 * Si la consulta pide el total (`count: 'exact'`), se lee hasta alcanzarlo, valga lo
 * que valga el tope de filas del servidor; si no, se para en la primera página corta.
 */
export async function leerPaginado<T>(nombre: string, consulta: Paginada<T>, maxPaginas = MAX_PAGINAS): Promise<T[]> {
  const filas: T[] = [];
  try {
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const { data, error, count } = await consulta(filas.length, filas.length + PAGINA - 1);
      if (error) {
        console.warn(`[supabase] No se ha podido leer "${nombre}"${pagina > 0 ? ` (página ${pagina + 1})` : ''}: ${error.message}`);
        break;
      }
      const lote = data ?? [];
      filas.push(...lote);
      if (lote.length === 0) break;
      if (typeof count === 'number' ? filas.length >= count : lote.length < PAGINA) break;
    }
  } catch (e) {
    console.warn(`[supabase] Error leyendo "${nombre}": ${mensajeError(e)}`);
  }
  return filas;
}

export async function cargarDb(ahora: Date = new Date()): Promise<Db> {
  const sb = servidor();
  const { desde, hasta } = rangoCarga(ahora);
  // Tabla entera, ordenada por su clave (necesario para paginar bien).
  const de = <T>(t: string, ...orden: string[]): Paginada<T> => (d, h) => {
    let q = sb.from(t).select('*', { count: 'exact' });
    for (const col of orden.length ? orden : ['id']) q = q.order(col);
    return q.range(d, h) as unknown as Consulta<T>;
  };

  // La configuración es visible para cualquier usuario autenticado: si falla, falla la carga.
  const configRes = await sb.from('config_centro').select('*').limit(1).maybeSingle();
  if (configRes.error) throw new Error(`No se han podido cargar los datos del centro: ${mensajeError(configRes.error)}`);

  const [
    cierres, actividades, tarifas, cupos, trabajadores, permisos, monitores, clientes, clinicas, plantillas, clases, ocupacion, contratos, franjas, pagos,
    reservas, recuperaciones, avisos, destinatarios, lecturas, auditoria, portada, premios,
  ] = await Promise.all([
    leerPaginado<FilaDiaCierre>('dias_cierre', de('dias_cierre', 'fecha')),
    leerPaginado<FilaActividad>('actividades', de('actividades', 'orden', 'nombre', 'id')),
    leerPaginado<FilaTarifa>('tarifas', de('tarifas', 'orden', 'nombre', 'id')),
    leerPaginado<FilaTarifaCupo>('tarifa_cupos', de('tarifa_cupos', 'tarifa_id', 'categoria')),
    leerPaginado<FilaTrabajador>('trabajadores', de('trabajadores')),
    leerPaginado<FilaTrabajadorPermiso>('trabajador_permisos', de('trabajador_permisos', 'trabajador_id', 'permiso')),
    leerPaginado<FilaMonitor>('monitores', de('monitores')),
    leerPaginado<FilaCliente>('clientes', de('clientes', 'apellidos', 'nombre', 'id')),
    leerPaginado<FilaClienteClinica>('clientes_clinica', de('clientes_clinica', 'cliente_id')),
    leerPaginado<FilaPlantillaClase>('plantillas_clase', de('plantillas_clase')),
    leerPaginado<FilaClase>('clases', (d, h) => sb.from('clases').select('*', { count: 'exact' }).gte('fecha', desde).lte('fecha', hasta).order('fecha').order('hora_inicio').order('id').range(d, h) as unknown as Consulta<FilaClase>),
    // Plazas ocupadas de cada clase (0018): un alumno solo ve sus reservas, pero sí cuántas plazas hay ocupadas.
    leerPaginado<FilaOcupacionClase>('ocupacion_clases', (d, h) => sb.from('ocupacion_clases').select('*', { count: 'exact' }).gte('fecha', desde).lte('fecha', hasta).order('clase_id').range(d, h) as unknown as Consulta<FilaOcupacionClase>),
    leerPaginado<FilaContrato>('contratos', de('contratos')),
    leerPaginado<FilaContratoFranja>('contrato_franjas', de('contrato_franjas', 'contrato_id', 'plantilla_id')),
    // Cobros (0013). RLS: el personal con CLIENTES_VER (en su ámbito) y cada cliente los suyos.
    leerPaginado<FilaPago>('pagos', (d, h) => sb.from('pagos').select('*', { count: 'exact' }).order('vence_el', { ascending: true, nullsFirst: false }).order('creado_el').order('id').range(d, h) as unknown as Consulta<FilaPago>),
    // Las reservas no tienen fecha propia: se filtran por la de su clase (relación embebida clases!inner).
    leerPaginado<FilaReserva>('reservas', (d, h) => sb.from('reservas').select('*, clases!inner(fecha)', { count: 'exact' }).gte('clases.fecha', desde).lte('clases.fecha', hasta).order('id').range(d, h) as unknown as Consulta<FilaReserva>),
    leerPaginado<FilaRecuperacion>('recuperaciones', de('recuperaciones')),
    leerPaginado<FilaAviso>('avisos', (d, h) => sb.from('avisos').select('*', { count: 'exact' }).order('publicado_el', { ascending: false }).order('id').range(d, h) as unknown as Consulta<FilaAviso>, 1),
    leerPaginado<FilaAvisoDestinatario>('aviso_destinatarios', de('aviso_destinatarios', 'aviso_id', 'cliente_id')),
    leerPaginado<FilaAvisoLectura>('aviso_lecturas', de('aviso_lecturas', 'aviso_id', 'cliente_id')),
    leerPaginado<FilaAuditoria>('auditoria', (d, h) => sb.from('auditoria').select('*', { count: 'exact' }).order('instante', { ascending: false }).order('id').range(d, h) as unknown as Consulta<FilaAuditoria>, 2),
    // Carrusel de la portada (0008). Si la migración no está aplicada, la tabla no existe y queda vacío (aviso en consola).
    leerPaginado<FilaPortadaImagen>('portada_imagenes', de('portada_imagenes', 'orden', 'id'), 1),
    // Cliente del mes (0016). RLS: el personal todos; cada alumno los suyos y los que el ganador hizo públicos.
    leerPaginado<FilaPremioMes>('premios_mes', (d, h) => sb.from('premios_mes').select('*', { count: 'exact' }).order('mes', { ascending: false }).range(d, h) as unknown as Consulta<FilaPremioMes>, 1),
  ]);

  const clinicaPorCliente = new Map(clinicas.map((c) => [c.cliente_id, c]));
  const listaClientes = clientes.map((c) => aCliente(c, clinicaPorCliente.get(c.id)));
  // Un trabajador ve la tabla `trabajadores`; un cliente solo la vista `monitores`.
  const listaTrabajadores = trabajadores.length > 0 ? trabajadores.map((t) => aTrabajador(t, permisos)) : monitores.map(aTrabajadorDesdeMonitor);
  const ocupadasPorClase = new Map(ocupacion.map((o) => [o.clase_id, o.ocupadas]));

  return {
    version: DB_VERSION,
    config: aConfig((configRes.data as FilaConfigCentro | null) ?? null, cierres),
    actividades: actividades.map(aActividad),
    tarifas: tarifas.map((t) => aTarifa(t, cupos)),
    clientes: listaClientes,
    contratos: contratos.map((c) => aContrato(c, franjas)),
    pagos: pagos.map(aPago),
    plantillas: plantillas.map(aPlantilla),
    clases: clases.map((c) => aClase(c, ocupadasPorClase.get(c.id))),
    reservas: reservas.map(aReserva),
    recuperaciones: recuperaciones.map(aRecuperacion),
    avisos: avisos.map((a) => aAviso(a, destinatarios)),
    lecturas: lecturas.map(aLectura),
    trabajadores: listaTrabajadores,
    usuarios: derivarUsuarios(listaClientes, listaTrabajadores),
    auditoria: auditoria.map(aAuditoria),
    portada: portada.map(aPortadaImagen),
    premios: premios.map(aPremioMes),
  };
}
