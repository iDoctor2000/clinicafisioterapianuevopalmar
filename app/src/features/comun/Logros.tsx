/**
 * Piezas visuales de los logros: medallas, felicitación de cumpleaños y el visor de
 * "historias" de "Tu año en Pilates" / "El año del centro". Las usan la zona del alumno
 * y las vistas previas de Ajustes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CalendarCheck, Cake, Compass, Crown, Flame, Gem, Heart, Lock, Medal, Share2, Sparkles, Sprout, Star, Sunrise, Trophy, X,
  type LucideIcon,
} from 'lucide-react';
import type { EstadoMedalla, Medalla, ResumenAnual } from '@/domain/logros';
import { NOMBRE_MES, textoFalta } from '@/domain/logros';
import type { ResumenCentro } from '@/data/logros';
import { Boton, lanzarConfeti, toast } from '@/ui';
import { aPng, cargarImagen, compartirImagen, roundRect } from '@/lib/compartir';
import { cn } from '@/lib/cn';

const ICONOS: Record<string, LucideIcon> = { Sprout, Star, Sparkles, Medal, Trophy, Crown, CalendarCheck, Flame, Gem, Sunrise, Compass, Heart };
const TAM = { sm: 'h-12 w-12', md: 'h-16 w-16', lg: 'h-28 w-28' } as const;
const TAM_ICONO = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-14 w-14' } as const;
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// ---------------------------------------------------------------------------
// Medallas
// ---------------------------------------------------------------------------

/** Medalla redonda en beige con relieve (como los iconos de las actividades). En gris si falta. */
export function IconoMedalla({ medalla, conseguida = true, tamano = 'md' }: { medalla: Medalla; conseguida?: boolean; tamano?: keyof typeof TAM }) {
  const Icono = ICONOS[medalla.icono] ?? Star;
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', TAM[tamano])} aria-hidden>
      <span className={cn(
        'h-full w-full rounded-full flex items-center justify-center border',
        conseguida
          ? 'bg-gradient-to-br from-[#F7F1EA] via-beige-100 to-[#D9CCBE] border-beige-300/70 text-cocoa shadow-[0_4px_10px_-3px_rgba(58,58,58,0.35),inset_0_1px_0_rgba(255,255,255,0.85)]'
          : 'bg-brand-50 border-brand-100 text-brand-300',
      )}>
        <Icono className={TAM_ICONO[tamano]} strokeWidth={1.6} />
      </span>
      {!conseguida && <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-white border border-brand-100 flex items-center justify-center"><Lock className="h-3 w-3 text-brand-300" /></span>}
    </span>
  );
}

function fechaCorta(f: string): string {
  const [a, m, d] = f.split('-').map(Number);
  return `${d} ${MESES_CORTOS[m - 1]} ${a}`;
}

