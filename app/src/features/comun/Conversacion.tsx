/**
 * Buzón (0052): la conversación de una consulta (burbujas) y la caja para escribir. La usan el alumno
 * (sus mensajes a la derecha) y quien atiende el buzón (los del centro a la derecha).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Send } from 'lucide-react';
import type { Consulta, MensajeConsulta } from '@/domain/types';
import { FIRMA_CENTRO, MAX_LETRAS_MENSAJE } from '@/domain/buzon';
import { Boton } from '@/ui';
import { cn } from '@/lib/cn';

/** "hoy 9:12", "ayer 21:40", "lun 16 nov, 18:05". */
export function cuandoMensaje(instante: string): string {
  const d = parseISO(instante);
  if (isToday(d)) return `hoy ${format(d, 'H:mm')}`;
  if (isYesterday(d)) return `ayer ${format(d, 'H:mm')}`;
  return format(d, "EEE d MMM, H:mm", { locale: es });
}

export function Conversacion({ consulta, lado, nombreAlumno, firmaDe }: {
  consulta: Consulta;
  /** Quién mira: sus mensajes van a la derecha. */
  lado: 'CLIENTE' | 'CENTRO';
  /** Nombre del alumno (solo lo necesita el equipo). */
  nombreAlumno?: string;
  /** Quién del equipo escribió cada respuesta (solo para el equipo). */
  firmaDe?: (m: MensajeConsulta) => string | null;
}) {
  const fin = useRef<HTMLDivElement>(null);
  const n = consulta.mensajes.length;
  useEffect(() => { fin.current?.scrollIntoView({ block: 'nearest' }); }, [n]);
  return (
    <ul className="space-y-3">
      {consulta.mensajes.map((m) => {
        const mio = m.autor === lado;
        const quien = m.autor === 'CENTRO' ? (lado === 'CENTRO' ? firmaDe?.(m) ?? FIRMA_CENTRO : FIRMA_CENTRO) : lado === 'CENTRO' ? nombreAlumno ?? 'Alumno' : 'Tú';
        return (
          <li key={m.id} className={cn('flex', mio ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5', mio ? 'bg-brand-500 text-sand rounded-br-md' : 'bg-white border border-ink/10 rounded-bl-md')}>
              <p className={cn('text-xs font-semibold mb-0.5', mio ? 'text-white/75' : 'text-ink-muted')}>{quien} · {cuandoMensaje(m.creadoEl)}</p>
              <p className="whitespace-pre-line break-words leading-relaxed">{m.texto}</p>
            </div>
          </li>
        );
      })}
      <div ref={fin} />
    </ul>
  );
}

/** Caja para escribir un mensaje, con el contador de letras cuando se acerca al límite. */
export function CajaMensaje({ onEnviar, placeholder, etiqueta = 'Enviar', pie, autoFocus }: {
  /** Devuelve true si se ha enviado (y entonces se vacía la caja). */
  onEnviar: (texto: string) => Promise<boolean>;
  placeholder: string;
  etiqueta?: string;
  pie?: ReactNode;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const quedan = MAX_LETRAS_MENSAJE - texto.length;
  const enviar = async () => {
    if (enviando || !texto.trim() || quedan < 0) return;
    setEnviando(true);
    const hecho = await onEnviar(texto);
    setEnviando(false);
    if (hecho) setTexto('');
  };
  return (
    <div>
      <textarea
        value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} rows={3} aria-label={placeholder}
        className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-[17px] leading-relaxed placeholder:text-ink-muted focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 min-h-[6rem]"
      />
      <div className="mt-2 flex items-center gap-3">
        <p className={cn('flex-1 min-w-0 text-sm font-semibold', quedan < 0 ? 'text-rose' : 'text-ink-muted')}>{quedan < 200 ? (quedan >= 0 ? `Te quedan ${quedan} letras.` : `Sobran ${-quedan} letras.`) : ''}</p>
        <Boton onClick={() => void enviar()} cargando={enviando} disabled={!texto.trim() || quedan < 0}><Send className="h-5 w-5" /> {etiqueta}</Boton>
      </div>
      {pie && <div className="mt-3 text-sm text-ink-muted">{pie}</div>}
    </div>
  );
}
