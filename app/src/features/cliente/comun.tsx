/** Piezas de interfaz compartidas por las pantallas del cliente. */
import { useState, type ReactNode } from 'react';
import { CalendarDays, Clock, User, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useStore } from '@/data/store';
import type { ReservaVista } from '@/data/selectores';
import { clasificarCancelacion, puedeCancelarCliente } from '@/domain/rules';
import { fechaLarga, horaFin } from '@/domain/fechas';
import { Boton, Chip, Hoja, Tarjeta, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { chipEstado, chipOrigen } from './estados';
import { cap } from './consultas';

// ---------------------------------------------------------------------------
// Estructura de página
// ---------------------------------------------------------------------------

export function Encabezado({ titulo, subtitulo, children }: { titulo: string; subtitulo?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-6 pb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl leading-tight">{titulo}</h1>
        {subtitulo && <p className="text-ink-soft mt-1">{subtitulo}</p>}
      </div>
      {children}
    </header>
  );
}

export function Seccion({ titulo, accion, children, className }: { titulo: string; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-6', className)}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xl">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

export function Pestanas<T extends string>({ valor, onCambio, items }: { valor: T; onCambio: (v: T) => void; items: { id: T; etiqueta: string; contador?: number }[] }) {
  return (
    <div className="flex rounded-2xl bg-sand-deep p-1 mb-4" role="tablist">
      {items.map((i) => (
        <button
          key={i.id} role="tab" aria-selected={valor === i.id} onClick={() => onCambio(i.id)}
          className={cn('flex-1 h-11 px-1.5 sm:px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 tap text-[14px] sm:text-base', valor === i.id ? 'bg-white shadow-card text-ink' : 'text-ink-soft')}
        >
          <span className="truncate">{i.etiqueta}</span>
          {i.contador != null && i.contador > 0 && (
            <span className={cn('h-6 min-w-6 px-1.5 rounded-full text-xs font-bold flex items-center justify-center shrink-0', valor === i.id ? 'bg-beige-100 text-ink' : 'bg-white text-ink-soft')}>{i.contador}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Punto de color de una actividad. */
export function PuntoActividad({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-3 w-3 rounded-full shrink-0', className)} style={{ backgroundColor: color }} />;
}

export function BarraProgreso({ valor, total, className }: { valor: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((valor / total) * 100))) : 0;
  return (
    <div className={cn('h-3 w-full rounded-full bg-sand-deep overflow-hidden', className)} role="progressbar" aria-valuenow={valor} aria-valuemin={0} aria-valuemax={total}>
      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Aviso en línea (explicación de un bloqueo o confirmación). */
export function Nota({ tono, children }: { tono: 'ok' | 'aviso' | 'info'; children: ReactNode }) {
  const Icono = tono === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl px-4 py-3 text-[16px] leading-snug',
      tono === 'ok' && 'bg-beige-100 text-ink', tono === 'aviso' && 'bg-clay/10 text-cocoa', tono === 'info' && 'bg-sky/10 text-ink')}>
      <Icono className="h-5 w-5 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

/** Tarjeta de una reserva (lista de "Mis clases"). */
export function TarjetaReserva({ vista, ahora, onCancelar }: { vista: ReservaVista; ahora: Date; onCancelar?: (v: ReservaVista) => void }) {
  const { reserva, clase, actividad, monitor } = vista;
  const estado = chipEstado(reserva, clase, ahora);
  const origen = chipOrigen(reserva);
  const cancelada = reserva.estado !== 'RESERVADA' || clase.estado === 'CANCELADA';
  const puedeCancelar = onCancelar && puedeCancelarCliente(clase, reserva.estado, ahora).ok;
  return (
    <Tarjeta className={cn('p-4', cancelada && 'bg-white/70')}>
      <div className="flex items-start gap-3">
        <div className={cn('w-[4.25rem] shrink-0 text-center rounded-xl py-2', cancelada ? 'bg-sand-deep text-ink-muted' : 'bg-beige-100 text-ink')}>
          <div className="text-xl font-bold leading-none">{clase.horaInicio}</div>
          <div className="text-xs mt-1">{clase.duracionMin} min</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <PuntoActividad color={actividad.color} />
            <span className={cn('font-semibold text-lg truncate', cancelada && 'line-through text-ink-soft')}>{actividad.nombre}</span>
          </div>
          <div className="text-ink-soft">{cap(fechaLarga(clase.fecha))}</div>
          {monitor && <div className="text-sm text-ink-muted">Con {monitor.nombre}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tono={estado.tono}>{estado.texto}</Chip>
            {origen && <Chip tono={origen.tono}>{origen.texto}</Chip>}
          </div>
        </div>
      </div>
      {puedeCancelar && (
        <Boton variante="secundario" ancho className="mt-3" onClick={() => onCancelar(vista)}>Cancelar mi plaza</Boton>
      )}
    </Tarjeta>
  );
}

/**
 * Hoja de confirmación para cancelar una reserva. Explica si será recuperable
 * según la antelación y ejecuta el comando `cancelarReserva`.
 */
export function HojaCancelar({ vista, onCerrar }: { vista: ReservaVista | null; onCerrar: () => void }) {
  const db = useStore((s) => s.db);
  const ejecutar = useStore((s) => s.ejecutar);
  const [enviando, setEnviando] = useState(false);
  if (!vista) return null;
  const { reserva, clase, actividad, monitor } = vista;
  const ahora = new Date();
  const clasif = clasificarCancelacion(clase, ahora, db.config);
  const limite = db.config.minutosAntelacionCancelacion;
  const limiteTxt = limite % 60 === 0 ? `${limite / 60} ${limite === 60 ? 'hora' : 'horas'}` : `${limite} minutos`;

  let explicacion: ReactNode;
  if (clasif.recuperable) {
    if (reserva.origen === 'RECUPERACION') explicacion = `Cancelas con más de ${limiteTxt} de antelación: te devolveremos la recuperación que usaste para reservar.`;
    else if (reserva.origen === 'BONO') explicacion = `Cancelas con más de ${limiteTxt} de antelación: te devolveremos la sesión a tu bono.`;
    else explicacion = `Si cancelas ahora, con más de ${limiteTxt} de antelación, podrás recuperar esta clase otro día.`;
  } else {
    explicacion = `Quedan menos de ${limite} minutos para la clase: si cancelas no podrás recuperarla, pero avisarás al monitor.`;
  }

  const confirmar = async () => {
    setEnviando(true);
    const r = await ejecutar('cancelarReserva', { reservaId: reserva.id });
    setEnviando(false);
    if (r.ok) {
      toast.ok(r.valor.recuperable ? 'Plaza cancelada. Tienes una clase para recuperar.' : 'Plaza cancelada. Hemos avisado al monitor.');
      onCerrar();
    } else {
      toast.error(r.error);
    }
  };

  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Cancelar mi plaza">
      <div className="flex items-center gap-2 text-ink-soft"><PuntoActividad color={actividad.color} />{actividad.nombre}</div>
      <ul className="mt-2 space-y-1.5 text-[17px]">
        <li className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-beige-600" /> {cap(fechaLarga(clase.fecha))}</li>
        <li className="flex items-center gap-2"><Clock className="h-5 w-5 text-beige-600" /> De {clase.horaInicio} a {horaFin(clase.horaInicio, clase.duracionMin)}</li>
        {monitor && <li className="flex items-center gap-2"><User className="h-5 w-5 text-beige-600" /> Con {monitor.nombre} {monitor.apellidos}</li>}
      </ul>
      <div className="mt-4">
        <Nota tono={clasif.recuperable ? 'ok' : 'aviso'}>{explicacion}</Nota>
      </div>
      <div className="mt-5 grid gap-2">
        <button
          type="button" onClick={confirmar} disabled={enviando}
          className="h-14 w-full rounded-2xl bg-rose text-white text-lg font-semibold tap disabled:opacity-50 hover:bg-rose/90"
        >
          Sí, cancelar mi plaza
        </button>
        <Boton variante="secundario" tamano="lg" ancho onClick={onCerrar}>No, mantener mi plaza</Boton>
      </div>
    </Hoja>
  );
}
