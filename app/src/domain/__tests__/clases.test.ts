import { describe, expect, it } from 'vitest';
import { generarClases, generarReservasAutomaticas, sesionesPrevistas, caducidadRecuperacion, caducarVencidas } from '../rules';
import { clase, config, contrato, plantilla, reserva } from './fixtures';

let n = 0;
const id = () => `id${++n}`;

describe('generarClases', () => {
  it('genera las clases semanales del rango saltando cierres y sin duplicar', () => {
    const ps = [plantilla(), plantilla({ id: 'p-lun-10', diaSemana: 1, horaInicio: '10:00' })];
    // 5 oct (lun) – 18 oct (dom) 2026: lunes 5 y 12 (cierre), martes 6 y 13
    const clases = generarClases(ps, '2026-10-05', '2026-10-18', config, [{ plantillaId: 'p-mar-18', fecha: '2026-10-06' }], id);
    expect(clases.map((c) => `${c.plantillaId}@${c.fecha}`).sort()).toEqual(['p-lun-10@2026-10-05', 'p-mar-18@2026-10-13']);
  });
  it('respeta la vigencia de la plantilla', () => {
    const clases = generarClases([plantilla({ vigenciaDesde: '2026-10-10' })], '2026-10-05', '2026-10-18', config, [], id);
    expect(clases.map((c) => c.fecha)).toEqual(['2026-10-13']);
  });
});

describe('sesionesPrevistas', () => {
  it('cuenta martes y jueves de un trimestre descontando festivos', () => {
    const ps = [plantilla(), plantilla({ id: 'p-jue-18', diaSemana: 4 })];
    const c = contrato({ modalidad: 'FIJO', franjasFijas: [{ plantillaId: 'p-mar-18' }, { plantillaId: 'p-jue-18' }] });
    const r = sesionesPrevistas(c, ps, { diasCierre: [{ fecha: '2026-10-06', motivo: 'x' }, { fecha: '2026-12-24', motivo: 'Nochebuena' }] });
    // Oct–Dic 2026: 13 martes + 14 jueves = 27; menos 6 oct (mar) y 24 dic (jue) = 25
    expect(r.total).toBe(25);
  });
});

describe('generarReservasAutomaticas', () => {
  it('crea reservas para las clases de las franjas fijas sin duplicar y respetando plazas', () => {
    const c = contrato({ modalidad: 'FIJO', franjasFijas: [{ plantillaId: 'p-mar-18' }] });
    const k1 = clase({ id: 'k1', fecha: '2026-10-06' });
    const k2 = clase({ id: 'k2', fecha: '2026-10-13', plazas: 1 });
    const k3 = clase({ id: 'k3', fecha: '2026-10-20' });
    const kOtra = clase({ id: 'k4', fecha: '2026-10-08', plantillaId: 'p-jue-18' });
    const existentes = [reserva({ id: 'x', claseId: 'k1' }), reserva({ id: 'y', claseId: 'k2', clienteId: 'otro' })];
    const nuevas = generarReservasAutomaticas(c, [k1, k2, k3, kOtra], existentes, id, '2026-09-26T00:00:00.000Z');
    expect(nuevas.map((r) => r.claseId)).toEqual(['k3']);
    expect(nuevas[0].origen).toBe('AUTOMATICA');
  });
  it('no genera nada para turno libre', () => {
    expect(generarReservasAutomaticas(contrato(), [clase()], [], id, '')).toEqual([]);
  });
});

describe('recuperaciones', () => {
  it('caduca con el contrato o a N días según configuración', () => {
    expect(caducidadRecuperacion(contrato(), '2026-10-06', config)).toBe('2026-12-31');
    expect(caducidadRecuperacion(contrato(), '2026-10-06', { recuperacionCaducaConContrato: false, diasCaducidadRecuperacion: 30 })).toBe('2026-11-05');
  });
  it('marca como caducadas las vencidas', () => {
    const [a, b] = caducarVencidas(
      [{ ...recFix(), caducaEl: '2026-10-01' }, { ...recFix(), id: 'b', caducaEl: '2026-10-10' }],
      '2026-10-05',
    );
    expect(a.estado).toBe('CADUCADA');
    expect(b.estado).toBe('DISPONIBLE');
  });
});

function recFix() {
  return {
    id: 'a', clienteId: 'cli1', contratoId: 'c1', reservaOrigenId: null, categoriaOrigen: 'DIRIGIDA' as const,
    categoriasPermitidas: ['DIRIGIDA' as const], motivo: 'CANCELACION_CLIENTE' as const, estado: 'DISPONIBLE' as const,
    caducaEl: '2026-12-31', usadaEnReservaId: null, creadaEl: '', creadaPor: '', nota: '',
  };
}
