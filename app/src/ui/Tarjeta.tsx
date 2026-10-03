import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Tarjeta({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-white rounded-2xl shadow-card border border-ink/5', className)} {...rest} />;
}

export function TarjetaBoton({ className, ...rest }: HTMLAttributes<HTMLButtonElement> & { type?: 'button' }) {
  return (
    <button type="button" className={cn('w-full text-left bg-white rounded-2xl shadow-card border border-ink/5 tap hover:border-beige-200', className)} {...rest} />
  );
}
