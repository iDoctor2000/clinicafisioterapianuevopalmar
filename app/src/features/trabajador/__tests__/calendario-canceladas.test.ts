/** Calendario del personal: las clases canceladas sin ningún alumno no se muestran; las canceladas con alumnos, sí (tachadas). */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import type { Clase, Reserva } from '@/domain/types';
import { crearSeed } from '@/data/seed';
import { aISODate, sumarDias } from '@/domain/fechas';
import { claseVisibleEnCalendario, clasesPorDiaDeSemana, clasesPorFechaEntre } from '../consultas';

const hoy = aISODate(new Date());
const fecha = sumarDias(hoy, 7);
const cancelada = (id: string): Clase => ({
  id, plantillaId: null, actividadId: crearSeed().actividades[0].id, fecha, horaInicio: '13:00', duracionMin: 55, monitorId: 'tra-ana', plazas: 8,
  estado: 'CANCELADA', extraordinaria: true, claseAlternativaId: null, motivoCancelacion: 'Prueba', canceladaEl: new Date().toISOString(), canceladaPor: 'tra-jose',
});

describe('clases canceladas en el calendario del personal', () => {
  const db0 = crearSeed();
  const vacia = cancelada('cla-cancelada-vacia');
  const conAlumno = cancelada('cla-cancelada-con-alumno');
  const reserva: Reserva = {
    id: 'res-x', claseId: conAlumno.id, clienteId: 'maria', contratoId: null, origen: 'MANUAL', estado: 'CANCELADA_CENTRO', asistencia: 'PENDIENTE',
    recuperacionUsadaId: null, creadaEl: new Date().toISOString(), creadaPor: 'tra-jose', canceladaEl: new Date().toISOString(), canceladaPor: 'tra-jose',
  };
  const db: Db = { ...db0, clases: [...db0.clases, vacia, conAlumno], reservas: [...db0.reservas, reserva] };

  it('la cancelada sin alumnos se oculta y la cancelada con alumnos se muestra', () => {
    expect(claseVisibleEnCalendario(db, vacia)).toBe(false);
    expect(claseVisibleEnCalendario(db, conAlumno)).toBe(true);
    const semana = clasesPorDiaDeSemana(db, fecha).find((d) => d.fecha === fecha)!;
    expect(semana.clases.some((v) => v.clase.id === vacia.id)).toBe(false);
    expect(semana.clases.some((v) => v.clase.id === conAlumno.id)).toBe(true);
    const mes = clasesPorFechaEntre(db, fecha, fecha).get(fecha) ?? [];
    expect(mes.some((v) => v.clase.id === vacia.id)).toBe(false);
    expect(mes.some((v) => v.clase.id === conAlumno.id)).toBe(true);
  });
  it('las clases programadas se muestran siempre', () => {
    const programadas = db.clases.filter((c) => c.estado === 'PROGRAMADA');
    expect(programadas.every((c) => claseVisibleEnCalendario(db, c))).toBe(true);
  });
});
