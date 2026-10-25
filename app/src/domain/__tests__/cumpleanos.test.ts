import { describe, expect, it } from 'vitest';
import { cumpleanosProximos, esCumpleanos } from '../logros';

const alumno = (id: string, fechaNacimiento: string | null, activo = true) => ({ id, fechaNacimiento, activo });

describe('cumpleaños', () => {
  it('esCumpleanos: mismo día y mes; el 29 de febrero se celebra el 28 en años no bisiestos', () => {
    expect(esCumpleanos('1974-03-26', '2026-03-26')).toBe(true);
    expect(esCumpleanos('1974-03-26', '2026-03-27')).toBe(false);
    expect(esCumpleanos('2000-02-29', '2026-02-28')).toBe(true);
    expect(esCumpleanos('2000-02-29', '2024-02-28')).toBe(false);
    expect(esCumpleanos('2000-02-29', '2024-02-29')).toBe(true);
    expect(esCumpleanos(null, '2026-02-28')).toBe(false);
  });
  it('cumpleanosProximos: hoy y los 6 días siguientes, en orden, solo activos y con fecha; cruza el cambio de mes y de año', () => {
    const lista = cumpleanosProximos([
      alumno('hoy', '1980-12-30'), alumno('pasado', '1980-12-29'), alumno('manana', '1990-12-31'), alumno('ano-nuevo', '1975-01-02'),
      alumno('lejos', '1975-01-06'), alumno('baja', '1980-12-30', false), alumno('sin-fecha', null),
    ], '2026-12-30', 7);
    expect(lista.map((p) => [p.cliente.id, p.fecha, p.enDias])).toEqual([['hoy', '2026-12-30', 0], ['manana', '2026-12-31', 1], ['ano-nuevo', '2027-01-02', 3]]);
  });
});
