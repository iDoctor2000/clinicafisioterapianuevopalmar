import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, MoreVertical, PlusSquare, Share, X } from 'lucide-react';
import { alCambiarInstalacion, avisoSilenciado, esIpad, estaInstalada, instalarDirecto, plataforma, puedeInstalarDirecto, silenciarAviso } from '@/lib/instalacion';
import { Boton } from './Boton';
import { toast } from './Toast';
import { cn } from '@/lib/cn';

/**
 * Aviso de la primera visita para instalar la app en la pantalla de inicio (solo en móvil).
 * Android con diálogo nativo: botón "Instalar" (un toque). Android sin él: pasos del menú.
 * iPhone/iPad: pasos ilustrados con una flecha hacia el botón Compartir de Safari.
 * No aparece si ya está instalada; al cerrarlo, no vuelve en 30 días.
 */
export function AvisoInstalacion() {
  const [visible, setVisible] = useState(false);
  const [, refrescar] = useState(0);

  useEffect(() => {
    if (plataforma() === 'escritorio' || estaInstalada() || avisoSilenciado()) return;
    const t = setTimeout(() => setVisible(true), 2500);
    const baja = alCambiarInstalacion(() => {
      refrescar((n) => n + 1);
      if (estaInstalada()) setVisible(false);
    });
    return () => { clearTimeout(t); baja(); };
  }, []);

  if (!visible) return null;
  const p = plataforma();
  const cerrar = () => { silenciarAviso(); setVisible(false); };
  const directo = p === 'android' && puedeInstalarDirecto();
  const ipad = esIpad();

  const instalar = async () => {
    const r = await instalarDirecto();
    if (r === 'aceptada') { toast.ok('Instalando la app en tu móvil…'); setVisible(false); silenciarAviso(); }
  };

  return (
    <>
      {p === 'ios-safari' && (
        <div aria-hidden className={cn('fixed z-[60] pointer-events-none text-ink animate-bounce', ipad ? 'top-1 right-24' : 'bottom-1 left-1/2 -translate-x-1/2')}>
          {ipad ? <ArrowUp className="h-9 w-9 drop-shadow" /> : <ArrowDown className="h-9 w-9 drop-shadow" />}
        </div>
      )}
      <div role="dialog" aria-label="Instalar la app" className={cn('fixed inset-x-3 z-50 mx-auto max-w-md rounded-3xl bg-white shadow-lift border border-beige-200 p-4 animate-[aparecer_.3s_ease-out]', p === 'ios-safari' && !ipad ? 'bottom-12' : 'bottom-24')}>
        <button type="button" onClick={cerrar} aria-label="Cerrar" className="absolute top-2 right-2 h-9 w-9 rounded-full flex items-center justify-center text-ink-muted hover:bg-sand tap"><X className="h-5 w-5" /></button>
        <div className="flex items-start gap-3 pr-8">
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-12 w-12 rounded-2xl shrink-0 shadow-card" />
          <div className="min-w-0">
            <p className="font-semibold text-[17px] leading-tight">Ten la app en tu pantalla de inicio</p>
            <p className="text-sm text-ink-soft mt-0.5">Se abre con un toque, como cualquier app, y recibes los avisos del centro.</p>
          </div>
        </div>

        {directo && (
          <div className="mt-3 flex gap-2">
            <Boton ancho onClick={() => void instalar()}><Download className="h-5 w-5" /> Instalar</Boton>
            <Boton variante="secundario" onClick={cerrar}>Ahora no</Boton>
          </div>
        )}

        {p === 'android' && !directo && (
          <ol className="mt-3 space-y-1.5 text-[15px]">
            <li className="flex items-start gap-2"><Paso n={1} /><span className="leading-6">Toca el menú <MoreVertical className="h-4 w-4 inline align-[-3px]" /> de arriba a la derecha.</span></li>
            <li className="flex items-start gap-2"><Paso n={2} /><span className="leading-6">Elige <b>"Instalar aplicación"</b> o <b>"Añadir a pantalla de inicio"</b>.</span></li>
          </ol>
        )}

        {p === 'ios-safari' && (
          <ol className="mt-3 space-y-1.5 text-[15px]">
            <li className="flex items-start gap-2"><Paso n={1} /><span className="leading-6">Toca <Share className="h-4 w-4 inline align-[-3px] text-[#0A84FF]" /> <b>Compartir</b> {ipad ? 'arriba a la derecha' : 'abajo, en la barra de Safari'}.</span></li>
            <li className="flex items-start gap-2"><Paso n={2} /><span className="leading-6">Elige <PlusSquare className="h-4 w-4 inline align-[-3px]" /> <b>"Añadir a pantalla de inicio"</b> y toca <b>Añadir</b>.</span></li>
          </ol>
        )}

        {p === 'ios-otro' && (
          <p className="mt-3 text-[15px]">En iPhone se instala desde <b>Safari</b>: abre esta misma dirección en Safari, toca <Share className="h-4 w-4 inline align-[-3px] text-[#0A84FF]" /> <b>Compartir</b> y elige <b>"Añadir a pantalla de inicio"</b>.</p>
        )}

        {!directo && <button type="button" onClick={cerrar} className="mt-3 text-sm font-semibold text-beige-600 tap">Ahora no</button>}
      </div>
    </>
  );
}

function Paso({ n }: { n: number }) {
  return <span className="h-6 w-6 shrink-0 rounded-full bg-ink text-white text-xs font-bold flex items-center justify-center">{n}</span>;
}
