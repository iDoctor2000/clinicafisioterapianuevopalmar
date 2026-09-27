import { describe, expect, it } from 'vitest';
import type { Actividad, Cliente, ConfigCentro, PlantillaClase, Tarifa, Trabajador } from '@/domain/types';
import {
  aActividad, aAuditoria, aAviso, aClase, aCliente, aConfig, aContrato, aDestino, aHora, aInstante, aLectura, aPlantilla, aRecuperacion, aReserva,
  aTarifa, aTrabajador, aTrabajadorDesdeMonitor, deActividad, deClaseNueva, deCliente, deClinica, deConfig, deDestino, deDiasCierre, deHora,
  dePlantilla, deTarifa, deTrabajador, derivarUsuarios,
  type FilaActividad, type FilaAuditoria, type FilaAviso, type FilaClase, type FilaCliente, type FilaClienteClinica, type FilaConfigCentro,
  type FilaContrato, type FilaPlantillaClase, type FilaRecuperacion, type FilaReserva, type FilaTarifa, type FilaTrabajador,
} from '../mapeo';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const AUTH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('valores escalares', () => {
  it('convierte time y timestamptz de Postgres', () => {
    expect(aHora('09:00:00')).toBe('09:00');
    expect(deHora('09:00')).toBe('09:00:00');
    expect(deHora(aHora('18:30:00'))).toBe('18:30:00');
    expect(aInstante('2026-09-26 10:00:00.123456+00')).toBe('2026-09-26T10:00:00.123Z');
    expect(aInstante('2026-09-26T12:00:00+02:00')).toBe('2026-09-26T10:00:00.000Z');
  });
});

describe('config_centro', () => {
  const fila: FilaConfigCentro = {
    id: true, nombre: 'Centro', minutos_antelacion_cancelacion: 90, dias_ventana_reserva: 10, recuperacion_caduca_con_contrato: false,
    dias_caducidad_recuperacion: 45, dias_generacion_clases: 70, zona_horaria: 'Europe/Madrid',
  };
  it('ida y vuelta', () => {
    const c = aConfig(fila, [{ fecha: '2026-12-25', motivo: 'Navidad' }, { fecha: '2026-01-01', motivo: 'Año nuevo' }]);
    expect(c).toEqual<ConfigCentro>({
      nombre: 'Centro', minutosAntelacionCancelacion: 90, diasVentanaReserva: 10, recuperacionCaducaConContrato: false, diasCaducidadRecuperacion: 45,
      zonaHoraria: 'Europe/Madrid', diasCierre: [{ fecha: '2026-01-01', motivo: 'Año nuevo' }, { fecha: '2026-12-25', motivo: 'Navidad' }],
    });
    const { id: _id, dias_generacion_clases: _d, ...esperado } = fila;
    expect(deConfig(c)).toEqual(esperado);
    expect(deDiasCierre(c.diasCierre)).toEqual([{ fecha: '2026-01-01', motivo: 'Año nuevo' }, { fecha: '2026-12-25', motivo: 'Navidad' }]);
  });
  it('solo incluye las columnas presentes en el parcial', () => {
    expect(deConfig({ diasVentanaReserva: 7 })).toEqual({ dias_ventana_reserva: 7 });
    expect(deConfig({ diasCierre: [] })).toEqual({});
  });
  it('usa valores por defecto sin fila', () => {
    expect(aConfig(null, []).minutosAntelacionCancelacion).toBe(60);
  });
});

