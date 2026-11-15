/** "El día de hoy": consultas de solo lectura para la pantalla de cada mañana del equipo. */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import { crearSeed } from '@/data/seed';
import type { Clase, Cliente, Contrato, EntradaListaEspera, Reserva } from '@/domain/types';
import { agruparPorAlumno, altasRecientes, cifrasDia, claseDestacada, clasesDeDia, clasesSinPasarLista, detallesDeClase, faltaPasarLista, fijosSinPlaza, saludo } from '../hoy';
import { vistaClase } from '@/data/selectores';

const HOY = '2026-11-16'; // lunes
const base = crearSeed();
const act = base.actividades[0];
const mon = base.trabajadores[0];

const clase = (id: string, fecha: string, hora: string, over: Partial<Clase> = {}): Clase => ({
  id, plantillaId: null, actividadId: act.id, fecha, horaInicio: hora, duracionMin: 55, monitorId: mon.id, plazas: 2, estado: 'PROGRAMADA',
  extraordinaria: false, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null, ...over,
});
const cliente = (id: string, over: Partial<Cliente> = {}): Cliente => ({ ...base.clientes[0], id, nombre: id, apellidos: 'Prueba Uno', activo: true, altaEl: '2026-01-10', fechaNacimiento: null, ...over });
const reserva = (id: string, claseId: string, clienteId: string, over: Partial<Reserva> = {}): Reserva => ({
  id, claseId, clienteId, contratoId: null, origen: 'CLIENTE', estado: 'RESERVADA', asistencia: 'PENDIENTE', recuperacionUsadaId: null,
  creadaEl: '2026-11-01T10:00:00.000Z', creadaPor: 'x', canceladaEl: null, canceladaPor: null, ...over,
});
const contrato = (id: string, clienteId: string, plantillaId: string, over: Partial<Contrato> = {}): Contrato => ({
  id, clienteId, tarifaId: base.tarifas[0].id, fechaInicio: '2026-11-01', fechaFin: '2026-11-30', modalidad: 'FIJO', franjasFijas: [{ plantillaId }],
  sesionesRestantes: null, estado: 'ACTIVO', actividadesPermitidasIds: [], notas: '', creadoEl: '2026-11-01T00:00:00.000Z', creadoPor: 'w', ...over,
});
const db = (over: Partial<Db>): Db => ({ ...base, clases: [], reservas: [], clientes: [], contratos: [], listaEspera: [], config: { ...base.config, diasCierre: [] }, ...over });
const a = (h: string) => new Date(`${HOY}T${h}:00`);

describe('El día de hoy · clases del día', () => {
  const d = db({
    clientes: [cliente('ana'), cliente('bea'), cliente('eva')],
    clases: [
      clase('c9', HOY, '09:30'), clase('c11', HOY, '11:30'), clase('c18', HOY, '18:00', { plazas: 1 }),
      clase('cx', HOY, '20:00', { estado: 'CANCELADA' }), clase('otro', '2026-11-17', '09:30'),
    ],
    reservas: [
      reserva('r1', 'c9', 'ana'), reserva('r2', 'c9', 'bea'), reserva('r3', 'c11', 'ana', { asistencia: 'ASISTE' }),
      reserva('r4', 'c18', 'eva'), reserva('r5', 'cx', 'bea', { estado: 'CANCELADA_CENTRO' }),
    ],
    listaEspera: [{ id: 'e1', claseId: 'c18', clienteId: 'ana', reservaCambioId: null, creadaEl: '2026-11-10T10:00:00.000Z' } as EntradaListaEspera],
  });

  it('cada clase con su momento: terminada, en curso, próxima o cancelada; y la destacada es la que está dándose', () => {
    const lista = clasesDeDia(d, HOY, a('11:45'));
    expect(lista.map((c) => [c.vista.clase.id, c.momento])).toEqual([['c9', 'TERMINADA'], ['c11', 'EN_CURSO'], ['c18', 'PROXIMA'], ['cx', 'CANCELADA']]);
    expect(claseDestacada(lista)?.vista.clase.id).toBe('c11');
    expect(claseDestacada(clasesDeDia(d, HOY, a('13:00')))?.vista.clase.id).toBe('c18');
    expect(claseDestacada(clasesDeDia(d, HOY, a('19:30')))).toBeNull();
  });

  it('falta pasar lista solo si ha terminado, tiene alumnos y nadie tiene la asistencia marcada', () => {
    const lista = clasesDeDia(d, HOY, a('12:30'));
    expect(lista.filter((c) => c.sinLista).map((c) => c.vista.clase.id)).toEqual(['c9']);
    expect(faltaPasarLista(vistaClase(d, d.clases[0]), a('10:00'))).toBe(false); // aún no ha terminado
    expect(faltaPasarLista(vistaClase(d, d.clases[3]), a('22:00'))).toBe(false); // cancelada
  });

  it('cifras del día sin contar las canceladas', () => {
    const c = cifrasDia(clasesDeDia(d, HOY, a('08:00')));
    expect(c).toEqual({ clases: 3, alumnos: 4, plazasLibres: 1, completas: 2, enEspera: 1 });
  });

  it('clases sin pasar lista de la semana: de la más reciente a la más antigua, sin las de hace más de 7 días', () => {
    const d2 = db({
      clientes: [cliente('ana')],
      clases: [clase('h', HOY, '09:30'), clase('ayer', '2026-11-15', '10:30'), clase('vieja', '2026-11-08', '10:30'), clase('lista', '2026-11-14', '10:30')],
      reservas: [reserva('1', 'h', 'ana'), reserva('2', 'ayer', 'ana'), reserva('3', 'vieja', 'ana'), reserva('4', 'lista', 'ana', { asistencia: 'NO_ASISTE' })],
    });
    expect(clasesSinPasarLista(d2, a('12:00'), HOY, 7).map((v) => v.clase.id)).toEqual(['h', 'ayer']);
  });
});

