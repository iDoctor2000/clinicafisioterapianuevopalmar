import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const base = 'w-full rounded-2xl border border-ink/10 bg-white px-4 text-ink placeholder:text-ink-muted focus:border-brand-400 focus:ring-4 focus:ring-brand-100 outline-none';

export function Etiqueta({ children, ayuda }: { children: ReactNode; ayuda?: string }) {
  return (
    <span className="block mb-1.5">
      <span className="text-[15px] font-semibold text-ink">{children}</span>
      {ayuda && <span className="block text-sm text-ink-muted">{ayuda}</span>}
    </span>
  );
}

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { etiqueta?: string; ayuda?: string }>(
  function Entrada({ etiqueta, ayuda, className, ...rest }, ref) {
    return (
      <label className="block">
        {etiqueta && <Etiqueta ayuda={ayuda}>{etiqueta}</Etiqueta>}
        <input ref={ref} className={cn(base, 'h-12', className)} {...rest} />
      </label>
    );
  },
);

export const Seleccion = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { etiqueta?: string; ayuda?: string }>(
  function Seleccion({ etiqueta, ayuda, className, children, ...rest }, ref) {
    return (
      <label className="block">
        {etiqueta && <Etiqueta ayuda={ayuda}>{etiqueta}</Etiqueta>}
        <select ref={ref} className={cn(base, 'h-12 appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2720%27 height=%2720%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%235B6B7B%27 stroke-width=%272%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-no-repeat bg-[right_1rem_center] pr-10', className)} {...rest}>
          {children}
        </select>
      </label>
    );
  },
);

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { etiqueta?: string; ayuda?: string }>(
  function AreaTexto({ etiqueta, ayuda, className, ...rest }, ref) {
    return (
      <label className="block">
        {etiqueta && <Etiqueta ayuda={ayuda}>{etiqueta}</Etiqueta>}
        <textarea ref={ref} className={cn(base, 'py-3 min-h-[6rem]', className)} {...rest} />
      </label>
    );
  },
);

export function Interruptor({ activo, onCambio, etiqueta, descripcion }: { activo: boolean; onCambio: (v: boolean) => void; etiqueta: string; descripcion?: string }) {
  return (
    <button type="button" role="switch" aria-checked={activo} onClick={() => onCambio(!activo)} className="w-full flex items-center justify-between gap-4 py-3 text-left tap">
      <span>
        <span className="block font-semibold">{etiqueta}</span>
        {descripcion && <span className="block text-sm text-ink-muted">{descripcion}</span>}
      </span>
      <span className={cn('relative h-8 w-14 rounded-full transition-colors shrink-0', activo ? 'bg-brand-500' : 'bg-ink/20')}>
        <span className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform', activo ? 'translate-x-7' : 'translate-x-1')} />
      </span>
    </button>
  );
}
