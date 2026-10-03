import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ItemMenu {
  /** Ruta de la sección. Si no hay, es una acción (`onClick`). */
  to?: string;
  etiqueta: string;
  icono: LucideIcon;
  onClick?: () => void | Promise<void>;
  /** Coincidencia exacta de ruta (para '/'). */
  end?: boolean;
  /** Contador (avisos sin leer). */
  contador?: number;
  /** Separador visual encima del elemento. */
  separador?: boolean;
}

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  items: ItemMenu[];
  /** Cabecera del panel (nombre de la persona, rol…). */
  cabecera?: ReactNode;
  /** Texto bajo el logotipo ("Pilates", "Gestión"). */
  zona: string;
}

/**
 * Panel lateral (drawer) con todas las secciones: se abre desde el botón de
 * hamburguesa de la cabecera, marca la sección activa y se cierra al tocar fuera,
 * con Escape o al navegar.
 */
export function MenuLateral({ abierto, onCerrar, items, cabecera, zona }: Props) {
  const loc = useLocation();
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const [montado, setMontado] = useState(abierto);

  // Cierra al navegar.
  const rutaRef = useRef(loc.pathname);
  useEffect(() => {
    if (rutaRef.current !== loc.pathname) {
      rutaRef.current = loc.pathname;
      if (abierto) onCerrar();
    }
  }, [loc.pathname, abierto, onCerrar]);

  // Escape, bloqueo del scroll y foco inicial.
  useEffect(() => {
    if (!abierto) return;
    setMontado(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const antes = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      antes?.focus?.();
    };
  }, [abierto, onCerrar]);

  // Mantiene el panel montado unos ms al cerrar para la animación de salida.
  useEffect(() => {
    if (abierto) return;
    const t = setTimeout(() => setMontado(false), 200);
    return () => clearTimeout(t);
  }, [abierto]);

  if (!montado) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menú de secciones">
      <div className={cn('absolute inset-0 bg-brand-900/50 backdrop-blur-[2px] transition-opacity duration-200', abierto ? 'opacity-100' : 'opacity-0')} onClick={onCerrar} />
      <nav
        className={cn(
          'absolute inset-y-0 left-0 w-80 max-w-[86vw] bg-sand shadow-2xl flex flex-col transition-transform duration-200 ease-out pt-safe',
          abierto ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Todas las secciones"
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-11 w-11 rounded-xl" />
          <div className="leading-tight flex-1 min-w-0">
            <div className="font-serif text-lg text-ink">Nuevo Palmar</div>
            <div className="lema">{zona}</div>
          </div>
          <button ref={cerrarRef} type="button" onClick={onCerrar} aria-label="Cerrar menú" className="h-11 w-11 -mr-1 rounded-full flex items-center justify-center text-ink-soft hover:bg-beige-100 tap">
            <X className="h-6 w-6" />
          </button>
        </div>
        {cabecera && <div className="px-4 pb-3">{cabecera}</div>}
        <ul className="flex-1 overflow-y-auto px-3 pb-safe pb-4 space-y-0.5">
          {items.map((i) => (
            <li key={i.to ?? i.etiqueta} className={cn(i.separador && 'mt-2 pt-2 border-t border-beige-200')}>
              {i.to ? (
                <NavLink
                  to={i.to} end={i.end}
                  className={({ isActive }) => cn('flex items-center gap-3 px-3 h-12 rounded-xl font-semibold tap', isActive ? 'bg-brand-500 text-sand' : 'text-ink hover:bg-beige-100')}
                >
                  {({ isActive }) => (
                    <>
                      <i.icono className="h-5 w-5 shrink-0" />
                      <span className="flex-1 truncate">{i.etiqueta}</span>
                      {i.contador != null && i.contador > 0 && <span className="h-6 min-w-6 px-1.5 rounded-full bg-rose text-white text-xs font-bold flex items-center justify-center">{i.contador}</span>}
                      {isActive && <span className="sr-only">(sección actual)</span>}
                    </>
                  )}
                </NavLink>
              ) : (
                <button type="button" onClick={() => { onCerrar(); void i.onClick?.(); }} className="w-full flex items-center gap-3 px-3 h-12 rounded-xl font-semibold text-ink hover:bg-beige-100 tap text-left">
                  <i.icono className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{i.etiqueta}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Botón de hamburguesa de la cabecera. */
export function BotonMenu({ onClick, abierto }: { onClick: () => void; abierto: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-label="Abrir menú de secciones" aria-expanded={abierto} aria-haspopup="dialog"
      className="h-11 w-11 -ml-2 rounded-full flex items-center justify-center text-ink hover:bg-beige-100 tap"
    >
      <Menu className="h-6 w-6" />
    </button>
  );
}

/**
 * Cabecera común de las dos zonas: hamburguesa a la izquierda (móvil y escritorio),
 * monograma y nombre del centro; a la derecha lo que pase cada zona.
 */
export function CabeceraCapa({ zona, onMenu, menuAbierto, derecha }: { zona: string; onMenu: () => void; menuAbierto: boolean; derecha?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 bg-sand/90 backdrop-blur border-b border-beige-200 pt-safe">
      <div className="max-w-6xl mx-auto w-full px-4 h-14 flex items-center gap-2">
        <BotonMenu onClick={onMenu} abierto={menuAbierto} />
        <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-9 w-9 rounded-lg" />
        <div className="leading-none min-w-0">
          <div className="font-serif text-[17px] text-ink truncate">Nuevo Palmar</div>
          <div className="lema text-[10px] mt-0.5">{zona}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">{derecha}</div>
      </div>
    </header>
  );
}
