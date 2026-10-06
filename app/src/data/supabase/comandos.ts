/**
 * Ejecución de los comandos de `data/comandos.ts` contra Supabase.
 *
 * Los comandos con reglas de negocio llaman a las RPC de 0003_funciones.sql
 * (que validan permisos y lanzan mensajes en español). Los CRUD simples usan
 * insert/update/upsert directos, protegidos por RLS (0002_seguridad.sql).
 *
 * Los ids nuevos se generan aquí (uuid) para no depender de un `select` tras
 * la escritura, que RLS podría no permitir. El valor devuelto se resuelve
 * sobre el `Db` recargado después del comando (función `valor(db)`).
 */
import type { Clase, Cliente, Id, Recuperacion, Reserva, Sesion } from '@/domain/types';
import { tienePermiso } from '@/domain/types';
import { aISODate, sumarDias } from '@/domain/fechas';
import { CONSENTIMIENTO_PAPEL, VERSION_POLITICA_PRIVACIDAD } from '@/domain/privacidad';
import type { Db } from '../db';
import type { ArgsComando, NombreComando, ValorComando } from '../tiposComandos';
import { mensajeError, servidor } from './cliente';
import { borrarFoto } from './fotos';
import { CLINICA_VACIA, deActividad, deCliente, deClinica, deConfig, deDestino, deDiasCierre, dePago, dePlantilla, dePortadaImagen, deTarifa, deTrabajador, deClaseNueva } from './mapeo';
import { borrarImagenPortada } from './portada';

export type ResultadoRemoto<T = unknown> = { ok: true; valor: (db: Db) => T } | { ok: false; error: string };

type Impl = { [K in NombreComando]: (args: ArgsComando<K>, sesion: Sesion) => Promise<(db: Db) => ValorComando<K>> };

/** Días de horizonte al regenerar clases tras cambiar el horario (igual que el demo). */
const DIAS_HORIZONTE = 70;

const nuevoUuid = (): Id => crypto.randomUUID();

/** Lanza si la respuesta de PostgREST trae error. */
function comprobar<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data;
}

async function rpc<T = unknown>(nombre: string, params: Record<string, unknown>): Promise<T> {
  return comprobar(await servidor().rpc(nombre, params)) as T;
}

/** Crea las clases que falten hasta el horizonte (el demo lo hace en cada cambio de horario). */
async function regenerarClases(): Promise<void> {
  const hoy = aISODate(new Date());
  await rpc('generar_clases', { p_desde: hoy, p_hasta: sumarDias(hoy, DIAS_HORIZONTE) });
}