describe('actividades y tarifas', () => {
  it('actividad ida y vuelta (orden solo existe en SQL)', () => {
    const fila: FilaActividad = { id: U1, nombre: 'Reformer', categoria: 'REFORMER', descripcion: 'Máquina', color: '#3B82C4', activa: true, orden: 2 };
    const a = aActividad(fila);
    expect(a).toEqual<Actividad>({ id: U1, nombre: 'Reformer', categoria: 'REFORMER', descripcion: 'Máquina', color: '#3B82C4', activa: true });
    expect(deActividad(a)).toEqual({ id: U1, nombre: 'Reformer', categoria: 'REFORMER', descripcion: 'Máquina', color: '#3B82C4', activa: true });
  });
  it('tarifa recurrente con cupos', () => {
    const fila: FilaTarifa = {
      id: U1, nombre: 'Mixta', descripcion: '', tipo: 'RECURRENTE', bono_sesiones: null, bono_categoria: null, bono_validez_meses: null,
      recuperacion_permitida: true, recuperacion_categorias_extra: ['DIRIGIDA'], recuperacion_max_pendientes: 3, precio_centimos: 4500, activa: true, orden: 5,
    };
    const t = aTarifa(fila, [{ tarifa_id: U1, categoria: 'REFORMER', sesiones_semana: 1 }, { tarifa_id: U1, categoria: 'DIRIGIDA', sesiones_semana: 1 }, { tarifa_id: U2, categoria: 'DIRIGIDA', sesiones_semana: 3 }]);
    expect(t).toEqual<Tarifa>({
      id: U1, nombre: 'Mixta', descripcion: '', tipo: 'RECURRENTE', cupos: [{ categoria: 'REFORMER', sesionesSemana: 1 }, { categoria: 'DIRIGIDA', sesionesSemana: 1 }], bono: null,
      recuperacion: { permitida: true, categoriasExtra: ['DIRIGIDA'], maxPendientes: 3 }, precioCentimos: 4500, activa: true, orden: 5,
    });
    const { tarifa, cupos } = deTarifa(t);
    expect(tarifa).toEqual(fila);
    expect(cupos).toEqual([{ tarifa_id: U1, categoria: 'REFORMER', sesiones_semana: 1 }, { tarifa_id: U1, categoria: 'DIRIGIDA', sesiones_semana: 1 }]);
  });
  it('bono', () => {
    const fila: FilaTarifa = {
      id: U2, nombre: 'Bono 10', descripcion: '', tipo: 'BONO', bono_sesiones: 10, bono_categoria: 'DIRIGIDA', bono_validez_meses: 6,
      recuperacion_permitida: false, recuperacion_categorias_extra: [], recuperacion_max_pendientes: null, precio_centimos: null, activa: false, orden: 1,
    };
    const t = aTarifa(fila, []);
    expect(t.bono).toEqual({ sesiones: 10, categoria: 'DIRIGIDA', validezMeses: 6 });
    expect(t.cupos).toEqual([]);
    expect(deTarifa(t).tarifa).toEqual(fila);
    expect(deTarifa(t).cupos).toEqual([]);
  });
});

describe('trabajadores', () => {
  const fila: FilaTrabajador = { id: U1, nombre: 'Ana', apellidos: 'Martínez', email: 'ana@x.com', telefono: '600', rol: 'MONITOR', ambito: 'SUS_CLASES', es_monitor: true, color: '#fff', activo: true, user_id: AUTH };
  it('ida y vuelta con permisos (sin user_id al escribir)', () => {
    const t = aTrabajador(fila, [{ trabajador_id: U1, permiso: 'CLIENTES_VER' }, { trabajador_id: U2, permiso: 'AVISOS_ENVIAR' }, { trabajador_id: U1, permiso: 'ASISTENCIA_REGISTRAR' }]);
    expect(t).toEqual<Trabajador>({ id: U1, nombre: 'Ana', apellidos: 'Martínez', email: 'ana@x.com', telefono: '600', rol: 'MONITOR', permisos: ['CLIENTES_VER', 'ASISTENCIA_REGISTRAR'], ambito: 'SUS_CLASES', esMonitor: true, color: '#fff', activo: true, userId: AUTH });
    const { trabajador, permisos } = deTrabajador(t);
    const { user_id: _u, ...sinUser } = fila;
    expect(trabajador).toEqual(sinUser);
    expect(permisos).toEqual([{ trabajador_id: U1, permiso: 'CLIENTES_VER' }, { trabajador_id: U1, permiso: 'ASISTENCIA_REGISTRAR' }]);
  });
  it('vista monitores (lo que ve un cliente)', () => {
    const t = aTrabajadorDesdeMonitor({ id: U1, nombre: 'Ana', apellidos: 'M', color: '#fff', es_monitor: true, activo: true });
    expect(t).toMatchObject({ email: '', telefono: '', rol: 'MONITOR', permisos: [], userId: null, esMonitor: true, ambito: 'CENTRO' });
  });
  it('sin columna ambito (antes de 0005) se asume CENTRO; un ADMIN siempre es CENTRO', () => {
    const { ambito: _a, ...sinAmbito } = fila;
    expect(aTrabajador(sinAmbito, []).ambito).toBe('CENTRO');
    expect(aTrabajador({ ...fila, rol: 'ADMIN' }, []).ambito).toBe('CENTRO');
    expect(deTrabajador({ ...aTrabajador(fila, []), rol: 'ADMIN' }).trabajador.ambito).toBe('CENTRO');
  });
});

