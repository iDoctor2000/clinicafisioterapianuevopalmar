import { Link } from 'react-router-dom';
import { Moon } from 'lucide-react';
import type { ClaseVista } from '@/data/selectores';
import { DIAS_SEMANA_CORTO, diaSemanaDe } from '@/domain/fechas';
import { Vacio } from '@/ui';
import { cn } from '@/lib/cn';
import { carrilesDe, minutosDe, rejillaSemana } from './consultas';
import { BarraOcupacion } from './comunes';

/** Altura en píxeles de una hora en la rejilla. */
const ALTO_HORA = 76;
const ANCHO_HORAS = 52;

export interface DiaConClases {
  fecha: string;
  clases: ClaseVista[];
}

/**
 * Rejilla horaria de una semana: columna de horas a la izquierda (solo las horas
 * en las que hay clases) y una columna por día. En móvil se desplaza en
 * horizontal con la cabecera de días y la columna de horas fijas.
 */
export function CalendarioSemana({ semana, hoy, cierres, limitado }: { semana: DiaConClases[]; hoy: string; cierres: { fecha: string; motivo: string }[]; limitado?: boolean }) {
  const domingo = semana[6];
  const dias = domingo && domingo.clases.length > 0 ? semana : semana.slice(0, 6);
  const todas = dias.flatMap((d) => d.clases);
  const rejilla = rejillaSemana(todas);

  if (!rejilla) {
    return (
      <div className="bg-white rounded-2xl shadow-card border border-ink/5">
        <Vacio icono={Moon} titulo={limitado ? 'No tienes clases esta semana' : 'Sin clases esta semana'} texto={limitado ? 'Solo se muestran las clases que impartes.' : 'No hay clases programadas ni extraordinarias.'} />
      </div>
    );
  }

  const altoTotal = ((rejilla.hastaMin - rejilla.desdeMin) / 60) * ALTO_HORA;
  const alturaTramo = (rejilla.tramoMin / 60) * ALTO_HORA;

  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink/5 overflow-auto max-h-[calc(100vh-15rem)] min-h-[20rem]">
      <div className="grid min-w-max md:min-w-0" style={{ gridTemplateColumns: `${ANCHO_HORAS}px repeat(${dias.length}, minmax(140px, 1fr))` }}>
        {/* Cabecera fija de días */}
        <div className="sticky top-0 left-0 z-30 bg-white border-b border-ink/10" />
        {dias.map((d) => {
          const cierre = cierres.find((c) => c.fecha === d.fecha);
          const esHoy = d.fecha === hoy;
          const programadas = d.clases.filter((c) => c.clase.estado === 'PROGRAMADA').length;
          return (
            <div key={d.fecha} className={cn('sticky top-0 z-20 bg-white border-b border-l border-ink/10 px-2 py-2 text-center', cierre && 'bg-ink/5')}>
              <div className={cn('inline-flex items-baseline gap-1 rounded-xl px-2 py-0.5 text-sm font-semibold', esHoy ? 'bg-brand-500 text-sand' : 'text-ink-soft')}>
                <span className="uppercase">{DIAS_SEMANA_CORTO[diaSemanaDe(d.fecha)]}</span>
                <span className="text-lg font-bold leading-none">{Number(d.fecha.slice(8))}</span>
              </div>
              <div className="text-[11px] text-ink-muted leading-tight mt-0.5 truncate">
                {cierre ? <span className="text-ink-soft font-semibold">Cierre</span> : d.clases.length ? `${programadas} ${programadas === 1 ? 'clase' : 'clases'}` : '—'}
              </div>
            </div>
          );
        })}

        {/* Columna de horas */}
        <div className="sticky left-0 z-10 bg-white border-r border-ink/10 relative" style={{ height: altoTotal }}>
          {rejilla.tramos.map((t) => (
            <div key={t.min} className="absolute right-1.5 -translate-y-1/2 text-[11px] font-semibold tabular-nums text-ink-muted" style={{ top: ((t.min - rejilla.desdeMin) / 60) * ALTO_HORA }}>
              {t.min === rejilla.desdeMin ? <span className="translate-y-1.5 inline-block">{t.etiqueta}</span> : t.etiqueta}
            </div>
          ))}
        </div>

        {/* Columnas de días */}
        {dias.map((d) => {
          const cierre = cierres.find((c) => c.fecha === d.fecha);
          return (
            <div key={d.fecha} className={cn('relative border-l border-ink/10', cierre && 'bg-ink/5')} style={{ height: altoTotal }}>
              {rejilla.tramos.map((t, i) => (
                <div key={t.min} className={cn('absolute inset-x-0 border-t', i === 0 ? 'border-transparent' : rejilla.tramoMin === 30 && (t.min % 60 !== 0) ? 'border-ink/5 border-dashed' : 'border-ink/10')} style={{ top: i * alturaTramo }} />
              ))}
              {cierre && (
                <div className="absolute inset-x-0 top-0 p-2 text-center">
                  <span className="inline-block rounded-lg bg-white/80 px-2 py-1 text-xs font-semibold text-ink-soft leading-tight">Cierre: {cierre.motivo}</span>
                </div>
              )}
              {carrilesDe(d.clases).map(({ vista, carril, carriles }) => (
                <BloqueClase key={vista.clase.id} vista={vista} top={((minutosDe(vista.clase.horaInicio) - rejilla.desdeMin) / 60) * ALTO_HORA} alto={(vista.clase.duracionMin / 60) * ALTO_HORA} carril={carril} carriles={carriles} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BloqueClase({ vista, top, alto, carril, carriles }: { vista: ClaseVista; top: number; alto: number; carril: number; carriles: number }) {
  const { clase, actividad, ocupadas } = vista;
  const cancelada = clase.estado === 'CANCELADA';
  const completa = !cancelada && ocupadas >= clase.plazas;
  const ancho = 100 / carriles;
  return (
    <Link
      to={`/clase/${clase.id}`}
      title={`${actividad.nombre} · ${clase.horaInicio} · ${ocupadas}/${clase.plazas}${clase.extraordinaria ? ' · extraordinaria' : ''}${cancelada ? ' · cancelada' : ''}`}
      className={cn('absolute rounded-lg border-l-4 px-1.5 py-1 text-xs overflow-hidden tap hover:ring-2 hover:ring-beige-300 focus-visible:ring-2 focus-visible:ring-beige-300 outline-none', cancelada && 'opacity-50')}
      style={{
        top: top + 1, height: Math.max(alto - 3, 28),
        left: `calc(${carril * ancho}% + 3px)`, width: `calc(${ancho}% - 6px)`,
        borderLeftColor: actividad.color, backgroundColor: `${actividad.color}1f`,
      }}
    >
      <div className="flex items-center justify-between gap-1 font-semibold leading-tight">
        <span className="flex items-center gap-1 tabular-nums">
          {clase.horaInicio}
          {clase.extraordinaria && <span className="inline-block h-1.5 w-1.5 rounded-full bg-cocoa" title="Extraordinaria" aria-label="Extraordinaria" />}
        </span>
        <span className={cn('tabular-nums', completa && 'text-rose')}>{ocupadas}/{clase.plazas}</span>
      </div>
      <div className={cn('truncate font-semibold text-ink leading-tight', cancelada && 'line-through')}>{actividad.nombre}</div>
      {cancelada ? <div className="text-[10px] text-rose font-semibold leading-tight">Cancelada</div> : <BarraOcupacion ocupadas={ocupadas} plazas={clase.plazas} className="mt-1 h-1" />}
    </Link>
  );
}
