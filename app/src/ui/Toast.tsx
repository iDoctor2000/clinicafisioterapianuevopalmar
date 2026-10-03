import { create } from 'zustand';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tipo = 'ok' | 'error' | 'info';
interface T { id: number; tipo: Tipo; texto: string }
interface Estado { items: T[]; mostrar: (tipo: Tipo, texto: string) => void; quitar: (id: number) => void }

export const useToast = create<Estado>((set) => ({
  items: [],
  mostrar: (tipo, texto) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, tipo, texto }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), tipo === 'error' ? 5000 : 3200);
  },
  quitar: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  ok: (t: string) => useToast.getState().mostrar('ok', t),
  error: (t: string) => useToast.getState().mostrar('error', t),
  info: (t: string) => useToast.getState().mostrar('info', t),
};

const iconos = { ok: CheckCircle2, error: AlertCircle, info: Info };

export function Toasts() {
  const items = useToast((s) => s.items);
  const quitar = useToast((s) => s.quitar);
  return (
    <div className="fixed top-3 left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none pt-safe" aria-live="polite">
      {items.map((i) => {
        const Icono = iconos[i.tipo];
        return (
          <button
            type="button" key={i.id} onClick={() => quitar(i.id)}
            className={cn('pointer-events-auto flex items-start gap-3 max-w-md w-full rounded-2xl px-4 py-3 shadow-2xl text-left text-[15px] font-medium',
              i.tipo === 'ok' && 'bg-brand-600 text-sand', i.tipo === 'error' && 'bg-rose text-white', i.tipo === 'info' && 'bg-beige-600 text-white')}
          >
            <Icono className="h-5 w-5 mt-0.5 shrink-0" />
            <span>{i.texto}</span>
          </button>
        );
      })}
    </div>
  );
}
