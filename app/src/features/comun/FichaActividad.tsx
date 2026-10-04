import { useState } from 'react';
import { BadgeCheck, ChevronDown, Clock } from 'lucide-react';
import type { Actividad } from '@/domain/types';
import { duracionActividad } from '@/domain/types';
import { Chip } from '@/ui';
import { cn } from '@/lib/cn';
import { IconoActividad } from './IconoActividad';

/**
 * Ficha de una actividad para el cliente: icono, nombre, duración y descripción corta;
 * al desplegar, la descripción completa y la frase final en una tarjeta oscura (como las
 * imágenes del centro: fondo antracita y texto beige dorado).
 */
export function FichaActividad({ actividad: a, incluida }: { actividad: Actividad; incluida?: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const larga = (a.descripcionLarga ?? '').trim();
  const lema = (a.lema ?? '').trim();
  const desplegable = larga.length > 0 || lema.length > 0;
  return (
    <div className="p-4">
      <button type="button" onClick={() => desplegable && setAbierta((v) => !v)} aria-expanded={abierta} className={cn('w-full text-left flex items-start gap-3 tap', !desplegable && 'cursor-default')}>
        <IconoActividad actividad={a} tamano="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-lg">{a.nombreWeb?.trim() || a.nombre}</span>
            <span className="inline-flex items-center gap-1 text-sm text-ink-muted"><Clock className="h-3.5 w-3.5" /> {duracionActividad(a)} min</span>
            {incluida && <Chip tono="beige"><BadgeCheck className="h-3.5 w-3.5" /> Incluida en tu tarifa</Chip>}
          </div>
          {a.descripcion && <p className="text-ink-soft text-[15px] mt-1">{a.descripcion}</p>}
        </div>
        {desplegable && <ChevronDown className={cn('h-5 w-5 text-ink-muted shrink-0 mt-1 transition-transform', abierta && 'rotate-180')} />}
      </button>
      {abierta && (
        <div className="mt-3 rounded-2xl bg-brand-700 text-beige-100 p-5 shadow-lift">
          {a.fotoUrl && <img src={a.fotoUrl} alt="" className="w-full aspect-[16/9] object-cover rounded-xl mb-4" loading="lazy" />}
          {larga && <p className="text-[15px] leading-relaxed">{larga}</p>}
          {lema && <p className="mt-4 font-serif italic text-xl text-beige-400">{lema}</p>}
        </div>
      )}
    </div>
  );
}
