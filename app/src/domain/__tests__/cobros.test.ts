import { describe, expect, it } from 'vitest';
import { aCentimos, aTextoEuros, euros, importeSugerido, importesOfertaTrimestral, mesesDelPeriodo, pagoVencido, planDeCobros } from '@/domain/cobros';

const mensual = { tipo: 'RECURRENTE' as const, nombre: 'Clases dirigidas · 2 días/semana', precioCentimos: 5000,
  descripcion: 'Dos clases semanales. 50 €/mes. Oferta trimestral: 65 € (mes 1), 65 € (mes 2), 0 € (mes 3).' };

describe('cobros', () => {
  it('lee los importes de la oferta trimestral de la descripción', () => {
    expect(importesOfertaTrimestral(mensual.descripcion)).toEqual([6500, 6500, 0]);
    expect(importesOfertaTrimestral('58 €/mes. Oferta trimestral: 80 € (mes 1), 30 € (mes 2), 0 € (mes 3). Pregunta por la oferta familiar.')).toEqual([8000, 3000, 0]);
    expect(importesOfertaTrimestral('Oferta trimestral: 90 € + 90 € + mes 3 gratis.')).toEqual([9000, 9000, 0]);
    expect(importesOfertaTrimestral('Una clase suelta. 12 €.')).toBeNull();
  });

  it('propone el importe del primer mes de la oferta o el precio', () => {
    expect(importeSugerido(mensual, 'TRIMESTRAL')).toBe(6500);
    expect(importeSugerido(mensual, 'NINGUNA')).toBe(5000);
    expect(importeSugerido({ ...mensual, precioCentimos: null }, 'FAMILIAR')).toBeNull();
  });

  it('cuenta un cobro por mes del periodo', () => {
    expect(mesesDelPeriodo('2026-10-06', '2027-01-06')).toBe(3);
    expect(mesesDelPeriodo('2026-10-06', '2026-10-06')).toBe(1);
    expect(mesesDelPeriodo('2026-10-06', '2027-04-06')).toBe(6);
  });

  it('genera el plan mensual con la oferta trimestral', () => {
    const plan = planDeCobros({ tarifa: mensual, inicio: '2026-10-06', fin: '2027-01-06', oferta: 'TRIMESTRAL', importeCentimos: null });
    expect(plan.map((q) => q.importeCentimos)).toEqual([6500, 6500, 0]);
    expect(plan.map((q) => q.venceEl)).toEqual(['2026-10-06', '2026-11-06', '2026-12-06']);
    expect(plan[0].concepto).toBe('Mes 1 · octubre 2026');
  });

  it('si se cambia el importe a mano, manda el importe acordado', () => {
    const plan = planDeCobros({ tarifa: mensual, inicio: '2026-10-06', fin: '2027-01-06', oferta: 'TRIMESTRAL', importeCentimos: 4000 });
    expect(plan.map((q) => q.importeCentimos)).toEqual([4000, 4000, 4000]);
  });

  it('bono o clase suelta: un único cobro', () => {
    const plan = planDeCobros({ tarifa: { tipo: 'BONO', nombre: 'Bono 10R', precioCentimos: 12000, descripcion: '' }, inicio: '2026-10-06', fin: '2027-04-06', oferta: 'NINGUNA', importeCentimos: null });
    expect(plan).toEqual([{ concepto: 'Bono 10R', importeCentimos: 12000, venceEl: '2026-10-06' }]);
  });

  it('formatea y lee importes en euros', () => {
    expect(euros(4500)).toBe('45 €');
    expect(euros(4550)).toBe('45,50 €');
    expect(aCentimos('45,5')).toBe(4550);
    expect(aCentimos('45 €')).toBe(4500);
    expect(aCentimos('')).toBeNull();
    expect(aCentimos('abc')).toBeNull();
    expect(aTextoEuros(4550)).toBe('45,50');
  });

  it('un cobro pendiente vence el día que toca', () => {
    expect(pagoVencido({ estado: 'PENDIENTE', venceEl: '2026-10-06' }, '2026-10-06')).toBe(true);
    expect(pagoVencido({ estado: 'PENDIENTE', venceEl: '2026-11-06' }, '2026-10-06')).toBe(false);
    expect(pagoVencido({ estado: 'PAGADO', venceEl: '2026-10-01' }, '2026-10-06')).toBe(false);
  });
});
