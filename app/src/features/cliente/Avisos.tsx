import { useState } from 'react';
import { Bell, BellRing, ChevronRight } from 'lucide-react';
import { useStore } from '@/data/store';
import { avisosDeCliente } from '@/data/selectores';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Chip, Hoja, Tarjeta, Vacio } from '@/ui';
import { cn } from '@/lib/cn';
import { useCliente } from './useCliente';
import { cap, fechaRelativa } from './consultas';
import { Encabezado } from './comun';

export function Avisos() {
  const { db, cliente } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const ahora = new Date();
  const avisos = avisosDeCliente(db, cliente.id);
  const noLeidos = avisos.filter((a) => !a.leido).length;
  const abierto = abiertoId ? avisos.find((a) => a.aviso.id === abiertoId) ?? null : null;

  const abrir = async (id: string) => {
    setAbiertoId(id);
    await ejecutar('marcarAvisoLeido', { avisoId: id });
  };

  return (
    <div>
      <Encabezado titulo="Avisos" subtitulo={noLeidos === 0 ? 'Estás al día.' : noLeidos === 1 ? 'Tienes 1 aviso sin leer.' : `Tienes ${noLeidos} avisos sin leer.`} />

      {avisos.length === 0 ? (
        <Tarjeta><Vacio icono={Bell} titulo="No tienes avisos" texto="Aquí verás los mensajes del centro: cambios de horario, clases canceladas y novedades." /></Tarjeta>
      ) : (
        <ul className="space-y-3">
          {avisos.map(({ aviso, leido }) => (
            <li key={aviso.id}>
              <button
                type="button" onClick={() => abrir(aviso.id)}
                className={cn('w-full text-left bg-white rounded-2xl shadow-card border tap p-4 flex items-start gap-3 hover:border-brand-200', leido ? 'border-ink/5' : 'border-brand-300')}
              >
                <span className={cn('h-11 w-11 rounded-full flex items-center justify-center shrink-0', leido ? 'bg-sand-deep text-ink-muted' : 'bg-brand-50 text-brand-600')}>
                  {leido ? <Bell className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    {!leido && <span className="h-2.5 w-2.5 rounded-full bg-brand-500 shrink-0" aria-label="No leído" />}
                    <span>{cap(fechaRelativa(aviso.publicadoEl, ahora))}</span>
                    {aviso.importante && <Chip tono="rojo">Importante</Chip>}
                  </span>
                  <span className={cn('block text-lg leading-snug mt-0.5', leido ? 'font-medium text-ink-soft' : 'font-semibold')}>{aviso.titulo}</span>
                  <span className="block text-ink-muted text-[15px] mt-0.5 line-clamp-2">{aviso.cuerpo}</span>
                </span>
                <ChevronRight className="h-5 w-5 text-ink-muted shrink-0 mt-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <Hoja abierta onCerrar={() => setAbiertoId(null)} titulo="Aviso">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>{cap(format(parseISO(abierto.aviso.publicadoEl), "EEEE d 'de' MMMM, HH:mm", { locale: es }))}</span>
            {abierto.aviso.importante && <Chip tono="rojo">Importante</Chip>}
          </div>
          <h3 className="text-2xl font-semibold mt-2 leading-tight">{abierto.aviso.titulo}</h3>
          <p className="mt-3 text-[17px] leading-relaxed whitespace-pre-line">{abierto.aviso.cuerpo}</p>
        </Hoja>
      )}
    </div>
  );
}
