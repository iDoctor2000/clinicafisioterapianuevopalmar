import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function Vacio({ icono: Icono, titulo, texto, accion }: { icono: LucideIcon; titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      <div className="h-16 w-16 rounded-3xl bg-brand-50 text-brand-500 flex items-center justify-center mb-4">
        <Icono className="h-8 w-8" />
      </div>
      <p className="text-lg font-semibold">{titulo}</p>
      {texto && <p className="text-ink-muted mt-1 max-w-xs">{texto}</p>}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}
