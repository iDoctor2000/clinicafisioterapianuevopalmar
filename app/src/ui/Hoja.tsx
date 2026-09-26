import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  abierta: boolean;
  onCerrar: () => void;
  titulo?: string;
  children: ReactNode;
  className?: string;
}

/** Panel deslizante desde abajo (móvil) / modal centrado (escritorio). */
export function Hoja({ abierta, onCerrar, titulo, children, className }: Props) {
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [abierta, onCerrar]);
  if (!abierta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onCerrar} />
      <div className={cn('relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92dvh] flex flex-col animate-[subir_.25s_ease-out]', className)}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="mx-auto sm:hidden absolute left-1/2 -translate-x-1/2 top-2 h-1.5 w-12 rounded-full bg-ink/15" />
          {titulo ? <h2 className="text-xl font-semibold mt-2">{titulo}</h2> : <span />}
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="h-11 w-11 -mr-2 rounded-full flex items-center justify-center text-ink-soft hover:bg-ink/5 tap">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-safe pb-6">{children}</div>
      </div>
      <style>{`@keyframes subir{from{transform:translateY(24px);opacity:.6}to{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
}