describe('clientes', () => {
  const fila: FilaCliente = { id: U1, nombre: 'María', apellidos: 'García', dni: '1A', direccion: 'C/ Sol', email: 'm@x.com', telefono: '600', notificaciones_push: true, activo: true, user_id: AUTH, alta_el: '2026-01-15', baja_el: null };
  const clinica: FilaClienteClinica = { cliente_id: U1, lesiones: 'Rodilla', patologias: '', observaciones: 'Ok', actualizada_por: AUTH, actualizado_el: '2026-02-01T10:00:00+00:00' };
  it('con información clínica', () => {
    const c = aCliente(fila, clinica);
    expect(c).toEqual<Cliente>({
      id: U1, nombre: 'María', apellidos: 'García', dni: '1A', direccion: 'C/ Sol', email: 'm@x.com', telefono: '600',
      clinica: { lesiones: 'Rodilla', patologias: '', observaciones: 'Ok', actualizadaEl: '2026-02-01T10:00:00.000Z' },
      notificacionesPush: true, activo: true, userId: AUTH, altaEl: '2026-01-15', bajaEl: null, fotoUrl: null, consentimientoEl: null, consentimientoVersion: null,
    });
    const { user_id: _u, ...sinUser } = fila;
    expect(deCliente(c)).toEqual(sinUser);
    expect(deClinica(c.id, c.clinica, AUTH)).toEqual({ cliente_id: U1, lesiones: 'Rodilla', patologias: '', observaciones: 'Ok', actualizada_por: AUTH });
  });
  it('sin fila clínica (RLS): campos vacíos y actualizadaEl null', () => {
    expect(aCliente(fila, undefined).clinica).toEqual({ lesiones: '', patologias: '', observaciones: '', actualizadaEl: null });
  });
  it('foto_url (0006): se lee tal cual (ruta + ?v=) y no se escribe desde deCliente (la gestiona actualizarFotoCliente)', () => {
    const ruta = `${U1}/avatar.jpg?v=1727000000000`;
    expect(aCliente({ ...fila, foto_url: ruta }, undefined).fotoUrl).toBe(ruta);
    expect(aCliente({ ...fila, foto_url: null }, undefined).fotoUrl).toBeNull();
    expect(aCliente(fila, undefined).fotoUrl).toBeNull(); // columna ausente (antes de 0006)
    expect(deCliente(aCliente({ ...fila, foto_url: ruta }, undefined))).not.toHaveProperty('foto_url');
  });
});

