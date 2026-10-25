import { describe, expect, it } from 'vitest';
import type { PremioMes } from '../types';
import type { ClaseHecha } from '../logros';
import {
  avisoGanador, faltasDelMes, finMes, inicioMes, mesAnterior, motivoCandidato, objetivoReto, ordenarCandidatos, premioVigente, retoDelMes,
} from '../clienteDelMes';
import type { Clase, Reserva } from '../types';

const clase = (fecha: string): ClaseHecha => ({ fecha, hora: '10:00', duracionMin: 55, actividadId: 'a', monitorId: null });
const premio = (mes: string, clienteId: string, publico: boolean | null = null): PremioMes => ({ mes, clienteId, clases: 8, motivo: '', anunciadoEl: '', publico, nombrePublico: '' });

describe('fechas del mes', () => {
  it('mes anterior, inicio y fin', () => {
    expect(mesAnterior('2026-10-07')).toBe('2026-09-01');
    expect(mesAnterior('2026-01-15')).toBe('2025-12-01');
    expect(inicioMes('2026-10-07')).toBe('2026-10-01');
    expect(finMes('2026-02-01')).toBe('2026-02-28');
    expect(finMes('2028-02-01')).toBe('2028-02-29');
    expect(finMes('2026-12-01')).toBe('2026-12-31');
  });
});

describe('reto del mes', () => {
  it('objetivo = clases por semana × 4', () => {
    expect(objetivoReto(2)).toBe(8);
    expect(objetivoReto(1)).toBe(4);
    expect(objetivoReto(0)).toBe(4);
  });
  it('cuenta solo las clases del mes en curso', () => {
    const clases = [clase('2026-09-30'), clase('2026-10-01'), clase('2026-10-03'), clase('2026-10-06')];
    const r = retoDelMes(clases, '2026-10-07', 1);
    expect(r).toMatchObject({ mes: '2026-10-01', hechas: 3, objetivo: 4, cumplido: false });
    expect(retoDelMes([...clases, clase('2026-10-07')], '2026-10-07', 1).cumplido).toBe(true);
  });
});

