import { useMemo, useState } from 'react';
import { subDays, subMonths, startOfQuarter, endOfQuarter } from 'date-fns';
import type { ReactNode } from 'react';
import { aISODate } from '@/domain/fechas';
import { Entrada, Seleccion, Tarjeta } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { asistenciasMensuales, calcularEstadisticas, rangoMes, type FranjaHoraria } from './consultas';
import { Encabezado, PuntoColor, Segmentado } from './comunes';

export function Estadisticas() {
  const { db, limitado } = useTrabajador();
  const ahora = useMemo(() => new Date(), []);
  const [rango, setRango] = useState(rangoMes(ahora));
  const [actividadId, setActividadId] = useState('');
  const [franja, setFranja] = useState<FranjaHoraria>('TODAS');
  const filtro = { ...rango, actividadId: actividadId || null, franja };
  const e = useMemo(() => calcularEstadisticas(db, filtro, ahora), [db, filtro.desde, filtro.hasta, filtro.actividadId, filtro.franja, ahora]); // eslint-disable-line react-hooks/exhaustive-deps
  const meses = useMemo(() => asistenciasMensuales(db, ahora, 6, actividadId || null), [db, ahora, actividadId]);
  const maxMes = Math.max(1, ...meses.map((m) => m.asistencias + m.faltas));

  const atajos: { texto: string; rango: () => { desde: string; hasta: string } }[] = [
    { texto: 'Mes actual', rango: () => rangoMes(ahora) },
    { texto: 'Mes anterior', rango: () => rangoMes(subMonths(ahora, 1)) },
    { texto: 'Últimos 30 días', rango: () => ({ desde: aISODate(subDays(ahora, 29)), hasta: aISODate(ahora) }) },
    { texto: 'Trimestre', rango: () => ({ desde: aISODate(startOfQuarter(ahora)), hasta: aISODate(endOfQuarter(ahora)) }) },
  ];

  return (
    <div>
      <Encabezado titulo="Estadísticas" subtitulo={limitado ? 'Ocupación y asistencia de tus clases y tus alumnos.' : 'Ocupación, asistencia y actividad del centro.'} />
      <Tarjeta className="p-4 mb-4">
        <div className="flex gap-2 flex-wrap mb-3">
          {atajos.map((a) => { const r = a.rango(); const activo = r.desde === rango.desde && r.hasta === rango.hasta; return <button key={a.texto} type="button" aria-pressed={activo} onClick={() => setRango(r)} className={cn('h-10 px-4 rounded-xl border font-semibold text-sm tap', activo ? 'bg-brand-500 text-sand border-brand-500' : 'bg-white border-ink/10 hover:border-beige-300')}>{a.texto}</button>; })}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Entrada etiqueta="Desde" type="date" value={rango.desde} onChange={(ev) => setRango({ ...rango, desde: ev.target.value })} />
          <Entrada etiqueta="Hasta" type="date" value={rango.hasta} onChange={(ev) => setRango({ ...rango, hasta: ev.target.value })} />
          <Seleccion etiqueta="Actividad" value={actividadId} onChange={(ev) => setActividadId(ev.target.value)}>
            <option value="">Todas</option>
            {db.actividades.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </Seleccion>
          <div><span className="block text-[15px] font-semibold mb-1.5">Franja</span><Segmentado className="w-full" tamano="sm" valor={franja} onCambio={setFranja} opciones={[{ valor: 'TODAS', texto: 'Todas' }, { valor: 'MANANA', texto: 'Mañana' }, { valor: 'TARDE', texto: 'Tarde' }]} /></div>
        </div>
      </Tarjeta>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi titulo={limitado ? 'Alumnos activos' : 'Clientes activos'} valor={e.clientesActivos} nota={`+${e.altas} altas · −${e.bajas} bajas`} />
        <Kpi titulo="Clases impartidas" valor={e.clasesImpartidas} nota={e.clasesCanceladas ? `${e.clasesCanceladas} canceladas` : 'ninguna cancelada'} />
        <Kpi titulo="Ocupación media" valor={`${e.ocupacionMedia}%`} nota={`${e.plazasLibres} plazas libres`} tono={e.ocupacionMedia >= 75 ? 'ok' : e.ocupacionMedia >= 50 ? 'ambar' : 'rojo'} />
        <Kpi titulo="Asistencias" valor={e.asistencias} nota={`${e.faltas} faltas`} />
        <Kpi titulo="Cancelaciones" valor={e.cancelaciones.total} nota={`${e.cancelaciones.recuperables} recup. · ${e.cancelaciones.noRecuperables} no recup. · ${e.cancelaciones.centro} centro`} />
        <Kpi titulo="Recuperaciones usadas" valor={e.recuperacionesUsadas} />
        <Kpi titulo="Sesiones de bono" valor={e.bonoUsadas} nota="usadas en el periodo" />
        <Kpi titulo="Tasa de faltas" valor={`${e.asistencias + e.faltas ? Math.round((e.faltas / (e.asistencias + e.faltas)) * 100) : 0}%`} nota="sobre plazas ocupadas" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Tarjeta className="p-4">
          <h2 className="text-lg font-sans font-semibold mb-3">Ocupación por actividad</h2>
          {e.porActividad.length === 0 && <p className="text-ink-muted">Sin clases en el periodo.</p>}
          <ul className="space-y-3">
            {e.porActividad.map((a) => (
              <li key={a.actividad.id}>
                <div className="flex justify-between text-sm mb-1"><span className="font-semibold flex items-center gap-2"><PuntoColor color={a.actividad.color} />{a.actividad.nombre}</span><span className="text-ink-muted">{a.ocupadas}/{a.plazas} · {a.clases} clases · <strong className="text-ink">{a.porcentaje}%</strong></span></div>
                <div className="h-3 rounded-full bg-ink/5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${a.porcentaje}%`, backgroundColor: a.actividad.color }} /></div>
              </li>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta className="p-4">
          <h2 className="text-lg font-sans font-semibold mb-3">Ocupación por hora</h2>
          {e.porHora.length === 0 ? <p className="text-ink-muted">Sin clases en el periodo.</p> : (
            <div className="flex items-end gap-1.5 h-44 border-b border-ink/10">
              {e.porHora.map((h) => (
                <div key={h.hora} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${h.hora}: ${h.ocupadas}/${h.plazas} (${h.clases} clases)`}>
                  <span className="text-[11px] font-semibold text-ink-soft mb-1">{h.porcentaje}%</span>
                  <div className={cn('w-full rounded-t-lg', h.porcentaje >= 75 ? 'bg-brand-500' : h.porcentaje >= 50 ? 'bg-beige-500' : 'bg-beige-300')} style={{ height: `${Math.max(3, h.porcentaje)}%` }} />
                  <span className="text-[11px] text-ink-muted mt-1 truncate">{h.hora}</span>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
        <Tarjeta className="p-4 lg:col-span-2">
          <h2 className="text-lg font-sans font-semibold mb-1">Evolución mensual de asistencias</h2>
          <p className="text-sm text-ink-muted mb-3">Últimos 6 meses{actividadId ? ` · ${db.actividades.find((a) => a.id === actividadId)?.nombre}` : ''}. <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-500 align-middle" /> asistencias <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose/70 align-middle ml-2" /> faltas</p>
          <div className="flex items-end gap-3 h-48 border-b border-ink/10">
            {meses.map((m) => (
              <div key={m.mes} className="flex-1 flex flex-col items-center justify-end h-full" title={`${m.etiqueta}: ${m.asistencias} asistencias, ${m.faltas} faltas`}>
                <span className="text-xs font-semibold text-ink-soft mb-1">{m.asistencias}</span>
                <div className="w-full max-w-16 flex flex-col justify-end" style={{ height: `${((m.asistencias + m.faltas) / maxMes) * 85}%` }}>
                  <div className="w-full bg-rose/70" style={{ flexGrow: m.faltas }} />
                  <div className="w-full bg-brand-500 rounded-b-md" style={{ flexGrow: m.asistencias }} />
                </div>
                <span className="text-xs text-ink-muted mt-1 capitalize">{m.etiqueta}</span>
              </div>
            ))}
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: ReactNode; nota?: string; tono?: 'ok' | 'ambar' | 'rojo' }) {
  return (
    <Tarjeta className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{titulo}</div>
      <div className={cn('text-3xl font-bold mt-1 tabular-nums', tono === 'ok' && 'text-ink', tono === 'ambar' && 'text-clay', tono === 'rojo' && 'text-rose')}>{valor}</div>
      {nota && <div className="text-xs text-ink-muted mt-1">{nota}</div>}
    </Tarjeta>
  );
}
