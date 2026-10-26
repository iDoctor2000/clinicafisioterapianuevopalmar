import { describe, expect, it } from 'vitest';
import { aCentimos, aTextoEuros, cobrosEnLaFicha, euros, tituloCobro, importeSugerido, importesOfertaTrimestral, mesDelPeriodo, mesesDelPeriodo, pagoVencido, planDeCobros } from '@/domain/cobros';

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
    expect(plan.map((q) => q.mes)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
    expect(plan[0].concepto).toBe('Octubre 2026');
  });

  it('la ficha enseña solo el mes que se está pagando: el último cobrado, las deudas y el que viene por cobrar', () => {
    const p = (mes: string, estado: 'PAGADO' | 'PENDIENTE') => ({ mes, estado });
    // 26 de octubre: pagó octubre el 7 y noviembre hoy; diciembre previsto. Solo noviembre.
    const r = cobrosEnLaFicha([p('2026-10-01', 'PAGADO'), p('2026-11-01', 'PAGADO'), p('2026-12-01', 'PENDIENTE')], '2026-10-26');
    expect(r.visibles.map((x) => x.mes)).toEqual(['2026-11-01']);
    expect(r.historial.map((x) => x.mes)).toEqual(['2026-10-01', '2026-12-01']);
    // Solo tiene octubre cobrado: se ve octubre y noviembre por cobrar (es lo próximo que hay que cobrar).
    expect(cobrosEnLaFicha([p('2026-10-01', 'PAGADO'), p('2026-11-01', 'PENDIENTE'), p('2026-12-01', 'PENDIENTE')], '2026-10-26').visibles.map((x) => x.mes)).toEqual(['2026-10-01', '2026-11-01']);
    // Pagó septiembre y debe octubre: septiembre ya es historial; se ven octubre (deuda) y noviembre.
    expect(cobrosEnLaFicha([p('2026-09-01', 'PAGADO'), p('2026-10-01', 'PENDIENTE'), p('2026-11-01', 'PENDIENTE')], '2026-10-26').visibles.map((x) => x.mes)).toEqual(['2026-10-01', '2026-11-01']);
    // Una deuda vieja no se esconde nunca.
    expect(cobrosEnLaFicha([p('2026-08-01', 'PENDIENTE'), p('2026-10-01', 'PAGADO')], '2026-10-26').visibles.map((x) => x.mes)).toEqual(['2026-08-01', '2026-10-01']);
    expect(cobrosEnLaFicha([], '2026-10-26')).toEqual({ visibles: [], historial: [] });
  });

  it('el título de un cobro es su mes; el concepto solo si dice algo más', () => {
    const t = (concepto: string) => tituloCobro({ concepto, mes: '2026-11-01' });
    expect(t('Noviembre')).toBe('Noviembre 2026');
    expect(t('noviembre 2026')).toBe('Noviembre 2026');
    expect(t('Mes 2 · noviembre 2026')).toBe('Noviembre 2026');
    expect(t('')).toBe('Noviembre 2026');
    expect(t('Bono 10')).toBe('Bono 10 · Noviembre 2026');
  });

  it('cada cuota es el mes natural que cubre: empezar el 26 de octubre es pagar noviembre, y un mes y pico es una sola cuota', () => {
    expect(mesDelPeriodo('2026-10-26', '2026-11-30')).toBe('2026-11-01');
    expect(mesDelPeriodo('2026-10-06', '2027-01-06')).toBe('2026-10-01');
    const corto = planDeCobros({ tarifa: mensual, inicio: '2026-10-26', fin: '2026-11-30', oferta: 'NINGUNA', importeCentimos: 4500 });
    expect(corto).toEqual([{ concepto: 'Noviembre 2026', importeCentimos: 4500, venceEl: '2026-10-26', mes: '2026-11-01' }]);
    const tarde = planDeCobros({ tarifa: mensual, inicio: '2026-10-20', fin: '2027-01-19', oferta: 'NINGUNA', importeCentimos: null });
    expect(tarde.map((q) => q.concepto)).toEqual(['Noviembre 2026', 'Diciembre 2026', 'Enero 2027']);
  });

  it('si se cambia el importe a mano, manda el importe acordado', () => {
    const plan = planDeCobros({ tarifa: mensual, inicio: '2026-10-06', fin: '2027-01-06', oferta: 'TRIMESTRAL', importeCentimos: 4000 });
    expect(plan.map((q) => q.importeCentimos)).toEqual([4000, 4000, 4000]);
  });

  it('bono o clase suelta: un único cobro', () => {
    const plan = planDeCobros({ tarifa: { tipo: 'BONO', nombre: 'Bono 10R', precioCentimos: 12000, descripcion: '' }, inicio: '2026-10-06', fin: '2027-04-06', oferta: 'NINGUNA', importeCentimos: null });
    expect(plan).toEqual([{ concepto: 'Bono 10R', importeCentimos: 12000, venceEl: '2026-10-06', mes: '2026-10-01' }]);
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