describe('candidatos a cliente del mes', () => {
  const cupo = (id: string) => (id === 'cuatro' ? 4 : 2);
  it('primero quien cumple el reto, luego más semanas, luego más clases', () => {
    const lista = ordenarCandidatos([
      { clienteId: 'muchas-una-semana', clases: 7, minutos: 385, semanas: 2 },
      { clienteId: 'constante', clases: 8, minutos: 440, semanas: 4 },
      { clienteId: 'cuatro', clases: 12, minutos: 660, semanas: 4 },
      { clienteId: 'mas-semanas', clases: 9, minutos: 495, semanas: 5 },
      { clienteId: 'nada', clases: 0, minutos: 0, semanas: 0 },
    ], { mes: '2026-09-01', cupoDe: cupo, premios: [] });
    // "cuatro" tiene 4/semana: su reto es 16 y no lo cumple.
    expect(lista.map((c) => c.clienteId)).toEqual(['mas-semanas', 'constante', 'cuatro', 'muchas-una-semana']);
    expect(lista[0].retoCumplido).toBe(true);
    expect(lista.find((c) => c.clienteId === 'cuatro')?.retoCumplido).toBe(false);
  });
  it('quien ganó en los 3 meses anteriores va al final', () => {
    const act = [
      { clienteId: 'a', clases: 10, minutos: 550, semanas: 5 },
      { clienteId: 'b', clases: 8, minutos: 440, semanas: 4 },
    ];
    const conPremio = ordenarCandidatos(act, { mes: '2026-09-01', cupoDe: cupo, premios: [premio('2026-07-01', 'a')] });
    expect(conPremio.map((c) => c.clienteId)).toEqual(['b', 'a']);
    expect(conPremio[1].ganoEn).toBe('2026-07-01');
    // Hace más de 3 meses ya no cuenta.
    const antiguo = ordenarCandidatos(act, { mes: '2026-09-01', cupoDe: cupo, premios: [premio('2026-05-01', 'a')] });
    expect(antiguo[0].clienteId).toBe('a');
  });
  it('explica el motivo', () => {
    const [c] = ordenarCandidatos([{ clienteId: 'a', clases: 9, minutos: 495, semanas: 4 }], { mes: '2026-09-01', cupoDe: cupo, premios: [] });
    expect(motivoCandidato(c)).toBe('9 clases en 4 semanas · reto cumplido');
    expect(motivoCandidato({ ...c, faltas: 2 })).toBe('9 clases en 4 semanas · reto cumplido · 2 faltas');
  });
  it('desempate: menos faltas, quien nunca ganó, más antigüedad, más minutos y, al final, el nombre', () => {
    const iguales = (id: string) => ({ clienteId: id, clases: 8, minutos: 440, semanas: 4 });
    const faltas: Record<string, number> = { falta: 1 };
    const alta: Record<string, string> = { nuevo: '2026-06-01', veterano: '2024-01-10', novato: '2026-06-01' };
    const lista = ordenarCandidatos(
      [iguales('falta'), iguales('veterano'), iguales('gano-hace-mucho'), iguales('nuevo'), { ...iguales('novato'), minutos: 500 }],
      {
        mes: '2026-09-01', cupoDe: cupo, premios: [premio('2025-01-01', 'gano-hace-mucho')],
        faltasDe: (id) => faltas[id] ?? 0, altaDe: (id) => alta[id] ?? null, nombreDe: (id) => id,
      },
    );
    // veterano y novato/nuevo nunca ganaron y no faltaron: gana la antigüedad; entre nuevo y novato (misma alta), los minutos;
    // quien ganó alguna vez (hace mucho) va después; quien faltó, el último.
    expect(lista.map((c) => c.clienteId)).toEqual(['veterano', 'novato', 'nuevo', 'gano-hace-mucho', 'falta']);
    expect(lista.find((c) => c.clienteId === 'gano-hace-mucho')?.ganoAlgunaVez).toBe(true);
    expect(lista.find((c) => c.clienteId === 'gano-hace-mucho')?.ganoEn).toBeNull();
  });
  it('faltasDelMes cuenta solo las "No asiste" de clases no canceladas del mes', () => {
    const clase = (id: string, fecha: string, estado: Clase['estado'] = 'PROGRAMADA'): Clase => ({ id, plantillaId: null, actividadId: 'a', fecha, horaInicio: '10:00', duracionMin: 55, monitorId: 'm', plazas: 8, estado, extraordinaria: false, claseAlternativaId: null, motivoCancelacion: null, canceladaEl: null, canceladaPor: null });
    const reserva = (claseId: string, asistencia: Reserva['asistencia'], estado: Reserva['estado'] = 'RESERVADA'): Reserva => ({ id: `r-${claseId}`, claseId, clienteId: 'x', contratoId: null, origen: 'CLIENTE', estado, asistencia, recuperacionUsadaId: null, creadaEl: '', creadaPor: 'x', canceladaEl: null, canceladaPor: null });
    const clases = [clase('c1', '2026-09-03'), clase('c2', '2026-09-10'), clase('c3', '2026-09-17', 'CANCELADA'), clase('c4', '2026-10-01')];
    const reservas = [reserva('c1', 'NO_ASISTE'), reserva('c2', 'ASISTE'), reserva('c3', 'NO_ASISTE'), reserva('c4', 'NO_ASISTE'), reserva('c2', 'NO_ASISTE', 'CANCELADA_RECUPERABLE')];
    expect(faltasDelMes(reservas, clases, 'x', '2026-09-01')).toBe(1);
    expect(faltasDelMes(reservas, clases, 'otro', '2026-09-01')).toBe(0);
  });
});

describe('premio vigente y aviso', () => {
  it('durante octubre se muestra el de septiembre', () => {
    const premios = [premio('2026-09-01', 'a'), premio('2026-08-01', 'b')];
    expect(premioVigente(premios, '2026-10-20')?.clienteId).toBe('a');
    expect(premioVigente(premios, '2026-11-02')).toBeNull();
  });
  it('el aviso nombra al ganador y el mes', () => {
    const t = avisoGanador('Ana', '2026-09-01', 12);
    expect(t.titulo).toContain('septiembre');
    expect(t.cuerpo).toContain('Ana');
    expect(t.cuerpo).toContain('12 clases');
  });
});
