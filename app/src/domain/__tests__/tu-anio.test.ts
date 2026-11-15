/** "Tu año en Pilates": el texto del año y las medallas de ese año. */
import { describe, expect, it } from 'vitest';
import { anioResumenVisible, calcularMedallas, desdeResumen, medallasDelAnio, resumenAnual, type ClaseHecha } from '../logros';

const hecha = (fecha: string, hora = '09:30', actividadId = 'a1'): ClaseHecha => ({ fecha, hora, duracionMin: 55, actividadId, monitorId: 'm1' });
/** Una clase cada lunes desde `desde`, `n` semanas. */
function semanal(desde: string, n: number, hora = '09:30'): ClaseHecha[] {
  const r: ClaseHecha[] = [];
  const base = Date.parse(`${desde}T12:00:00Z`);
  for (let i = 0; i < n; i++) r.push(hecha(new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10), hora));
  return r;
}

describe('Tu año en Pilates', () => {
  it('si el año no empieza en enero (la app se estrenó en otoño), dice "desde el …" en lugar de "este año"', () => {
    const r = resumenAnual(semanal('2026-09-28', 10), 2026);
    expect(r.primeraClase).toBe('2026-09-28');
    expect(r.total).toBe(10);
    expect(desdeResumen(r)).toBe('desde el 28 de septiembre');
  });

  it('un año completo (primera clase en enero) dice "este año"', () => {
    expect(desdeResumen(resumenAnual(semanal('2027-01-04', 40), 2027))).toBeNull();
    expect(desdeResumen(resumenAnual(semanal('2027-01-31', 5), 2027))).toBeNull();
    expect(desdeResumen(resumenAnual(semanal('2027-02-01', 5), 2027))).toBe('desde el 1 de febrero');
    // Las clases de otros años no cuentan para el año del resumen.
    expect(resumenAnual([...semanal('2026-10-05', 8), ...semanal('2027-01-11', 5)], 2027).primeraClase).toBe('2027-01-11');
    expect(desdeResumen(resumenAnual([], 2027))).toBeNull();
  });

  it('medallas del año: las conseguidas ese año, sin "Primera clase"', () => {
    // 12 lunes seguidos a las 9:30 desde el 28/09/2026: 10 clases, racha de 4 y de 12, madrugador.
    const clases = semanal('2026-09-28', 12);
    const estados = calcularMedallas(clases, { cupoSemanal: 1, hoy: '2026-12-31' });
    const ids = medallasDelAnio(estados, 2026).map((m) => m.id);
    expect(ids).toEqual(['c10', 'semana-completa', 'racha4', 'racha12', 'madrugador']);
    expect(ids).not.toContain('primera');
    // En el año siguiente esas medallas ya no son "del año".
    expect(medallasDelAnio(estados, 2027)).toEqual([]);
  });

  it('la ventana por defecto va del 15 de diciembre al 15 de enero (en enero, el año anterior)', () => {
    expect(anioResumenVisible('2026-12-14', {})).toBeNull();
    expect(anioResumenVisible('2026-12-15', {})).toBe(2026);
    expect(anioResumenVisible('2027-01-15', {})).toBe(2026);
    expect(anioResumenVisible('2027-01-16', {})).toBeNull();
    expect(anioResumenVisible('2026-12-20', { activo: false })).toBeNull();
  });
});