const impl: Impl = {
  // -------------------------------------------------------------------------
  // Reservas
  // -------------------------------------------------------------------------
  async reservar(args, sesion) {
    const r = await rpc<{ reserva_id: string; via: string; mensaje: string | null }>('reservar', {
      p_clase_id: args.claseId, p_cliente_id: sesion.tipo === 'CLIENTE' ? null : args.clienteId ?? null,
    });
    const clienteId = sesion.tipo === 'CLIENTE' ? sesion.clienteId : args.clienteId ?? '';
    return (db) => db.reservas.find((x) => x.id === r.reserva_id) ?? reservaProvisional(r.reserva_id, args.claseId, clienteId, sesion);
  },

  async cancelarReserva(args) {
    const r = await rpc<{ recuperable: boolean }>('cancelar_reserva', { p_reserva_id: args.reservaId, p_forzar_recuperable: args.forzarRecuperable === true });
    return () => ({ recuperable: r.recuperable === true });
  },

  async anadirAlumno(args, sesion) {
    const r = await rpc<{ reserva_id: string }>('anadir_alumno', { p_clase_id: args.claseId, p_cliente_id: args.clienteId, p_modo: args.modo });
    return (db) => db.reservas.find((x) => x.id === r.reserva_id) ?? reservaProvisional(r.reserva_id, args.claseId, args.clienteId, sesion);
  },

  async quitarAlumno(args) {
    await rpc('cancelar_reserva', { p_reserva_id: args.reservaId, p_forzar_recuperable: true });
    return () => undefined;
  },

  async registrarAsistencia(args) {
    await rpc('registrar_asistencia', { p_reserva_id: args.reservaId, p_asistencia: args.asistencia });
    return () => undefined;
  },

  async autorizarRecuperacion(args, sesion) {
    const id = await rpc<string>('autorizar_recuperacion', {
      p_cliente_id: args.clienteId, p_categoria_origen: args.categoriaOrigen, p_categorias_permitidas: args.categoriasPermitidas,
      p_caduca_el: args.caducaEl, p_nota: args.nota,
    });
    const provisional: Recuperacion = {
      id, clienteId: args.clienteId, contratoId: null, reservaOrigenId: null, categoriaOrigen: args.categoriaOrigen,
      categoriasPermitidas: Array.from(new Set([args.categoriaOrigen, ...args.categoriasPermitidas])), motivo: 'AUTORIZACION_MANUAL', estado: 'DISPONIBLE',
      caducaEl: args.caducaEl, usadaEnReservaId: null, creadaEl: new Date().toISOString(), creadaPor: sesion.userId, nota: args.nota,
    };
    return (db) => db.recuperaciones.find((x) => x.id === id) ?? provisional;
  },

  // -------------------------------------------------------------------------
  // Clases y horarios
  // -------------------------------------------------------------------------
  async cancelarClase(args) {
    const afectados = await rpc<number>('cancelar_clase', {
      p_clase_id: args.claseId, p_motivo: args.motivo, p_clase_alternativa_id: args.claseAlternativaId, p_avisar: args.avisar,
    });
    return () => ({ afectados: Number(afectados) || 0 });
  },

  async crearClaseExtraordinaria(args) {
    const id = nuevoUuid();
    comprobar(await servidor().from('clases').insert(deClaseNueva({ id, ...args })));
    const provisional: Clase = {
      id, plantillaId: null, actividadId: args.actividadId, fecha: args.fecha, horaInicio: args.horaInicio, duracionMin: args.duracionMin, monitorId: args.monitorId,
      plazas: args.plazas, estado: 'PROGRAMADA', extraordinaria: true, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null,
    };
    return (db) => db.clases.find((x) => x.id === id) ?? provisional;
  },

  async guardarPlantilla(args) {
    const existe = !!args.plantilla.id;
    const p = { ...args.plantilla, id: args.plantilla.id ?? nuevoUuid() };
    comprobar(await servidor().from('plantillas_clase').upsert(dePlantilla(p)));
    // Al editar, el servidor recrea las clases futuras de la franja (0011_horario_cambios.sql).
    const conservadas = existe ? await rpc<number>('plantilla_aplicar_cambios', { p_plantilla_id: p.id }) : 0;
    await regenerarClases();
    return (db) => ({ plantilla: db.plantillas.find((x) => x.id === p.id) ?? p, conservadas: conservadas ?? 0 });
  },

  // -------------------------------------------------------------------------
  // Clientes y contratos
  // -------------------------------------------------------------------------
  async guardarCliente(args, sesion) {
    const sb = servidor();
    const esNuevo = !args.cliente.id;
    const cliente: Cliente = { ...args.cliente, id: args.cliente.id ?? nuevoUuid() };
    const fila = deCliente(cliente);
    if (esNuevo) comprobar(await sb.from('clientes').insert(fila));
    else comprobar(await sb.from('clientes').update(fila).eq('id', cliente.id));
    // La parte clínica va en su tabla y solo puede escribirla quien tiene CLINICA_VER.
    if (tienePermiso(sesion, 'CLINICA_VER')) {
      comprobar(await sb.from('clientes_clinica').upsert(deClinica(cliente.id, cliente.clinica, sesion.userId), { onConflict: 'cliente_id' }));
    }
    return (db) => db.clientes.find((x) => x.id === cliente.id) ?? { ...cliente, clinica: tienePermiso(sesion, 'CLINICA_VER') ? cliente.clinica : { ...CLINICA_VACIA } };
  },

  async crearContrato(args) {
    const c = args.contrato;
    const id = await rpc<string>('crear_contrato', {
      p_cliente_id: c.clienteId, p_tarifa_id: c.tarifaId, p_fecha_inicio: c.fechaInicio, p_fecha_fin: c.fechaFin, p_modalidad: c.modalidad,
      p_franjas: c.modalidad === 'FIJO' ? c.franjasFijas.map((f) => f.plantillaId) : [], p_actividades_permitidas: c.actividadesPermitidasIds,
      p_notas: c.notas, p_sesiones_restantes: c.sesionesRestantes,
      p_oferta: c.oferta ?? 'NINGUNA', p_importe_centimos: c.importeCentimos ?? null, p_metodo_pago: c.metodoPago ?? null,
      p_cobros: (args.cobros ?? []).map((q) => ({
        concepto: q.concepto, importe_centimos: q.importeCentimos, vence_el: q.venceEl, estado: q.estado, metodo: q.metodo,
        pagado_el: q.estado === 'PAGADO' ? q.pagadoEl ?? new Date().toISOString() : null,
      })),
    });
    return (db) => db.contratos.find((x) => x.id === id) ?? { ...c, id, estado: 'ACTIVO', creadoEl: new Date().toISOString(), creadoPor: 'sistema' };
  },

  async editarContrato(args) {
    const k = args.cambios;
    await rpc('editar_contrato', {
      p_contrato_id: args.contratoId, p_fecha_fin: k.fechaFin, p_franjas: k.franjasFijas.map((f) => f.plantillaId), p_notas: k.notas,
      p_oferta: k.oferta, p_importe_centimos: k.importeCentimos, p_metodo_pago: k.metodoPago, p_sesiones_restantes: k.sesionesRestantes,
    });
    return (db) => db.contratos.find((x) => x.id === args.contratoId)!;
  },

  async guardarPago(args) {
    const id = args.pago.id ?? nuevoUuid();
    const fila = dePago({ ...args.pago, id, concepto: args.pago.concepto.trim() });
    const r = await servidor().from('pagos').upsert(fila).select('id');
    comprobar(r);
    if (!r.data || r.data.length === 0) throw new Error('No se ha podido guardar el cobro: no tienes permiso para este cliente.');
    return (db) => db.pagos.find((x) => x.id === id) ?? { ...args.pago, id, creadoEl: new Date().toISOString() };
  },

  async borrarPago(args) {
    const r = await servidor().from('pagos').delete().eq('id', args.id).select('id');
    comprobar(r);
    if (!r.data || r.data.length === 0) throw new Error('No se ha podido borrar el cobro: no tienes permiso para este cliente.');
    return () => undefined;
  },

  async finalizarContrato(args) {
    await rpc('finalizar_contrato', { p_contrato_id: args.contratoId, p_cancelar_reservas_futuras: args.cancelarReservasFuturas });
    return () => undefined;
  },

  // -------------------------------------------------------------------------
  // Avisos y perfil del cliente
  // -------------------------------------------------------------------------
  async publicarAviso(args, sesion) {
    const id = await rpc<string>('publicar_aviso', { p_titulo: args.titulo, p_cuerpo: args.cuerpo, ...deDestino(args.destino), p_importante: args.importante });
    return (db) => db.avisos.find((x) => x.id === id) ?? { id, ...args, destinatariosIds: [], publicadoEl: new Date().toISOString(), publicadoPor: sesion.userId };
  },

  async marcarAvisoLeido(args, sesion) {
    if (sesion.tipo !== 'CLIENTE') return () => undefined;
    const r = await servidor().from('aviso_lecturas').upsert({ aviso_id: args.avisoId, cliente_id: sesion.clienteId }, { onConflict: 'aviso_id,cliente_id', ignoreDuplicates: true });
    // Ya leído (clave duplicada): no es un error para el usuario.
    if (r.error && !/duplicate|23505/i.test(r.error.message)) throw r.error;
    return () => undefined;
  },

  async actualizarPreferenciasCliente(args, sesion) {
    if (sesion.tipo !== 'CLIENTE') throw new Error('Solo para clientes.');
    const cambios: Record<string, unknown> = {};
    if (args.notificacionesPush !== undefined) cambios.notificaciones_push = args.notificacionesPush;
    if (args.telefono !== undefined) cambios.telefono = args.telefono;
    if (args.email !== undefined) cambios.email = args.email;
    if (args.direccion !== undefined) cambios.direccion = args.direccion;
    if (Object.keys(cambios).length > 0) comprobar(await servidor().from('clientes').update(cambios).eq('id', sesion.clienteId));
    return () => undefined;
  },

  /**
   * La imagen ya está subida al bucket (features/comun/SelectorFoto.tsx → fotos.ts); aquí solo
   * se anota la ruta en la ficha. RLS: el cliente su fila (trigger de autoedición permite foto_url),
   * el personal con CLIENTES_EDITAR y dentro de su ámbito. Al quitar, se borra también el objeto.
   */
  async actualizarFotoCliente(args, sesion) {
    const clienteId = sesion.tipo === 'CLIENTE' ? sesion.clienteId : args.clienteId;
    if (!clienteId) throw new Error('Falta el cliente.');
    const fotoUrl = args.fotoUrl && args.fotoUrl.trim() ? args.fotoUrl : null;
    if (!fotoUrl) await borrarFoto(clienteId);
    comprobar(await servidor().from('clientes').update({ foto_url: fotoUrl }).eq('id', clienteId));
    return () => undefined;
  },

  /**
   * Consentimiento de privacidad (0007). El cliente actualiza su propia fila (el trigger de
   * autoedición permite consentimiento_el/consentimiento_version); el personal, con CLIENTES_EDITAR
   * y dentro de su ámbito (RLS `clientes_editar`). Un trigger lo anota en `auditoria`.
   */
  async registrarConsentimiento(_args, sesion) {
    if (sesion.tipo !== 'CLIENTE') throw new Error('Solo el propio cliente puede aceptar la política de privacidad.');
    comprobar(await servidor().from('clientes').update({ consentimiento_el: new Date().toISOString(), consentimiento_version: VERSION_POLITICA_PRIVACIDAD }).eq('id', sesion.clienteId));
    return () => undefined;
  },

  async registrarConsentimientoPapel(args) {
    if (!args.clienteId) throw new Error('Falta el cliente.');
    // RLS no lanza error si la fila queda fuera del permiso/ámbito: simplemente no actualiza nada.
    const filas = comprobar(
      await servidor().from('clientes').update({ consentimiento_el: new Date().toISOString(), consentimiento_version: CONSENTIMIENTO_PAPEL }).eq('id', args.clienteId).select('id'),
    );
    if (!filas || filas.length === 0) throw new Error('No se ha podido registrar el consentimiento: sin permiso sobre este cliente.');
    return () => undefined;
  },

  // -------------------------------------------------------------------------
  // Catálogo y configuración
  // -------------------------------------------------------------------------
  async guardarTarifa(args) {
    const sb = servidor();
    const t = { ...args.tarifa, id: args.tarifa.id ?? nuevoUuid() };
    const { tarifa, cupos } = deTarifa(t);
    comprobar(await sb.from('tarifas').upsert(tarifa));
    comprobar(await sb.from('tarifa_cupos').delete().eq('tarifa_id', t.id));
    if (cupos.length > 0) comprobar(await sb.from('tarifa_cupos').insert(cupos));
    return (db) => db.tarifas.find((x) => x.id === t.id) ?? t;
  },

  async guardarActividad(args) {
    const a = { ...args.actividad, id: args.actividad.id ?? nuevoUuid() };
    comprobar(await servidor().from('actividades').upsert(deActividad(a)));
    return (db) => db.actividades.find((x) => x.id === a.id) ?? a;
  },

  async guardarTrabajador(args) {
    const sb = servidor();
    const t = { ...args.trabajador, id: args.trabajador.id ?? nuevoUuid() };
    const { trabajador, permisos } = deTrabajador(t);
    comprobar(await sb.from('trabajadores').upsert(trabajador));
    comprobar(await sb.from('trabajador_permisos').delete().eq('trabajador_id', t.id));
    if (permisos.length > 0) comprobar(await sb.from('trabajador_permisos').insert(permisos));
    return (db) => db.trabajadores.find((x) => x.id === t.id) ?? t;
  },

  async actualizarConfig(args) {
    const sb = servidor();
    const fila = deConfig(args.config);
    // update y no upsert: la fila única ya existe y un INSERT ... ON CONFLICT exigiría las columnas NOT NULL (nombre).
    if (Object.keys(fila).length > 0) {
      const r = await sb.from('config_centro').update(fila).eq('id', true).select('id');
      comprobar(r);
      if (!r.data || r.data.length === 0) throw new Error('No se ha podido guardar la configuración: solo el administrador puede cambiarla.');
    }
    if (args.config.diasCierre) {
      // Se reemplaza la lista completa (la tabla tiene la fecha como clave).
      comprobar(await sb.from('dias_cierre').delete().not('fecha', 'is', null));
      const filas = deDiasCierre(args.config.diasCierre);
      if (filas.length > 0) comprobar(await sb.from('dias_cierre').insert(filas));
      // Cancelar las clases ya programadas en los nuevos cierres lo hace mantenimiento_diario (pg_cron);
      // generamos las clases que falten para que el calendario quede coherente ya.
      try {
        await regenerarClases();
      } catch (e) {
        console.warn('[supabase] No se han podido regenerar las clases tras cambiar los cierres:', mensajeError(e));
      }
    }
    return () => undefined;
  },

  // -------------------------------------------------------------------------
  // Portada del cliente (0008): tabla portada_imagenes + bucket público `portada`.
  // La subida del archivo la hace la pantalla (subirImagenPortada) antes de llamar al comando con la URL pública.
  // RLS: solo es_admin() escribe; si no afecta a ninguna fila, no hay permiso.
  // -------------------------------------------------------------------------
  async guardarPortadaImagen(args) {
    const sb = servidor();
    const id = args.imagen.id ?? nuevoUuid();
    let orden = args.imagen.orden;
    if (orden == null && !args.imagen.id) {
      const r = comprobar(await sb.from('portada_imagenes').select('orden').order('orden', { ascending: false }).limit(1));
      orden = ((r?.[0] as { orden: number } | undefined)?.orden ?? 0) + 1;
    }
    const fila = dePortadaImagen({ id, url: args.imagen.url.trim(), pie: (args.imagen.pie ?? '').trim(), orden: orden ?? 0, activa: args.imagen.activa ?? true, creadoEl: '' });
    if (args.imagen.orden == null && args.imagen.id) delete (fila as Partial<typeof fila>).orden;
    const r = await sb.from('portada_imagenes').upsert(fila).select('id');
    comprobar(r);
    if (!r.data || r.data.length === 0) throw new Error('No se ha podido guardar la foto: solo el administrador puede cambiar la portada.');
    return (db) => db.portada.find((x) => x.id === id) ?? { ...fila, pie: fila.pie, creadoEl: new Date().toISOString() };
  },

  async borrarPortadaImagen(args) {
    const sb = servidor();
    const r = await sb.from('portada_imagenes').delete().eq('id', args.id).select('id, url');
    comprobar(r);
    if (!r.data || r.data.length === 0) throw new Error('No se ha podido borrar la foto: solo el administrador puede cambiar la portada.');
    // El objeto del bucket se borra después (si falla, la fila ya no existe y no se muestra).
    try {
      await borrarImagenPortada((r.data[0] as { url: string }).url);
    } catch (e) {
      console.warn('[portada] No se ha podido borrar el archivo del bucket:', mensajeError(e));
    }
    return () => undefined;
  },

  async ordenarPortada(args) {
    const sb = servidor();
    for (let i = 0; i < args.ids.length; i++) {
      const r = await sb.from('portada_imagenes').update({ orden: i + 1 }).eq('id', args.ids[i]).select('id');
      comprobar(r);
      if (!r.data || r.data.length === 0) throw new Error('No se ha podido reordenar la portada: solo el administrador puede cambiarla.');
    }
    return () => undefined;
  },
};

function reservaProvisional(id: Id, claseId: Id, clienteId: Id, sesion: Sesion): Reserva {
  return {
    id, claseId, clienteId, contratoId: null, origen: sesion.tipo === 'CLIENTE' ? 'CLIENTE' : 'MANUAL', estado: 'RESERVADA', asistencia: 'PENDIENTE',
    recuperacionUsadaId: null, creadaEl: new Date().toISOString(), creadaPor: sesion.userId, canceladaEl: null, canceladaPor: null,
  };
}

/** Ejecuta un comando contra Supabase. Nunca lanza: devuelve `{ok:false, error}` con el mensaje de Postgres tal cual. */
export async function ejecutarRemoto<K extends NombreComando>(nombre: K, args: ArgsComando<K>, sesion: Sesion): Promise<ResultadoRemoto<ValorComando<K>>> {
  try {
    const fn = impl[nombre] as (a: ArgsComando<K>, s: Sesion) => Promise<(db: Db) => ValorComando<K>>;
    const valor = await fn(args, sesion);
    return { ok: true, valor };
  } catch (e) {
    return { ok: false, error: mensajeError(e) };
  }
}
