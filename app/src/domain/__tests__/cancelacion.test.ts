import { describe, expect, it } from 'vitest';
import { clasificarCancelacion, puedeCancelarCliente } from '../rules';
import { clase, config } from './fixtures';

describe('clasificarCancelacion', () => {
  const k = clase({ fecha: '2026-10-06', horaInicio: '18:00' });

  it('con 1 hora o más de antelación es recuperable', () => {
    const r = clasificarCancelacion(k, new Date(2026, 9, 6, 17, 0), config);
    expect(r.estado).toBe('CANCELADA_RECUPERABLE');
    expect(r.recuperable).toBe(true);
  });

  it('con menos de 1 hora es no recuperable', () => {
    const r = clasificarCancelacion(k, new Date(2026, 9, 6, 17, 1), config);
    expect(r.estado).toBe('CANCELADA_NO_RECUPERABLE');
  });

  it('el límite es configurable por el administrador', () => {
    const r = clasificarCancelacion(k, new Date(2026, 9, 6, 15, 0), { minutosAntelacionCancelacion: 4 * 60 });
    expect(r.recuperable).toBe(false);
  });
});

describe('puedeCancelarCliente', () => {
  it('no permite cancelar una clase ya empezada', () => {
    expect(puedeCancelarCliente(clase(), 'RESERVADA', new Date(2026, 9, 6, 18, 5)).ok).toBe(false);
  });
  it('permite cancelar (aunque sea sin derecho a recuperación) para avisar al monitor', () => {
    expect(puedeCancelarCliente(clase(), 'RESERVADA', new Date(2026, 9, 6, 17, 50)).ok).toBe(true);
  });
  it('no permite cancelar dos veces', () => {
    expect(puedeCancelarCliente(clase(), 'CANCELADA_RECUPERABLE', new Date(2026, 9, 1)).ok).toBe(false);
  });
});
