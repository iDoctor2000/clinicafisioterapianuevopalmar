import { useState } from 'react';
import { cn } from '@/lib/cn';

export type TamanoAvatar = 'sm' | 'md' | 'lg' | 'xl';

const TAMANOS: Record<TamanoAvatar, string> = {
  sm: 'h-9 w-9 text-sm',
  md: 'h-11 w-11 text-base',
  lg: 'h-16 w-16 text-2xl',
  xl: 'h-28 w-28 text-4xl',
};

export interface AvatarProps {
  nombre: string;
  apellidos?: string;
  /** Color de acento (equipo): fondo suave y texto en ese color. */
  color?: string;
  tamano?: TamanoAvatar;
  /** URL lista para `<img>` (data URL, URL firmada…). Si falta o falla al cargar, se muestran las iniciales. */
  fotoUrl?: string | null;
  className?: string;
}

/**
 * Avatar circular común a la zona cliente y a la del personal: foto si la hay,
 * si no, iniciales sobre fondo suave. Borde fino para separar la foto del fondo.
 */
export function Avatar({ nombre, apellidos, color, tamano = 'md', fotoUrl, className }: AvatarProps) {
  const [rota, setRota] = useState<string | null>(null);
  const ini = `${nombre[0] ?? ''}${apellidos?.[0] ?? ''}`.toUpperCase();
  const nombreCompleto = [nombre, apellidos].filter(Boolean).join(' ');
  const base = cn('rounded-full shrink-0 overflow-hidden ring-1 ring-ink/10', TAMANOS[tamano], className);
  if (fotoUrl && rota !== fotoUrl) {
    return (
      <span className={cn(base, 'bg-sand-deep block')}>
        <img
          src={fotoUrl} alt={nombreCompleto ? `Foto de ${nombreCompleto}` : 'Foto'} loading="lazy" decoding="async" draggable={false}
          className="h-full w-full object-cover" onError={() => setRota(fotoUrl)}
        />
      </span>
    );
  }
  return (
    <span
      className={cn(base, 'font-bold flex items-center justify-center', !color && 'bg-beige-100 text-ink')}
      style={color ? { backgroundColor: `${color}22`, color } : undefined}
      aria-label={nombreCompleto || undefined} role={nombreCompleto ? 'img' : undefined}
    >
      {ini}
    </span>
  );
}
