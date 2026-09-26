import type { ClaseVista } from '@/data/selectores';
import { DIAS_SEMANA_CORTO, DIAS_SEMANA_LABEL, diaSemanaDe } from '@/domain/fechas';
import { cn } from '@/lib/cn';
import { ocupacionDia, semanasDelMes, type OcupacionDia } from './consultas';

const COLOR_NIVEL: Record<OcupacionDia['nivel'], string> = { verde: 'bg-brand-500', ambar: 'bg-clay', rojo: 'bg-rose' };
const TEXTO_NIVEL: Record<OcupacionDia['nivel'], string> = { verde: 'text-brand-700', ambar: 'text-clay', rojo: 'text-rose' };

/**
 * Cuadrícula mensual (lunes-primero, 6 filas como máximo). Cada día muestra el
 * número de clases y la ocupación global; tocar un día abre la vista Día.
 */
export function CalendarioMes({ fecha, hoy, cierres, clasesPorFecha, onElegirDia }: { fecha: string; hoy: string; cierres: { fecha: string; motivo: string }[]; clasesPorFecha: Map<string, ClaseVista[]>; onElegirDia: (f: string) => void }) {
  const semanas = semanasDelMes(fecha);
  const mes = fecha.slice(0, 7);
  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink/5 p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1 mb-1" aria-hidden>
        {([1, 2, 3, 4, 5, 6, 7] as const).map((d) => (
          <div key={d} className={cn('text-center text-[11px] sm:text-xs font-semibold uppercase py-1', d === 7 ? 'text-ink-muted/70' : 'text-ink-muted')}>
            <span className="sm:hidden">{DIAS_SEMANA_CORTO[d]}</span>
            <span className="hidden sm:inline">{DIAS_SEMANA_LABEL[d].slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid">
        {semanas.flat().map((d) => {
          const clases = clasesPorFecha.get(d) ?? [];
          const oc = ocupacionDia(clases);
          const cierre = cierres.find((c) => c.fecha === d);
          const fuera = d.slice(0, 7) !== mes;
          const esHoy = d === hoy;
          const activa = d === fecha;
          const canceladas = clases.length - oc.clases;
          const etiqueta = `${DIAS_SEMANA_LABEL[diaSemanaDe(d)]} ${Number(d.slice(8))}${cierre ? `, cierre: ${cierre.motivo}` : oc.clases ? `, ${oc.clases} clases, ${oc.ocupadas} de ${oc.plazas} plazas` : ', sin clases'}`;
          return (
            <button
              key={d} type="button" role="gridcell" onClick={() => onElegirDia(d)} aria-label={etiqueta} aria-current={esHoy ? 'date' : undefined}
              className={cn(
                'min-h-[64px] sm:min-h-[84px] md:min-h-[96px] rounded-xl border p-1 sm:p-1.5 flex flex-col text-left tap hover:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-300 outline-none',
                cierre ? 'bg-ink/5 border-transparent' : 'bg-white border-ink/5',
                fuera && 'opacity-40',
                activa && !esHoy && 'border-brand-300 bg-brand-50/60',
                esHoy && 'border-brand-500 ring-1 ring-brand-500',
              )}
            >
              <span className={cn('self-start text-sm sm:text-base font-bold leading-none rounded-md px-1 py-0.5 -ml-0.5', esHoy ? 'bg-brand-500 text-white' : 'text-ink')}>{Number(d.slice(8))}</span>
              {cierre ? (
                <span className="mt-auto text-[10px] sm:text-xs text-ink-soft font-semibold leading-tight line-clamp-2" title={cierre.motivo}>{cierre.motivo}</span>
              ) : oc.clases > 0 || canceladas > 0 ? (
                <span className="mt-auto flex flex-col gap-0.5">
                  <span className="text-[11px] sm:text-xs text-ink-soft leading-tight tabular-nums">
                    {oc.clases} <span className="hidden sm:inline">{oc.clases === 1 ? 'clase' : 'clases'}</span><span className="sm:hidden">cl.</span>
                    {canceladas > 0 && <span className="text-rose"> · {canceladas} canc.</span>}
                  </span>
                  <span className={cn('hidden sm:block text-xs font-semibold tabular-nums leading-tight', TEXTO_NIVEL[oc.nivel])}>{oc.completo ? 'Completo' : `${oc.ocupadas}/${oc.plazas}`}</span>
                  <span className={cn('sm:hidden text-[10px] font-semibold tabular-nums leading-tight', TEXTO_NIVEL[oc.nivel])}>{oc.completo ? 'Lleno' : `${oc.porcentaje}%`}</span>
                  <span className="h-1.5 rounded-full bg-ink/10 overflow-hidden" role="progressbar" aria-valuenow={oc.ocupadas} aria-valuemax={oc.plazas} aria-label="Ocupación del día">
                    <span className={cn('block h-full rounded-full', COLOR_NIVEL[oc.nivel])} style={{ width: `${oc.porcentaje}%` }} />
                  </span>
                </span>
              ) : (
                <span className="mt-auto text-[10px] sm:text-xs text-ink-muted/70">—</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] sm:text-xs text-ink-muted px-1">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-brand-500" /> menos del 50 %</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-clay" /> 50–85 %</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-rose" /> más del 85 %</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-ink/10" /> cierre</span>
      </div>
    </div>
  );
}
