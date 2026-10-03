import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Diapositiva {
  id: string;
  url: string;
  /** Pie de foto opcional. */
  pie?: string;
}

interface Props {
  imagenes: Diapositiva[];
  /** Milisegundos entre pases automáticos. 0 = sin autoplay. */
  intervaloMs?: number;
  etiqueta?: string;
  className?: string;
}

/** Desplazamiento mínimo (px) para que un gesto cuente como deslizar. */
const UMBRAL_DESLIZAR = 40;

/**
 * Carrusel de fotos accesible: flechas grandes, puntos, deslizable con el dedo y pase
 * automático suave que se detiene en cuanto la persona lo toca (o si prefiere menos
 * movimiento). Si no hay imágenes no muestra nada.
 */
export function Carrusel({ imagenes, intervaloMs = 6000, etiqueta = 'Fotos del centro', className }: Props) {
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);
  const inicioX = useRef<number | null>(null);
  const arrastre = useRef(0);
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);
  const total = imagenes.length;

  // Si cambia la lista (p. ej. el administrador borra una foto), el índice no se sale.
  useEffect(() => {
    if (indice > total - 1) setIndice(Math.max(0, total - 1));
  }, [indice, total]);

  const ir = useCallback((i: number) => setIndice(((i % total) + total) % total), [total]);
  const manual = (i: number) => {
    setPausado(true);
    ir(i);
  };

  // Pase automático: respeta prefers-reduced-motion y se para al tocar.
  useEffect(() => {
    if (pausado || total < 2 || intervaloMs <= 0) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setIndice((i) => (i + 1) % total), intervaloMs);
    return () => clearInterval(t);
  }, [pausado, total, intervaloMs]);

  const alPulsar = (e: ReactPointerEvent) => {
    if (total < 2) return;
    setPausado(true);
    inicioX.current = e.clientX;
    arrastre.current = 0;
    setArrastrando(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const alMover = (e: ReactPointerEvent) => {
    if (inicioX.current == null) return;
    arrastre.current = e.clientX - inicioX.current;
    setDesplazamiento(arrastre.current);
  };
  const alSoltar = () => {
    if (inicioX.current == null) return;
    const dx = arrastre.current;
    inicioX.current = null;
    setArrastrando(false);
    setDesplazamiento(0);
    if (dx <= -UMBRAL_DESLIZAR) ir(indice + 1);
    else if (dx >= UMBRAL_DESLIZAR) ir(indice - 1);
  };

  if (total === 0) return null;

  return (
    <section
      className={cn('relative select-none', className)}
      role="region" aria-roledescription="carrusel" aria-label={etiqueta}
      onMouseEnter={() => setPausado(true)} onFocus={() => setPausado(true)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); manual(indice - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); manual(indice + 1); }
      }}
    >
      <div
        className="relative overflow-hidden rounded-3xl bg-beige-100 shadow-card aspect-[16/10] sm:aspect-[2/1] touch-pan-y cursor-grab active:cursor-grabbing"
        onPointerDown={alPulsar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar}
      >
        <div
          className={cn('flex h-full', !arrastrando && 'transition-transform duration-500 ease-out')}
          style={{ transform: `translateX(calc(${-indice * 100}% + ${desplazamiento}px))` }}
          aria-live={pausado ? 'polite' : 'off'}
        >
          {imagenes.map((img, i) => (
            <figure
              key={img.id} className="relative h-full w-full shrink-0 m-0"
              role="group" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${total}`} aria-hidden={i !== indice}
            >
              <img src={img.url} alt={img.pie || ''} draggable={false} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className="h-full w-full object-cover" />
              {img.pie && (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-900/70 to-transparent px-5 pt-10 pb-4 text-sand text-[15px] font-medium">
                  {img.pie}
                </figcaption>
              )}
            </figure>
          ))}
        </div>

        {total > 1 && (
          <>
            <button
              type="button" onClick={() => manual(indice - 1)} aria-label="Foto anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-sand/90 text-ink shadow-card flex items-center justify-center hover:bg-sand tap"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
            <button
              type="button" onClick={() => manual(indice + 1)} aria-label="Foto siguiente"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-sand/90 text-ink shadow-card flex items-center justify-center hover:bg-sand tap"
            >
              <ChevronRight className="h-7 w-7" />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div className="flex justify-center gap-2 mt-3" role="tablist" aria-label="Elegir foto">
          {imagenes.map((img, i) => (
            <button
              key={img.id} type="button" role="tab" aria-selected={i === indice} aria-label={`Foto ${i + 1}`}
              onClick={() => manual(i)}
              className="h-8 w-8 flex items-center justify-center rounded-full tap"
            >
              <span className={cn('block rounded-full transition-all', i === indice ? 'h-2.5 w-6 bg-brand-500' : 'h-2.5 w-2.5 bg-beige-400')} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
