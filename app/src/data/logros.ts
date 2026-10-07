/**
 * Datos para medallas, avisos de "clase 100" y resúmenes anuales.
 * En DEMO se calculan con los datos en memoria; en SUPABASE se piden a las funciones de
 * 0014_logros.sql (el historial completo no se carga con el resto de datos, que solo
 * trae unas semanas alrededor de hoy).
 */
import { useEffect, useState } from 'react';
import type { Id, ISODate } from '@/domain/types';

import { clasesHechasDe, type ClaseHecha } from '@/domain/logros';
import { useStore } from './store';
import { servidor } from './supabase/cliente';

const enDemo = () => useStore.getState().modo === 'DEMO';

// Pequeña caché: Inicio, Perfil y las celebraciones piden lo mismo al abrir la app.
const cache = new Map<string, { t: number; v: Promise<ClaseHecha[]> }>();
const VIGENCIA_MS = 5 * 60 * 1000;

export function historialCliente(clienteId: Id): Promise<ClaseHecha[]> {
  if (enDemo()) {
    const { db } = useStore.getState();
    return Promise.resolve(clasesHechasDe(db.reservas, db.clases, clienteId, new Date()));
  }
  const c = cache.get(clienteId);
  if (c && Date.now() - c.t < VIGENCIA_MS) return c.v;
  const v = (async () => {
    const r = await servidor().rpc('historial_clases', { p_cliente_id: clienteId });
    if (r.error) throw r.error;
    return ((r.data as { f: string; h: string; d: number; a: string; m: string | null }[] | null) ?? [])
      .map((x) => ({ fecha: x.f, hora: x.h, duracionMin: x.d, actividadId: x.a, monitorId: x.m }));
  })();
  v.catch(() => cache.delete(clienteId));
  cache.set(clienteId, { t: Date.now(), v });
  return v;
}

/** Hook: clases hechas del cliente (null mientras carga o si falla). */
export function useHistorialCliente(clienteId: Id | null | undefined): ClaseHecha[] | null {
  const [clases, setClases] = useState<ClaseHecha[] | null>(null);
  // En demo se recalcula cuando cambian los datos (pasar lista, reservar…).
  const db = useStore((s) => (s.modo === 'DEMO' ? s.db : null));
  useEffect(() => {
    if (!clienteId) return;
    let vivo = true;
    historialCliente(clienteId).then((v) => { if (vivo) setClases(v); }).catch(() => { if (vivo) setClases(null); });
    return () => { vivo = false; };
  }, [clienteId, db]);
  return clases;
}

/** Cuántas clases lleva cada cliente hasta `hasta` (incluido). */
export async function conteoClases(clienteIds: Id[], hasta: ISODate): Promise<Map<Id, number>> {
  if (clienteIds.length === 0) return new Map();
  if (enDemo()) {
    const { db } = useStore.getState();
    return new Map(clienteIds.map((id) => [id, clasesHechasDe(db.reservas, db.clases, id, new Date(), hasta).length]));
  }
  const r = await servidor().rpc('conteo_clases', { p_clientes: clienteIds, p_hasta: hasta });
  if (r.error) throw r.error;
  return new Map(Object.entries((r.data as Record<string, number> | null) ?? {}));
}

export interface ResumenCentro {
  total: number;
  alumnos: number;
  horas: number;
  clases: number;
  actividad: { id: Id; n: number } | null;
  mes: { mes: number; n: number } | null;
  dia: { dia: number; n: number } | null;
  hora: { hora: string; n: number } | null;
}

/** "El año del centro": totales del año. */
export async function resumenCentro(anio: number): Promise<ResumenCentro> {
  if (enDemo()) {
    const { db } = useStore.getState();
    const hechas = db.clientes.flatMap((c) => clasesHechasDe(db.reservas, db.clases, c.id, new Date()).filter((x) => x.fecha.startsWith(`${anio}-`)).map((x) => ({ ...x, clienteId: c.id })));
    const top = <K,>(xs: K[]) => {
      const n = new Map<K, number>();
      xs.forEach((x) => n.set(x, (n.get(x) ?? 0) + 1));
      return [...n.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    };
    const act = top(hechas.map((h) => h.actividadId));
    const mes = top(hechas.map((h) => Number(h.fecha.slice(5, 7))));
    const dia = top(hechas.map((h) => ((new Date(`${h.fecha}T12:00:00`).getDay() + 6) % 7) + 1));
    const hora = top(hechas.map((h) => h.hora));
    return {
      total: hechas.length, alumnos: new Set(hechas.map((h) => h.clienteId)).size,
      horas: Math.round(hechas.reduce((s, h) => s + h.duracionMin, 0) / 60),
      clases: new Set(hechas.map((h) => `${h.fecha}${h.hora}${h.actividadId}`)).size,
      actividad: act && { id: act[0], n: act[1] }, mes: mes && { mes: mes[0], n: mes[1] },
      dia: dia && { dia: dia[0], n: dia[1] }, hora: hora && { hora: hora[0], n: hora[1] },
    };
  }
  const r = await servidor().rpc('resumen_centro', { p_anio: anio });
  if (r.error) throw r.error;
  return r.data as ResumenCentro;
}

