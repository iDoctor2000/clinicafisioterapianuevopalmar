import type { ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, DoorClosed } from 'lucide-react';
import type { ClaseVista } from '@/data/selectores';
import type { ISODate } from '@/domain/types';
import { Tarjeta, Vacio } from '@/ui';
import { cn } from '@/lib/cn';
import { diaConNumero, diasDeSemanaAcotados, textoSemana } from './consultas';

/**
 * Vista semanal del horario del cliente: una lista por día con filas grandes y
 * fáciles de tocar. Reutiliza la misma fila que la lista diaria (`renderClase`).
 */
export function HorarioSemana({ fecha, hoy, desde, hasta, cierres, clasesDe, renderClase, puedeAnterior, puedeSiguiente, onAnterior, onSiguiente }: {
  fecha: ISODate;
  hoy: ISODate;
  /** Primer y último día que se pueden consultar (mismo rango que la tira de días). */
  desde: ISODate;
  hasta: ISODate;
  cierres: { fecha: ISODate; motivo: string }[];
  clasesDe: (fecha: ISODate) => ClaseVista[];
  renderClase: (vista: ClaseVista) => ReactNode;
  puedeAnterior: boolean;
  puedeSiguiente: boolean;
  onAnterior: () => void;
  onSiguiente: () => void;
}) {
  const dias = diasDeSemanaAcotados(fecha, desde, hasta);
  const esEstaSemana = dias.includes(hoy);
  const alguna = dias.some((d) => clasesDe(d).length > 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <button type="button" onClick={onAnterior} disabled={!puedeAnterior} aria-label="Semana anterior" className="h-12 w-12 rounded-full bg-white shadow-card flex items-center justify-center text-ink-soft tap disabled:opacity-30">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <p className="font-semibold text-center leading-tight">
          <span className="block text-lg">{esEstaSemana ? 'Esta semana' : 'Semana del'}</span>
          <span className={cn('block whitespace-nowrap', esEstaSemana ? 'text-sm text-ink-muted' : 'text-lg')}>{textoSemana(fecha)}</span>
        </p>
        <button type="button" onClick={onSiguiente} disabled={!puedeSiguiente} aria-label="Semana siguiente" className="h-12 w-12 rounded-full bg-white shadow-card flex items-center justify-center text-ink-soft tap disabled:opacity-30">
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {!alguna && (
        <Tarjeta className="mb-4"><Vacio icono={CalendarDays} titulo="No hay clases esta semana" texto="Prueba con la semana siguiente." /></Tarjeta>
      )}

      <div className="space-y-5">
        {dias.map((d) => {
          const clases = clasesDe(d);
          const cierre = cierres.find((c) => c.fecha === d) ?? null;
          const esHoy = d === hoy;
          return (
            <section key={d} aria-label={diaConNumero(d)}>
              <h2 className={cn('text-lg font-sans font-semibold mb-2 flex items-baseline gap-2', esHoy ? 'text-beige-600' : 'text-ink')}>
                {diaConNumero(d)}
                {esHoy && <span className="text-sm font-medium text-beige-600">· hoy</span>}
              </h2>
              {cierre ? (
                <Tarjeta className="px-4 py-3 flex items-center gap-3 text-ink-soft bg-sand-deep/60">
                  <DoorClosed className="h-5 w-5 shrink-0" />
                  <span>Centro cerrado: <strong className="text-ink">{cierre.motivo}</strong></span>
                </Tarjeta>
              ) : clases.length === 0 ? (
                <p className="px-1 py-2 text-ink-muted">Sin clases este día.</p>
              ) : (
                <ul className="space-y-2">
                  {clases.map((v) => <li key={v.clase.id}>{renderClase(v)}</li>)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