describe('horario y clases', () => {
  it('plantilla ida y vuelta', () => {
    const fila: FilaPlantillaClase = { id: U1, actividad_id: U2, dia_semana: 3, hora_inicio: '18:00:00', duracion_min: 55, monitor_id: U3, plazas: 8, activa: true, vigencia_desde: '2026-09-01', vigencia_hasta: null };
    const p = aPlantilla(fila);
    expect(p).toEqual<PlantillaClase>({ id: U1, actividadId: U2, diaSemana: 3, horaInicio: '18:00', duracionMin: 55, monitorId: U3, plazas: 8, activa: true, vigenciaDesde: '2026-09-01', vigenciaHasta: null });
    expect(dePlantilla(p)).toEqual(fila);
  });
  it('clase y clase extraordinaria nueva', () => {
    const fila: FilaClase = {
      id: U1, plantilla_id: U2, actividad_id: U3, fecha: '2026-09-28', hora_inicio: '10:00:00', duracion_min: 55, monitor_id: null, plazas: 4, estado: 'CANCELADA',
      extraordinaria: false, clase_alternativa_id: null, motivo_cancelacion: 'Avería', cancelado_el: '2026-09-26T08:00:00+00:00', cancelado_por: AUTH,
    };
    const c = aClase(fila);
    expect(c).toMatchObject({ plantillaId: U2, fecha: '2026-09-28', horaInicio: '10:00', monitorId: '', estado: 'CANCELADA', motivoCancelacion: 'Avería', canceladaEl: '2026-09-26T08:00:00.000Z', canceladaPor: AUTH });
    expect(deClaseNueva({ id: U1, actividadId: U3, fecha: '2026-09-28', horaInicio: '10:00', duracionMin: 55, monitorId: U2, plazas: 4 })).toEqual({
      id: U1, plantilla_id: null, actividad_id: U3, fecha: '2026-09-28', hora_inicio: '10:00:00', duracion_min: 55, monitor_id: U2, plazas: 4, estado: 'PROGRAMADA', extraordinaria: true,
    });
  });
});

describe('contratos, reservas y recuperaciones', () => {
  it('contrato con franjas; creado_por null → sistema', () => {
    const fila: FilaContrato = {
      id: U1, cliente_id: U2, tarifa_id: U3, fecha_inicio: '2026-09-01', fecha_fin: '2026-11-30', modalidad: 'FIJO', sesiones_restantes: null, estado: 'ACTIVO',
      actividades_permitidas_ids: [], notas: 'n', creado_por: null, creado_el: '2026-08-30T10:00:00+00:00',
    };
    const c = aContrato(fila, [{ contrato_id: U1, plantilla_id: U3 }, { contrato_id: U2, plantilla_id: U1 }]);
    expect(c).toMatchObject({ clienteId: U2, franjasFijas: [{ plantillaId: U3 }], creadoPor: 'sistema', creadoEl: '2026-08-30T10:00:00.000Z', actividadesPermitidasIds: [] });
  });
  it('reserva', () => {
    const fila: FilaReserva = {
      id: U1, clase_id: U2, cliente_id: U3, contrato_id: null, origen: 'CLIENTE', estado: 'CANCELADA_RECUPERABLE', asistencia: 'PENDIENTE', recuperacion_usada_id: null,
      creado_por: AUTH, creado_el: '2026-09-20T10:00:00+00:00', cancelado_el: '2026-09-21T10:00:00+00:00', cancelado_por: AUTH,
    };
    expect(aReserva(fila)).toEqual({
      id: U1, claseId: U2, clienteId: U3, contratoId: null, origen: 'CLIENTE', estado: 'CANCELADA_RECUPERABLE', asistencia: 'PENDIENTE', recuperacionUsadaId: null,
      creadaEl: '2026-09-20T10:00:00.000Z', creadaPor: AUTH, canceladaEl: '2026-09-21T10:00:00.000Z', canceladaPor: AUTH,
    });
  });
  it('recuperación', () => {
    const fila: FilaRecuperacion = {
      id: U1, cliente_id: U2, contrato_id: U3, reserva_origen_id: null, categoria_origen: 'REFORMER', categorias_permitidas: ['REFORMER', 'DIRIGIDA'], motivo: 'AUTORIZACION_MANUAL',
      estado: 'DISPONIBLE', caduca_el: '2026-12-31', usada_en_reserva_id: null, nota: 'x', creado_por: AUTH, creado_el: '2026-09-20T10:00:00+00:00',
    };
    expect(aRecuperacion(fila)).toEqual({
      id: U1, clienteId: U2, contratoId: U3, reservaOrigenId: null, categoriaOrigen: 'REFORMER', categoriasPermitidas: ['REFORMER', 'DIRIGIDA'], motivo: 'AUTORIZACION_MANUAL',
      estado: 'DISPONIBLE', caducaEl: '2026-12-31', usadaEnReservaId: null, creadaEl: '2026-09-20T10:00:00.000Z', creadaPor: AUTH, nota: 'x',
    });
  });
});

