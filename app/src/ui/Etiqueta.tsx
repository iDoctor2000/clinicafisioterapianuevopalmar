import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type Tono = 'verde' | 'gris' | 'azul' | 'ambar' | 'rojo' | 'cocoa';

const tonos: Record<Tono, string> = {
  verde: 'bg-brand-100 text-brand-800',
  gris: 'bg-ink/5 text-ink-soft',
  azul: 'bg-sky/10 text-sky',
  ambar: 'bg-clay/10 text-clay',
  rojo: 'bg-rose/10 text-rose',
  cocoa: 'bg-cocoa/10 text-cocoa',
};

export function Etiqueta({ tono = 'gris', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tono?: Tono }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none', tonos[tono], className)} {...rest} />;
}
