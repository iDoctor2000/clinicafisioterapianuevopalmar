import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variante = 'primario' | 'secundario' | 'suave' | 'peligro' | 'fantasma';
type Tamano = 'md' | 'lg' | 'sm';

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamano?: Tamano;
  cargando?: boolean;
  ancho?: boolean;
}

const estilos: Record<Variante, string> = {
  primario: 'bg-brand-500 text-white hover:bg-brand-600 shadow-lift',
  secundario: 'bg-white text-ink border border-ink/10 hover:bg-sand-deep',
  suave: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  peligro: 'bg-rose/10 text-rose hover:bg-rose/15',
  fantasma: 'bg-transparent text-ink-soft hover:bg-ink/5',
};
const tamanos: Record<Tamano, string> = {
  sm: 'h-10 px-4 text-[15px] rounded-xl',
  md: 'h-12 px-5 text-base rounded-2xl',
  lg: 'h-14 px-6 text-lg rounded-2xl',
};

/** Botón grande y claro: todos los objetivos táctiles miden al menos 44 px. */
export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  { variante = 'primario', tamano = 'md', cargando, ancho, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || cargando}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-semibold tap select-none',
        'disabled:opacity-50 disabled:pointer-events-none',
        estilos[variante], tamanos[tamano], ancho && 'w-full', className,
      )}
      {...rest}
    >
      {cargando && <Loader2 className="h-5 w-5 animate-spin" />}
      {children}
    </button>
  );
});