describe('avisos', () => {
  const base: FilaAviso = { id: U1, titulo: 'T', cuerpo: 'C', destino_tipo: 'TODOS', destino_clase_id: null, destino_actividad_id: null, importante: true, publicado_el: '2026-09-20T10:00:00+00:00', publicado_por: AUTH };
  it('reconstruye el destino y los destinatarios', () => {
    const a = aAviso({ ...base, destino_tipo: 'CLASE', destino_clase_id: U2 }, [{ aviso_id: U1, cliente_id: U3 }, { aviso_id: U2, cliente_id: U1 }]);
    expect(a.destino).toEqual({ tipo: 'CLASE', claseId: U2 });
    expect(a.destinatariosIds).toEqual([U3]);
    expect(a.publicadoEl).toBe('2026-09-20T10:00:00.000Z');
    expect(aDestino({ destino_tipo: 'ACTIVIDAD', destino_clase_id: null, destino_actividad_id: U2 }, [])).toEqual({ tipo: 'ACTIVIDAD', actividadId: U2 });
    expect(aDestino({ destino_tipo: 'CLIENTES', destino_clase_id: null, destino_actividad_id: null }, [U1, U2])).toEqual({ tipo: 'CLIENTES', clienteIds: [U1, U2] });
    expect(aDestino({ destino_tipo: 'TODOS', destino_clase_id: null, destino_actividad_id: null }, [U1])).toEqual({ tipo: 'TODOS' });
  });
  it('parámetros de publicar_aviso', () => {
    expect(deDestino({ tipo: 'TODOS' })).toEqual({ p_destino_tipo: 'TODOS', p_destino_id: null, p_cliente_ids: null });
    expect(deDestino({ tipo: 'CLASE', claseId: U1 })).toEqual({ p_destino_tipo: 'CLASE', p_destino_id: U1, p_cliente_ids: null });
    expect(deDestino({ tipo: 'ACTIVIDAD', actividadId: U1 })).toEqual({ p_destino_tipo: 'ACTIVIDAD', p_destino_id: U1, p_cliente_ids: null });
    expect(deDestino({ tipo: 'CLIENTES', clienteIds: [U1] })).toEqual({ p_destino_tipo: 'CLIENTES', p_destino_id: null, p_cliente_ids: [U1] });
  });
  it('lecturas', () => {
    expect(aLectura({ aviso_id: U1, cliente_id: U2, leido_el: '2026-09-20T10:00:00+00:00' })).toEqual({ avisoId: U1, clienteId: U2, leidoEl: '2026-09-20T10:00:00.000Z' });
  });
});

describe('auditoría y usuarios', () => {
  it('auditoría', () => {
    const fila: FilaAuditoria = { id: U1, instante: '2026-09-20T10:00:00+00:00', actor_id: null, actor_nombre: 'Sistema', accion: 'MANTENIMIENTO', entidad: 'sistema', entidad_id: '-', detalle: '{}' };
    expect(aAuditoria(fila)).toEqual({ id: U1, instante: '2026-09-20T10:00:00.000Z', actorId: 'sistema', actorNombre: 'Sistema', accion: 'MANTENIMIENTO', entidad: 'sistema', entidadId: '-', detalle: '{}' });
  });
  it('usuarios derivados de clientes y trabajadores con cuenta', () => {
    const cli = aCliente({ id: U1, nombre: 'M', apellidos: 'G', dni: '', direccion: '', email: 'm@x', telefono: '', notificaciones_push: true, activo: true, user_id: AUTH, alta_el: '2026-01-01', baja_el: null }, null);
    const sinCuenta = { ...cli, id: U2, userId: null };
    const tra = aTrabajador({ id: U3, nombre: 'A', apellidos: '', email: 'a@x', telefono: '', rol: 'ADMIN', es_monitor: false, color: '', activo: true, user_id: U2 }, []);
    expect(derivarUsuarios([cli, sinCuenta], [tra])).toEqual([
      { id: U2, email: 'a@x', tipo: 'TRABAJADOR', clienteId: null, trabajadorId: U3 },
      { id: AUTH, email: 'm@x', tipo: 'CLIENTE', clienteId: U1, trabajadorId: null },
    ]);
  });
});
