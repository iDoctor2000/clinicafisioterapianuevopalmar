import { describe, expect, it } from 'vitest';
import { evaluarReserva, type ContextoReserva } from '../rules';
import { actDirigida, actReformer, actividadesPorId, clase, config, contrato, recuperacion, reserva, tarifaBonoDir, tarifaDir2, tarifaMixta } from './fixtures';

const ahora = new Date(2026, 9, 5, 10, 0); // lunes 5 oct 2026

function ctx(over: Partial<ContextoReserva> = {}): ContextoReserva {
  const k = over.clase ?? clase();
  const clasesPorId = new Map([[k.id, k], ...(over.clasesPorId ?? new Map())]);
  return {
    ahora, config, contrato: contrato(), tarifa: tarifaDir2, clase: k, actividad: actDirigida,
    reservasCliente: [], reservasClase: [], recuperaciones: [], clasesPorId, actividadesPorId, ...over,
  };
}

describe('evaluarReserva – turno libre', () => {
  it('reserva dentro del cupo semanal', () => {
    const r = evaluarReserva(ctx());
    expect(r.ok && r.via).toBe('CUPO_SEMANAL');
  });

  it('bloquea cuando el cupo semanal está agotado', () => {
    const k2 = clase({ id: 'k2', fecha: '2026-10-07' });
    const k3 = clase({ id: 'k3', fecha: '2026-10-08' });
    const r = evaluarReserva(ctx({
      clase: clase({ id: 'k4', fecha: '2026-10-09' }),
      clasesPorId: new Map([[k2.id, k2], [k3.id, k3]]),
      reservasCliente: [reserva({ id: 'r2', claseId: 'k2' }), reserva({ id: 'r3', claseId: 'k3' })],
    }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.codigo).toBe('CUPO_AGOTADO');
  });

  it('una cancelación no recuperable sigue consumiendo cupo; una recuperable lo libera', () => {
    const k2 = clase({ id: 'k2', fecha: '2026-10-07' });
    const k3 = clase({ id: 'k3', fecha: '2026-10-08' });
    const base = { clase: clase({ id: 'k4', fecha: '2026-10-09' }), clasesPorId: new Map([[k2.id, k2], [k3.id, k3]]) };
    const noRec = evaluarReserva(ctx({ ...base, reservasCliente: [reserva({ id: 'r2', claseId: 'k2' }), reserva({ id: 'r3', claseId: 'k3', estado: 'CANCELADA_NO_RECUPERABLE' })] }));
    expect(noRec.ok).toBe(false);
    const rec = evaluarReserva(ctx({ ...base, reservasCliente: [reserva({ id: 'r2', claseId: 'k2' }), reserva({ id: 'r3', claseId: 'k3', estado: 'CANCELADA_RECUPERABLE' })] }));
    expect(rec.ok).toBe(true);
  });

  it('un cliente de dirigidas no puede reservar Reformer', () => {
    const r = evaluarReserva(ctx({ clase: clase({ actividadId: 'a-ref' }), actividad: actReformer }));
    expect(!r.ok && r.codigo).toBe('ACTIVIDAD_NO_PERMITIDA');
  });

  it('la tarifa mixta permite 1 dirigida + 1 Reformer por semana', () => {
    const kRef = clase({ id: 'kref', actividadId: 'a-ref', fecha: '2026-10-07' });
    const c = ctx({ tarifa: tarifaMixta, contrato: contrato({ tarifaId: 't-mixta' }) });
    expect(evaluarReserva(c).ok).toBe(true);
    const c2 = ctx({ tarifa: tarifaMixta, contrato: contrato({ tarifaId: 't-mixta' }), clase: kRef, actividad: actReformer, reservasCliente: [reserva()] });
    expect(evaluarReserva(c2).ok).toBe(true);
    // segunda dirigida en la misma semana → bloqueada
    const c3 = ctx({ tarifa: tarifaMixta, contrato: contrato({ tarifaId: 't-mixta' }), clase: clase({ id: 'k9', fecha: '2026-10-08' }), reservasCliente: [reserva()], clasesPorId: new Map([['k1', clase()]]) });
    expect(!evaluarReserva(c3).ok).toBe(true);
  });

  it('bloquea sin plazas, clase pasada y clase cancelada', () => {
    expect((evaluarReserva(ctx({ reservasClase: Array.from({ length: 8 }, (_, i) => ({ claseId: 'k1', estado: 'RESERVADA' as const, id: String(i) })) })) as { codigo: string }).codigo).toBe('SIN_PLAZAS');
    expect((evaluarReserva(ctx({ clase: clase({ fecha: '2026-10-01' }) })) as { codigo: string }).codigo).toBe('CLASE_PASADA');
    expect((evaluarReserva(ctx({ clase: clase({ estado: 'CANCELADA' }) })) as { codigo: string }).codigo).toBe('CLASE_CANCELADA');
  });

  it('respeta la ventana de reserva', () => {
    const r = evaluarReserva(ctx({ clase: clase({ fecha: '2026-11-20' }) }));
    expect(!r.ok && r.codigo).toBe('FUERA_VENTANA');
  });
});

describe('evaluarReserva – recuperaciones', () => {
  it('usa una recuperación cuando la semana está completa', () => {
    const k2 = clase({ id: 'k2', fecha: '2026-10-07' });
    const k3 = clase({ id: 'k3', fecha: '2026-10-08' });
    const r = evaluarReserva(ctx({
      clase: clase({ id: 'k4', fecha: '2026-10-09' }),
      clasesPorId: new Map([[k2.id, k2], [k3.id, k3]]),
      reservasCliente: [reserva({ id: 'r2', claseId: 'k2' }), reserva({ id: 'r3', claseId: 'k3' })],
      recuperaciones: [recuperacion()],
    }));
    expect(r.ok && r.via).toBe('RECUPERACION');
  });

  it('una recuperación de dirigidas no sirve para Reformer', () => {
    const r = evaluarReserva(ctx({ clase: clase({ actividadId: 'a-ref' }), actividad: actReformer, recuperaciones: [recuperacion()] }));
    expect(r.ok).toBe(false);
  });

  it('una recuperación autorizada como excepción sí permite Reformer', () => {
    const r = evaluarReserva(ctx({
      clase: clase({ actividadId: 'a-ref' }), actividad: actReformer,
      recuperaciones: [recuperacion({ categoriasPermitidas: ['DIRIGIDA', 'REFORMER'], motivo: 'AUTORIZACION_MANUAL' })],
    }));
    expect(r.ok && r.via).toBe('RECUPERACION');
  });

  it('no usa recuperaciones caducadas', () => {
    const r = evaluarReserva(ctx({ clase: clase({ actividadId: 'a-ref' }), actividad: actReformer, recuperaciones: [recuperacion({ categoriasPermitidas: ['REFORMER'], caducaEl: '2026-10-01' })] }));
    expect(r.ok).toBe(false);
  });

  it('con horario fijo, otra clase solo con recuperación', () => {
    const fijo = contrato({ modalidad: 'FIJO', franjasFijas: [{ plantillaId: 'p-mar-18' }] });
    expect(evaluarReserva(ctx({ contrato: fijo })).ok).toBe(true); // su clase habitual
    const otra = clase({ id: 'k5', plantillaId: 'p-jue-18', fecha: '2026-10-08' });
    expect((evaluarReserva(ctx({ contrato: fijo, clase: otra })) as { codigo: string }).codigo).toBe('HORARIO_FIJO');
    expect(evaluarReserva(ctx({ contrato: fijo, clase: otra, recuperaciones: [recuperacion()] })).ok).toBe(true);
  });
});

describe('evaluarReserva – bonos', () => {
  it('descuenta del bono mientras queden sesiones', () => {
    const r = evaluarReserva(ctx({ tarifa: tarifaBonoDir, contrato: contrato({ tarifaId: 't-bono', sesionesRestantes: 3 }) }));
    expect(r.ok && r.via).toBe('BONO');
  });
  it('bloquea con el bono agotado', () => {
    const r = evaluarReserva(ctx({ tarifa: tarifaBonoDir, contrato: contrato({ tarifaId: 't-bono', sesionesRestantes: 0 }) }));
    expect(!r.ok && r.codigo).toBe('BONO_AGOTADO');
  });
  it('el bono de dirigidas no vale para Reformer', () => {
    const r = evaluarReserva(ctx({ tarifa: tarifaBonoDir, contrato: contrato({ tarifaId: 't-bono', sesionesRestantes: 3 }), clase: clase({ actividadId: 'a-ref' }), actividad: actReformer }));
    expect(r.ok).toBe(false);
  });
});
