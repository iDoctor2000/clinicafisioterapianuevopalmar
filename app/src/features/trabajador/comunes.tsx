import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Lock, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Cliente, EstadoReserva, OrigenReserva, Asistencia } from '@/domain/types';
import { Boton, Chip, Hoja, type Tono } from '@/ui';
import { AvatarCliente } from '@/features/comun/AvatarCliente';
import { cn } from '@/lib/cn';
import { nombreCompleto } from '@/data/selectores';

// ---------------------------------------------------------------------------
// Cabecera de página
// ---------------------------------------------------------------------------

export function Encabezado({ titulo, subtitulo, atras, acciones, children }: { titulo: ReactNode; subtitulo?: ReactNode; atras?: string; acciones?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-5 pb-4">
      <div className="flex items-start gap-3 flex-wrap">
        {atras && (
          <Link to={atras} aria-label="Volver" className="h-11 w-11 -ml-2 rounded-full flex items-center justify-center text-ink-soft hover:bg-ink/5 tap shrink-0">
            <ChevronLeft className="h-6 w-6" />
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl leading-tight">{titulo}</h1>
          {subtitulo && <p className="text-ink-muted mt-1">{subtitulo}</p>}
        </div>
        {acciones && <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">{acciones}</div>}
      </div>
      {children}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Chips de estado y origen de reserva
// ---------------------------------------------------------------------------

export const ESTADO_RESERVA: Record<EstadoReserva, { texto: string; tono: Tono }> = {
  RESERVADA: { texto: 'Reservada', tono: 'beige' },
  CANCELADA_RECUPERABLE: { texto: 'Cancelada · recuperable', tono: 'ambar' },
  CANCELADA_NO_RECUPERABLE: { texto: 'Cancelada · no recuperable', tono: 'rojo' },
  CANCELADA_CENTRO: { texto: 'Cancelada por el centro', tono: 'azul' },
};

export function ChipEstadoReserva({ estado, corto }: { estado: EstadoReserva; corto?: boolean }) {
  const e = ESTADO_RESERVA[estado];
  return <Chip tono={e.tono}>{corto ? e.texto.split(' · ')[0] : e.texto}</Chip>;
}

const ORIGEN: Partial<Record<OrigenReserva, { texto: string; tono: Tono; titulo: string }>> = {
  CLASE_SUELTA: { texto: 'CS', tono: 'cocoa', titulo: 'Clase suelta' },
  RECUPERACION: { texto: 'Recup.', tono: 'azul', titulo: 'Con recuperación' },
  BONO: { texto: 'Bono', tono: 'cocoa', titulo: 'Sesión de bono' },
  MANUAL: { texto: 'Manual', tono: 'gris', titulo: 'Añadida por el centro' },
};

export function ChipOrigen({ origen }: { origen: OrigenReserva }) {
  const o = ORIGEN[origen];
  if (!o) return null;
  return <Chip tono={o.tono} title={o.titulo}>{o.texto}</Chip>;
}

export const ASISTENCIA_TEXTO: Record<Asistencia, string> = { PENDIENTE: 'Pendiente', ASISTE: 'Asistió', NO_ASISTE: 'No asistió' };

export function ChipAsistencia({ asistencia }: { asistencia: Asistencia }) {
  if (asistencia === 'PENDIENTE') return null;
  return <Chip tono={asistencia === 'ASISTE' ? 'beige' : 'rojo'}>{ASISTENCIA_TEXTO[asistencia]}</Chip>;
}

// ---------------------------------------------------------------------------
// Ocupación
// ---------------------------------------------------------------------------

export function BarraOcupacion({ ocupadas, plazas, className }: { ocupadas: number; plazas: number; className?: string }) {
  const pct = plazas > 0 ? Math.min(100, Math.round((ocupadas / plazas) * 100)) : 0;
  const color = pct >= 100 ? 'bg-rose' : pct >= 75 ? 'bg-beige-600' : 'bg-beige-400';
  return (
    <div className={cn('h-1.5 rounded-full bg-ink/10 overflow-hidden', className)} role="progressbar" aria-valuenow={ocupadas} aria-valuemax={plazas}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PuntoColor({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block h-3 w-3 rounded-full shrink-0', className)} style={{ backgroundColor: color }} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Avatares y personas
// ---------------------------------------------------------------------------

/** El avatar (foto o iniciales) vive en `@/ui/Avatar`; `AvatarCliente` resuelve la foto del cliente según el modo. */
export { Avatar } from '@/ui/Avatar';
export { AvatarCliente } from '@/features/comun/AvatarCliente';

// ---------------------------------------------------------------------------
// Pestañas y segmentados
// ---------------------------------------------------------------------------

export function Segmentado<T extends string>({ opciones, valor, onCambio, className, tamano = 'md' }: { opciones: { valor: T; texto: ReactNode }[]; valor: T; onCambio: (v: T) => void; className?: string; tamano?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded-2xl bg-sand-deep p-1', className)} role="tablist">
      {opciones.map((o) => (
        <button
          key={o.valor} type="button" role="tab" aria-selected={valor === o.valor} onClick={() => onCambio(o.valor)}
          className={cn('flex-1 rounded-xl font-semibold flex items-center justify-center gap-1.5 tap whitespace-nowrap', tamano === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4', valor === o.valor ? 'bg-white shadow-card text-ink' : 'text-ink-soft')}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Pestanas<T extends string>({ items, activa, onCambio }: { items: { valor: T; texto: string; icono?: ReactNode }[]; activa: T; onCambio: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-ink/10 -mx-4 px-4 md:mx-0 md:px-0" role="tablist">
      {items.map((i) => (
        <button
          key={i.valor} type="button" role="tab" aria-selected={activa === i.valor} onClick={() => onCambio(i.valor)}
          className={cn('h-12 px-3 md:px-4 font-semibold whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 tap', activa === i.valor ? 'border-brand-500 text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
        >
          {i.icono}{i.texto}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloques informativos
// ---------------------------------------------------------------------------

export function BloqueRestringido({ texto = 'Tu perfil no tiene permiso para consultar la información clínica de los clientes.' }: { texto?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 bg-sand p-6 flex flex-col items-center text-center">
      <span className="h-12 w-12 rounded-2xl bg-ink/5 text-ink-soft flex items-center justify-center mb-3"><Lock className="h-6 w-6" /></span>
      <p className="font-semibold">Información clínica restringida</p>
      <p className="text-sm text-ink-muted mt-1 max-w-sm">{texto}</p>
    </div>
  );
}

export function Dato({ etiqueta, children, className }: { etiqueta: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{etiqueta}</div>
      <div className="mt-0.5 font-medium break-words">{children || <span className="text-ink-muted font-normal">—</span>}</div>
    </div>
  );
}

export function Seccion({ titulo, acciones, children, className }: { titulo: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-lg font-semibold font-sans">{titulo}</h2>
        {acciones}
      </div>
      {children}
    </section>
  );
}

export function Plegable({ titulo, resumen, children, abiertoInicial = false }: { titulo: string; resumen?: ReactNode; children: ReactNode; abiertoInicial?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink/5">
      <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="w-full flex items-center justify-between gap-3 px-4 h-14 text-left tap">
        <span className="font-semibold">{titulo}</span>
        <span className="flex items-center gap-2 text-sm text-ink-muted">{resumen}<ChevronLeft className={cn('h-5 w-5 transition-transform', abierto ? 'rotate-90' : '-rotate-90')} /></span>
      </button>
      {abierto && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmación
// ---------------------------------------------------------------------------

export function Confirmacion({ abierta, onCerrar, titulo, children, textoConfirmar = 'Confirmar', peligro, onConfirmar, deshabilitado }: { abierta: boolean; onCerrar: () => void; titulo: string; children: ReactNode; textoConfirmar?: string; peligro?: boolean; onConfirmar: () => void; deshabilitado?: boolean }) {
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo={titulo}>
      <div className="text-ink-soft space-y-3">{children}</div>
      <div className="flex flex-col-reverse sm:flex-row gap-2 mt-6">
        <Boton variante="secundario" onClick={onCerrar} className="sm:flex-1">Volver</Boton>
        <Boton variante={peligro ? 'peligro' : 'primario'} onClick={onConfirmar} disabled={deshabilitado} className="sm:flex-1">{textoConfirmar}</Boton>
      </div>
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Buscador de clientes (selector)
// ---------------------------------------------------------------------------

export function BuscadorClientes({ clientes, onElegir, placeholder = 'Buscar por nombre, apellidos, DNI o teléfono', autoFocus, excluirIds = [], renderExtra }: { clientes: Cliente[]; onElegir: (c: Cliente) => void; placeholder?: string; autoFocus?: boolean; excluirIds?: string[]; renderExtra?: (c: Cliente) => ReactNode }) {
  const [texto, setTexto] = useState('');
  const q = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const lista = clientes
    .filter((c) => !excluirIds.includes(c.id))
    .filter((c) => !q || `${c.nombre} ${c.apellidos}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q) || c.dni.toLowerCase().includes(q) || c.telefono.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
    .slice(0, 30);
  return (
    <div>
      <CampoBusqueda valor={texto} onCambio={setTexto} placeholder={placeholder} autoFocus={autoFocus} />
      <ul className="mt-2 divide-y divide-ink/5 max-h-72 overflow-y-auto rounded-2xl border border-ink/10">
        {lista.length === 0 && <li className="p-4 text-ink-muted text-center">Ningún cliente coincide.</li>}
        {lista.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onElegir(c)} className="w-full flex items-center gap-3 p-3 hover:bg-sand tap text-left">
              <AvatarCliente cliente={c} tamano="sm" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{nombreCompleto(c)}</span>
                <span className="block text-sm text-ink-muted truncate">{[c.telefono, c.dni].filter(Boolean).join(' · ')}</span>
              </span>
              {renderExtra?.(c)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CampoBusqueda({ valor, onCambio, placeholder, autoFocus, className }: { valor: string; onCambio: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string }) {
  return (
    <label className={cn('relative block', className)}>
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-muted pointer-events-none" />
      <input
        type="search" value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder}
        className="w-full h-12 rounded-2xl border border-ink/10 bg-white pl-12 pr-4 text-ink placeholder:text-ink-muted focus:border-beige-500 focus:ring-4 focus:ring-beige-100 outline-none"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------

/** "26/09/2026 10:32" */
export function instanteCorto(iso: string): string {
  try { return format(new Date(iso), 'dd/MM/yyyy HH:mm'); } catch { return iso; }
}

/** "26 sep 2026" */
export function fechaMedia(fecha: string): string {
  try { return format(parseISO(fecha), 'd MMM yyyy', { locale: es }); } catch { return fecha; }
}

/** "26/09/2026" */
export function fechaNumerica(fecha: string): string {
  try { return format(parseISO(fecha), 'dd/MM/yyyy'); } catch { return fecha; }
}

export const ROL_TEXTO = { ADMIN: 'Administrador', MONITOR: 'Monitor/a', RECEPCION: 'Recepción' } as const;

export function euros(centimos: number | null): string {
  if (centimos == null) return 'Consultar';
  return `${(centimos / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function Fila({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const base = cn('w-full flex items-center gap-3 p-3 text-left', onClick && 'hover:bg-sand tap', className);
  return onClick ? <button type="button" onClick={onClick} className={base}>{children}</button> : <div className={base}>{children}</div>;
}

/** Primera letra en mayúscula ("sábado 26 de septiembre" → "Sábado 26 de septiembre"). */
export function may(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
