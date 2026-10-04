import type { Actividad } from '@/domain/types';
import { urlIcono } from '@/lib/iconos';
import { cn } from '@/lib/cn';

const TAMANO = { xs: 'h-7 w-7 text-[11px]', sm: 'h-10 w-10 text-sm', md: 'h-14 w-14 text-lg', lg: 'h-20 w-20 text-2xl' } as const;

/**
 * Icono redondo de una actividad: la imagen del icono (incluido o subido) o, si no tiene,
 * un círculo beige con relieve y la inicial. El color de la actividad marca un pequeño punto.
 */
export function IconoActividad({ actividad, tamano = 'sm', className, sinPunto }: { actividad: Pick<Actividad, 'nombre' | 'icono' | 'color'>; tamano?: keyof typeof TAMANO; className?: string; sinPunto?: boolean }) {
  const url = urlIcono(actividad.icono ?? '');
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', TAMANO[tamano], className)} aria-hidden>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" />
      ) : (
        <span className="h-full w-full rounded-full bg-gradient-to-br from-[#F7F1EA] via-beige-100 to-[#D9CCBE] shadow-[0_3px_8px_-3px_rgba(58,58,58,0.35),inset_0_1px_0_rgba(255,255,255,0.8)] border border-beige-300/70 flex items-center justify-center font-serif text-ink">
          {actividad.nombre.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {!sinPunto && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white" style={{ backgroundColor: actividad.color }} />}
    </span>
  );
}