/** Cuadrícula de medallas (conseguidas en color, las que faltan en gris con la pista). */
export function Medallero({ estados }: { estados: EstadoMedalla[] }) {
  return (
    <ul className="grid grid-cols-3 sm:grid-cols-4 gap-x-2 gap-y-5">
      {estados.map((e) => (
        <li key={e.medalla.id} className="flex flex-col items-center text-center" title={e.medalla.descripcion}>
          <IconoMedalla medalla={e.medalla} conseguida={e.conseguida} />
          <span className={cn('mt-2 text-sm font-semibold leading-tight', !e.conseguida && 'text-ink-muted')}>{e.medalla.nombre}</span>
          <span className="text-xs text-ink-muted leading-tight mt-0.5">{e.conseguida ? (e.conseguidaEl ? fechaCorta(e.conseguidaEl) : 'Conseguida') : textoFalta(e)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Capa a pantalla completa para celebraciones (medallas, cumpleaños). */
function Celebracion({ children, onCerrar, etiqueta }: { children: ReactNode; onCerrar: () => void; etiqueta: string }) {
  useEffect(() => {
    lanzarConfeti();
    const t = setTimeout(() => lanzarConfeti({ piezas: 90 }), 900);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={etiqueta} className="fixed inset-0 z-[80] flex items-center justify-center p-5 bg-ink/55 backdrop-blur-sm animate-[aparecer_.35s_ease-out]">
      <div className="relative w-full max-w-sm tarjeta-marca tarjeta-marca-destacada bg-sand px-6 pt-8 pb-6 text-center overflow-hidden">
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="absolute top-3 right-3 h-10 w-10 rounded-full flex items-center justify-center text-ink-muted hover:bg-white/60 tap"><X className="h-5 w-5" /></button>
        {children}
      </div>
    </div>
  );
}

export function CelebracionMedallas({ medallas, estreno, onCerrar }: { medallas: Medalla[]; estreno?: boolean; onCerrar: () => void }) {
  const una = medallas.length === 1;
  return (
    <Celebracion onCerrar={onCerrar} etiqueta="Medalla conseguida">
      <p className="lema">{estreno ? 'Estrenamos medallas' : una ? 'Medalla conseguida' : 'Medallas conseguidas'}</p>
      <div className={cn('flex justify-center gap-3 flex-wrap mt-5', una ? '' : 'max-h-56 overflow-y-auto')}>
        {medallas.map((m) => <IconoMedalla key={m.id} medalla={m} tamano={una ? 'lg' : 'md'} />)}
      </div>
      <h2 className="font-serif text-3xl mt-5 leading-tight">{una ? `¡${medallas[0].nombre}!` : `¡Ya tienes ${medallas.length} medallas!`}</h2>
      <p className="text-ink-soft mt-2">{una ? medallas[0].descripcion : medallas.map((m) => m.nombre).join(' · ')}</p>
      <p className="text-sm text-ink-muted mt-3">Las tienes todas en tu Perfil, en "Mis logros".</p>
      <Boton ancho className="mt-6" onClick={onCerrar}>¡Genial!</Boton>
    </Celebracion>
  );
}

// ---------------------------------------------------------------------------
// Cumpleaños
// ---------------------------------------------------------------------------

export function TarjetaCumpleanos({ nombre, mensaje, onCerrar }: { nombre: string; mensaje: string; onCerrar: () => void }) {
  return (
    <Celebracion onCerrar={onCerrar} etiqueta="Feliz cumpleaños">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-full">
        {['left-[8%] [animation-delay:0s]', 'left-[78%] [animation-delay:.6s]', 'left-[46%] [animation-delay:1.2s]'].map((pos, i) => (
          <span key={i} className={cn('absolute bottom-[-3rem] text-4xl animate-[globo_6s_ease-in_infinite]', pos)}>🎈</span>
        ))}
      </div>
      <span className="relative mx-auto h-24 w-24 rounded-full bg-gradient-to-br from-[#F7F1EA] via-beige-100 to-[#D9CCBE] border border-beige-300/70 shadow-[0_6px_14px_-4px_rgba(58,58,58,0.35),inset_0_1px_0_rgba(255,255,255,0.85)] flex items-center justify-center text-cocoa">
        <Cake className="h-12 w-12" strokeWidth={1.5} />
      </span>
      <h2 className="relative font-serif text-3xl mt-5 leading-tight">¡Feliz cumpleaños, {nombre}!</h2>
      <p className="relative text-ink-soft mt-3 text-[17px] leading-relaxed">{mensaje}</p>
      <p className="relative lema mt-4">El equipo de Nuevo Palmar</p>
      <Boton ancho className="relative mt-6" onClick={onCerrar}>¡Gracias! 🎂</Boton>
    </Celebracion>
  );
}

// ---------------------------------------------------------------------------
// Cliente del mes
// ---------------------------------------------------------------------------

/**
 * Celebración del ganador. Con `preguntar`, pide si los demás alumnos pueden verlo en la
 * app (el ganador decide). `onResponder` recibe la respuesta.
 */
export function TarjetaPremioMes({ nombre, mesTexto, clases, preguntar, onResponder, onCerrar, ejemplo }: {
  nombre: string; mesTexto: string; clases: number; preguntar: boolean;
  onResponder?: (publico: boolean) => Promise<void> | void; onCerrar: () => void; ejemplo?: boolean;
}) {
  const [guardando, setGuardando] = useState<boolean | null>(null);
  const responder = async (publico: boolean) => {
    setGuardando(publico);
    try { await onResponder?.(publico); } finally { setGuardando(null); }
  };
  return (
    <Celebracion onCerrar={onCerrar} etiqueta="Cliente del mes">
      <span className="relative mx-auto h-28 w-28 rounded-full bg-gradient-to-br from-[#FBF3DF] via-[#F1DFB5] to-[#D8B978] border border-[#CFAE68]/70 shadow-[0_8px_18px_-6px_rgba(120,90,30,0.45),inset_0_1px_0_rgba(255,255,255,0.9)] flex items-center justify-center text-[#7A5A1E]">
        <Trophy className="h-14 w-14" strokeWidth={1.5} />
      </span>
      <p className="lema mt-5">Cliente del mes · {mesTexto}{ejemplo ? ' · ejemplo' : ''}</p>
      <h2 className="font-serif text-3xl mt-2 leading-tight">¡Enhorabuena, {nombre}!</h2>
      <p className="text-ink-soft mt-3 text-[17px] leading-relaxed">
        Por tu constancia en {mesTexto} ({clases} {clases === 1 ? 'clase' : 'clases'}), este mes el premio es para ti. ¡Gracias por cuidarte con nosotros! 💛
      </p>
      {preguntar ? (
        <>
          <p className="font-semibold mt-5">¿Quieres que los demás alumnos lo vean en la app?</p>
          <p className="text-sm text-ink-muted mt-1">Solo saldría tu nombre y la inicial del apellido. Tú decides.</p>
          <div className="mt-4 grid gap-2">
            <Boton ancho onClick={() => void responder(true)} cargando={guardando === true} disabled={guardando !== null}>Sí, que se vea 🎉</Boton>
            <Boton ancho variante="secundario" onClick={() => void responder(false)} cargando={guardando === false} disabled={guardando !== null}>Prefiero que no</Boton>
          </div>
        </>
      ) : (
        <Boton ancho className="mt-6" onClick={onCerrar}>¡Gracias! 🏆</Boton>
      )}
    </Celebracion>
  );
}

// ---------------------------------------------------------------------------
// Visor de historias
// ---------------------------------------------------------------------------

export interface Diapositiva {
  /** Clases de fondo (degradado de la marca). */
  fondo: string;
  /** Texto oscuro (fondos claros) o claro (fondos oscuros). */
  claro?: boolean;
  contenido: ReactNode;
}

export const FONDOS = {
  arena: 'bg-gradient-to-b from-[#F7F3EE] via-[#EDE4DB] to-[#E1D5C8]',
  beige: 'bg-gradient-to-br from-[#E1D5C8] via-[#CFC0B0] to-[#B9A795]',
  cacao: 'bg-gradient-to-br from-[#A08D79] via-[#86735F] to-[#5E5144]',
  noche: 'bg-gradient-to-b from-[#3A3A3A] via-[#2F2F2F] to-[#1E1E1E]',
  rosa: 'bg-gradient-to-br from-[#F7F1EA] via-[#EBD3CF] to-[#D9B3AC]',
};

const MS_POR_DIAPOSITIVA = 6500;

/** Historias a pantalla completa: se pasan tocando (izquierda atrás, derecha adelante) y avanzan solas. */
export function Historia({ diapositivas, onCerrar, etiqueta }: { diapositivas: Diapositiva[]; onCerrar: () => void; etiqueta: string }) {
  const [i, setI] = useState(0);
  const [inicio, setInicio] = useState(() => Date.now());
  const [, tic] = useState(0);
  const ultima = i === diapositivas.length - 1;
  useEffect(() => {
    if (ultima) return;
    const t = setInterval(() => {
      if (Date.now() - inicio >= MS_POR_DIAPOSITIVA) { setI((x) => Math.min(x + 1, diapositivas.length - 1)); setInicio(Date.now()); }
      tic((n) => n + 1);
    }, 100);
    return () => clearInterval(t);
  }, [inicio, ultima, diapositivas.length]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      if (e.key === 'ArrowRight') ir(1);
      if (e.key === 'ArrowLeft') ir(-1);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });
  const ir = (d: number) => {
    const n = i + d;
    if (n < 0) return;
    if (n >= diapositivas.length) { onCerrar(); return; }
    setI(n); setInicio(Date.now());
  };
  const d = diapositivas[i];
  const progreso = ultima ? 1 : Math.min(1, (Date.now() - inicio) / MS_POR_DIAPOSITIVA);
  return (
    <div role="dialog" aria-modal="true" aria-label={etiqueta} className="fixed inset-0 z-[80] bg-ink flex items-center justify-center">
      <div className={cn('relative h-full w-full max-w-md overflow-hidden sm:h-[92dvh] sm:rounded-[2rem] sm:shadow-2xl transition-colors duration-500', d.fondo, d.claro ? 'text-white' : 'text-ink')}>
        <div className="absolute top-0 inset-x-0 z-20 flex gap-1.5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {diapositivas.map((_, k) => (
            <span key={k} className={cn('h-1 flex-1 rounded-full overflow-hidden', d.claro ? 'bg-white/30' : 'bg-ink/15')}>
              <span className={cn('block h-full rounded-full', d.claro ? 'bg-white' : 'bg-ink/70')} style={{ width: `${k < i ? 100 : k === i ? progreso * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className={cn('absolute z-30 right-3 top-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] h-11 w-11 rounded-full flex items-center justify-center tap', d.claro ? 'text-white hover:bg-white/10' : 'text-ink hover:bg-ink/5')}><X className="h-6 w-6" /></button>
        {/* Zonas táctiles: un tercio atrás, dos tercios adelante (no tapan los botones de la última). */}
        {!ultima && (
          <>
            <button type="button" aria-label="Anterior" onClick={() => ir(-1)} className="absolute z-10 left-0 top-0 h-full w-1/3" />
            <button type="button" aria-label="Siguiente" onClick={() => ir(1)} className="absolute z-10 right-0 top-0 h-full w-2/3" />
          </>
        )}
        <div key={i} className="relative h-full flex flex-col items-center justify-center px-8 text-center animate-[aparecer_.5s_ease-out]">
          {d.contenido}
        </div>
        {ultima && diapositivas.length > 1 && (
          <button type="button" onClick={() => ir(-1)} className={cn('absolute z-20 left-4 bottom-[max(1rem,env(safe-area-inset-bottom))] text-sm font-semibold tap', d.claro ? 'text-white/80' : 'text-ink-soft')}>← Volver</button>
        )}
      </div>
    </div>
  );
}

/** Número que sube desde 0 al aparecer. */
export function NumeroAnimado({ valor, className }: { valor: number; className?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const ini = performance.now();
    const paso = (t: number) => {
      const p = Math.min(1, (t - ini) / 1400);
      setN(Math.round(valor * (1 - Math.pow(1 - p, 3))));
      if (p < 1) ref.current = requestAnimationFrame(paso);
    };
    ref.current = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(ref.current);
  }, [valor]);
  return <span className={className}>{n.toLocaleString('es-ES')}</span>;
}

const Pequeno = ({ children, claro }: { children: ReactNode; claro?: boolean }) => <p className={cn('lema', claro && '!text-white/80')}>{children}</p>;
const Titulo = ({ children }: { children: ReactNode }) => <h2 className="font-serif text-[2.1rem] leading-tight mt-4">{children}</h2>;
const Texto = ({ children, claro }: { children: ReactNode; claro?: boolean }) => <p className={cn('text-lg mt-4 leading-relaxed', claro ? 'text-white/85' : 'text-ink-soft')}>{children}</p>;
const Grande = ({ valor }: { valor: number }) => <NumeroAnimado valor={valor} className="font-serif text-[6.5rem] leading-none tracking-tight" />;

// ---------------------------------------------------------------------------
// "Tu año en Pilates"
// ---------------------------------------------------------------------------

export interface DatosResumenAlumno {
  nombre: string;
  resumen: ResumenAnual;
  actividad: string | null;
  monitor: string | null;
}

export function diapositivasResumen(d: DatosResumenAlumno, onCompartir: () => void, compartiendo: boolean, ejemplo?: boolean): Diapositiva[] {
  const r = d.resumen;
  const lista: Diapositiva[] = [
    {
      fondo: FONDOS.arena,
      contenido: (
        <>
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-14 w-14 rounded-2xl shadow-card mb-6" />
          <Pequeno>Tu {r.anio} en Pilates{ejemplo ? ' · ejemplo' : ''}</Pequeno>
          <Titulo>{d.nombre}, este año has venido a</Titulo>
          <Grande valor={r.total} />
          <p className="font-serif text-3xl">clases</p>
          <Texto>Eso son <strong>{r.horas} horas</strong> dedicadas a cuidarte. 💛</Texto>
        </>
      ),
    },
  ];
  if (d.actividad) lista.push({
    fondo: FONDOS.beige,
    contenido: (
      <>
        <Pequeno>Tu actividad favorita</Pequeno>
        <Titulo>{d.actividad}</Titulo>
        <Texto>La has elegido <strong>{r.vecesActividadFavorita} veces</strong>.{r.actividadesDistintas > 1 ? ` Y has probado ${r.actividadesDistintas} actividades distintas.` : ''}</Texto>
      </>
    ),
  });
  if (r.horaFavorita) lista.push({
    fondo: r.deMananas ? FONDOS.rosa : FONDOS.noche,
    claro: !r.deMananas,
    contenido: (
      <>
        <span className="text-6xl" aria-hidden>{r.deMananas ? '☀️' : '🌙'}</span>
        <Titulo>{r.deMananas ? 'Eres de mañanas' : 'Eres de tardes'}</Titulo>
        <Texto claro={!r.deMananas}>Tu hora favorita: <strong>las {r.horaFavorita}</strong>.{r.mesTop ? ` Y tu mes más activo fue ${NOMBRE_MES[r.mesTop - 1]}, con ${r.clasesMesTop} clases.` : ''}</Texto>
      </>
    ),
  });
  lista.push({
    fondo: FONDOS.cacao,
    claro: true,
    contenido: (
      <>
        <span className="text-6xl" aria-hidden>🔥</span>
        <Pequeno claro>Tu mejor racha</Pequeno>
        <Grande valor={r.mejorRacha} />
        <p className="font-serif text-3xl">{r.mejorRacha === 1 ? 'semana' : 'semanas seguidas'}</p>
        <Texto claro>{r.mejorRacha >= 4 ? 'Constancia de la buena. Así se nota el cambio.' : 'Cada semana cuenta. ¡A por más el año que viene!'}</Texto>
      </>
    ),
  });
  if (d.monitor && r.vecesMonitorFavorito > 1) lista.push({
    fondo: FONDOS.arena,
    contenido: (
      <>
        <span className="text-6xl" aria-hidden>🤝</span>
        <Titulo>Has compartido {r.vecesMonitorFavorito} clases con {d.monitor}</Titulo>
        <Texto>Gracias por confiar en nuestro equipo.</Texto>
      </>
    ),
  });
  lista.push({
    fondo: FONDOS.beige,
    contenido: (
      <>
        <Pequeno>Gracias por cuidarte con nosotros</Pequeno>
        <div className="mt-5 w-full max-w-[17rem] rounded-[1.75rem] bg-sand/95 shadow-card border border-beige-300/70 p-6">
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-10 w-10 rounded-xl mx-auto" />
          <p className="lema mt-3">Mi {r.anio} en Pilates</p>
          <p className="font-serif text-6xl mt-2 leading-none">{r.total}</p>
          <p className="font-serif text-xl">clases</p>
          <p className="text-sm text-ink-soft mt-3">{r.horas} horas{d.actividad ? ` · ${d.actividad}` : ''} · racha de {r.mejorRacha} sem.</p>
        </div>
        <Boton className="mt-7" onClick={onCompartir} cargando={compartiendo}><Share2 className="h-5 w-5" /> Compartir mi año</Boton>
        <p className="text-sm text-ink-soft mt-3">Si lo subes a Instagram, menciona a @pilatesnuevopalmar 😊</p>
      </>
    ),
  });
  return lista;
}

/** Imagen para compartir (formato historia de Instagram, 1080×1920). */
export async function imagenResumen(d: DatosResumenAlumno): Promise<Blob> {
  const r = d.resumen;
  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#F7F3EE'); grad.addColorStop(0.6, '#EDE4DB'); grad.addColorStop(1, '#E1D5C8');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  try {
    const logo = await cargarImagen(`${import.meta.env.BASE_URL}logo-marca.png`);
    const lw = 560, lh = (logo.height / logo.width) * lw;
    g.drawImage(logo, (W - lw) / 2, 150, lw, lh);
  } catch { /* sin logotipo */ }
  g.fillStyle = '#FFFFFF'; roundRect(g, 120, 560, W - 240, 960, 64); g.fill();
  g.strokeStyle = '#CFC0B0'; g.lineWidth = 3; roundRect(g, 120, 560, W - 240, 960, 64); g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#86735F'; g.font = '600 40px Inter, system-ui, sans-serif';
  g.fillText(`MI ${r.anio} EN PILATES`.split('').join(String.fromCharCode(8202)), W / 2, 680);
  g.fillStyle = '#2F2F2F'; g.font = '400 300px Georgia, "Playfair Display", serif';
  g.fillText(String(r.total), W / 2, 1000);
  g.font = '400 80px Georgia, "Playfair Display", serif';
  g.fillText('clases', W / 2, 1110);
  g.fillStyle = '#5C5C5C'; g.font = '400 44px Inter, system-ui, sans-serif';
  const lineas = [`${r.horas} horas cuidándome`, d.actividad ? `Mi favorita: ${d.actividad}` : '', `Mejor racha: ${r.mejorRacha} ${r.mejorRacha === 1 ? 'semana' : 'semanas'}`].filter(Boolean);
  lineas.forEach((t, k) => g.fillText(t, W / 2, 1240 + k * 80));
  g.fillStyle = '#86735F'; g.font = '600 48px Inter, system-ui, sans-serif';
  g.fillText('@pilatesnuevopalmar', W / 2, 1700);
  return aPng(c);
}

/** Visor completo de "Tu año en Pilates" con el botón de compartir ya resuelto. */
export function HistoriaResumen({ datos, onCerrar, ejemplo }: { datos: DatosResumenAlumno; onCerrar: () => void; ejemplo?: boolean }) {
  const [compartiendo, setCompartiendo] = useState(false);
  const compartir = async () => {
    setCompartiendo(true);
    try {
      const blob = await imagenResumen(datos);
      const r = await compartirImagen(blob, `mi-${datos.resumen.anio}-en-pilates.png`, `Mi ${datos.resumen.anio} en Pilates con @pilatesnuevopalmar 💛`);
      if (r === 'descargada') toast.ok('Imagen descargada. ¡Ya puedes subirla!');
    } catch {
      toast.error('No se ha podido compartir. Prueba de nuevo.');
    } finally { setCompartiendo(false); }
  };
  return <Historia etiqueta={`Tu ${datos.resumen.anio} en Pilates`} onCerrar={onCerrar} diapositivas={diapositivasResumen(datos, () => void compartir(), compartiendo, ejemplo)} />;
}

// ---------------------------------------------------------------------------
// "El año del centro" (administración)
// ---------------------------------------------------------------------------

const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function HistoriaCentro({ anio, datos, actividad, onCerrar }: { anio: number; datos: ResumenCentro; actividad: string | null; onCerrar: () => void }) {
  const diapositivas: Diapositiva[] = [
    {
      fondo: FONDOS.arena,
      contenido: (
        <>
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-14 w-14 rounded-2xl shadow-card mb-6" />
          <Pequeno>El {anio} del centro</Pequeno>
          <Titulo>Este año, entre todos, habéis hecho</Titulo>
          <Grande valor={datos.total} />
          <p className="font-serif text-3xl">asistencias</p>
          <Texto>En <strong>{datos.clases} clases</strong> y <strong>{datos.horas} horas</strong> de alumnos en sala.</Texto>
        </>
      ),
    },
    {
      fondo: FONDOS.beige,
      contenido: (
        <>
          <Pequeno>La comunidad</Pequeno>
          <Grande valor={datos.alumnos} />
          <p className="font-serif text-3xl">alumnos distintos</p>
          <Texto>han venido al menos a una clase este año.</Texto>
        </>
      ),
    },
  ];
  if (actividad && datos.actividad) diapositivas.push({
    fondo: FONDOS.cacao, claro: true,
    contenido: (<><Pequeno claro>La actividad estrella</Pequeno><Titulo>{actividad}</Titulo><Texto claro>{datos.actividad.n} asistencias.</Texto></>),
  });
  if (datos.mes) diapositivas.push({
    fondo: FONDOS.rosa,
    contenido: (
      <>
        <Pequeno>El mes con más movimiento</Pequeno>
        <Titulo>{NOMBRE_MES[datos.mes.mes - 1].replace(/^./, (x) => x.toUpperCase())}</Titulo>
        <Texto>{datos.mes.n} asistencias.{datos.dia ? ` El día más fuerte, el ${DIAS[datos.dia.dia]}` : ''}{datos.hora ? `, y la hora más pedida, las ${datos.hora.hora}.` : '.'}</Texto>
      </>
    ),
  });
  diapositivas.push({
    fondo: FONDOS.noche, claro: true,
    contenido: (<><span className="text-6xl" aria-hidden>👏</span><Titulo>¡Gracias, equipo!</Titulo><Texto claro>Detrás de cada cifra hay una persona que se siente mejor gracias a vosotros.</Texto></>),
  });
  return <Historia etiqueta={`El ${anio} del centro`} onCerrar={onCerrar} diapositivas={diapositivas} />;
}

