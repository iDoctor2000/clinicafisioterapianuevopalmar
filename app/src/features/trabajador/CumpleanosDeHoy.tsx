import { DIAS_SEMANA_CORTO, diaSemanaDe, hoyISO } from '@/domain/fechas';
import { cumpleanosProximos } from '@/domain/logros';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';

/** "Hoy cumplen años: Carmen y Paco" y, debajo, los de los próximos días (solo si hay alguien). */
export function CumpleanosDeHoy() {
  const { db } = useTrabajador();
  const hoy = hoyISO();
  const proximos = cumpleanosProximos(db.clientes, hoy, 7);
  if (proximos.length === 0) return null;
  const nombreCorto = (c: { nombre: string; apellidos: string }) => `${c.nombre} ${c.apellidos.split(' ')[0] ?? ''}`.trim();
  const deHoy = proximos.filter((p) => p.enDias === 0);
  const siguientes = proximos.filter((p) => p.enDias > 0);
  const nombres = deHoy.map((p) => nombreCorto(p.cliente));
  const texto = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
  const dia = (p: { fecha: string; enDias: number }) => (p.enDias === 1 ? 'mañana' : `el ${DIAS_SEMANA_CORTO[diaSemanaDe(p.fecha)].toLowerCase()} ${Number(p.fecha.slice(8, 10))}`);
  return (
    <div className="mb-4 rounded-2xl bg-beige-50 border border-beige-200 px-4 py-3 space-y-1">
      {deHoy.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>🎂</span>
          <span className="text-ink-soft">Hoy {deHoy.length === 1 ? 'cumple' : 'cumplen'} años: <strong className="text-ink">{texto}</strong>. ¡Felicítale{deHoy.length === 1 ? '' : 's'} en clase!</span>
        </div>
      )}
      {siguientes.length > 0 && (
        <div className={cn('flex items-center gap-3 text-sm text-ink-soft', deHoy.length > 0 && 'pl-9')}>
          {deHoy.length === 0 && <span className="text-2xl" aria-hidden>🎂</span>}
          <span>Esta semana: {siguientes.map((p, i) => <span key={p.cliente.id}>{i > 0 && ', '}<strong className="text-ink">{nombreCorto(p.cliente)}</strong> {dia(p)}</span>)}. Para preparar la pizarra.</span>
        </div>
      )}
    </div>
  );
}