describe('El día de hoy · a quién tener un detalle', () => {
  it('cumple hoy, primera clase (alta reciente sin clases antes) y vuelve tras 3 semanas o más', () => {
    const d = db({
      clientes: [
        cliente('cumple', { fechaNacimiento: '1970-11-16' }), cliente('nueva', { altaEl: '2026-11-10' }), cliente('vuelve'),
        cliente('habitual'), cliente('antigua-sin-datos', { altaEl: '2025-03-01' }),
      ],
      clases: [clase('hoy', HOY, '18:00', { plazas: 8 }), clase('hace4', '2026-10-19', '18:00'), clase('semana', '2026-11-09', '18:00'), clase('falta', '2026-11-12', '18:00')],
      reservas: [
        reserva('a', 'hoy', 'cumple'), reserva('b', 'hoy', 'nueva'), reserva('c', 'hoy', 'vuelve'), reserva('d', 'hoy', 'habitual'), reserva('e', 'hoy', 'antigua-sin-datos'),
        reserva('f', 'hace4', 'vuelve'), reserva('g', 'semana', 'habitual'), reserva('h', 'semana', 'cumple'),
        // Una clase a la que no fue no cuenta como "última vez".
        reserva('i', 'falta', 'vuelve', { asistencia: 'NO_ASISTE' }),
      ],
    });
    const m = detallesDeClase(d, vistaClase(d, d.clases[0]));
    expect(m.get('cumple')).toEqual([{ tipo: 'CUMPLE' }]);
    expect(m.get('nueva')).toEqual([{ tipo: 'NUEVO' }]);
    expect(m.get('vuelve')).toEqual([{ tipo: 'VUELVE', semanas: 4 }]);
    expect(m.has('habitual')).toBe(false);
    expect(m.has('antigua-sin-datos')).toBe(false); // sin clases en la app pero no es alta reciente: no se le llama "nueva"
  });
});

describe('El día de hoy · fijos sin plaza', () => {
  const pl = base.plantillas[0];
  const d = db({
    clientes: [cliente('sin'), cliente('con'), cliente('cancelo'), cliente('baja', { activo: false }), cliente('otro')],
    contratos: [
      contrato('k1', 'sin', pl.id), contrato('k2', 'con', pl.id), contrato('k3', 'cancelo', pl.id), contrato('k4', 'baja', pl.id),
      contrato('k5', 'otro', pl.id, { fechaInicio: '2026-11-20' }),
    ],
    clases: [
      clase('l1', HOY, '11:30', { plantillaId: pl.id }), clase('l2', '2026-11-18', '11:30', { plantillaId: pl.id }),
      clase('lejos', '2026-11-30', '11:30', { plantillaId: pl.id }), clase('ya', HOY, '08:00', { plantillaId: pl.id }),
    ],
    reservas: [
      reserva('1', 'l1', 'con'), reserva('2', 'l2', 'con'), reserva('3', 'l1', 'cancelo', { estado: 'CANCELADA_RECUPERABLE' }), reserva('4', 'l2', 'cancelo'),
    ],
    listaEspera: [{ id: 'e', claseId: 'l1', clienteId: 'sin', reservaCambioId: null, creadaEl: '2026-11-13T10:00:00.000Z', contratoFijoId: 'k1' } as EntradaListaEspera],
  });

  it('solo los que no tienen ninguna fila en su clase, dentro de su contrato, de los próximos 7 días y sin empezar', () => {
    const lista = fijosSinPlaza(d, a('09:00'), HOY, 7);
    expect(lista.map((x) => [x.cliente.id, x.vista.clase.id, x.posicion])).toEqual([['sin', 'l1', 1], ['sin', 'l2', null]]);
    const grupos = agruparPorAlumno(lista);
    expect(grupos.map((g) => [g.cliente.id, g.clases.length])).toEqual([['sin', 2]]);
  });

  it('una clase que ya ha empezado deja de salir', () => {
    expect(fijosSinPlaza(d, a('12:00'), HOY, 7).map((x) => x.vista.clase.id)).toEqual(['l2']);
  });
});

describe('El día de hoy · altas y saludo', () => {
  it('altas de los últimos 7 días (hoy incluido), solo activas, de la más reciente a la más antigua', () => {
    const d = db({ clientes: [cliente('hoy', { altaEl: HOY }), cliente('lunes', { altaEl: '2026-11-10' }), cliente('vieja', { altaEl: '2026-11-09' }), cliente('baja', { altaEl: HOY, activo: false })] });
    expect(altasRecientes(d, HOY, 7).map((c) => c.id)).toEqual(['hoy', 'lunes']);
  });
  it('saludo según la hora', () => {
    expect(saludo(a('08:00'))).toBe('Buenos días');
    expect(saludo(a('16:00'))).toBe('Buenas tardes');
    expect(saludo(a('22:00'))).toBe('Buenas noches');
  });
});
