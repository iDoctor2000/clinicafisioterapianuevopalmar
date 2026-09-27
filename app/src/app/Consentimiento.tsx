import { useState } from 'react';
import { ChevronRight, LogOut, ShieldCheck } from 'lucide-react';
import { useStore } from '@/data/store';
import { Boton, Tarjeta, toast } from '@/ui';
import { EnlacePrivacidad, TextoConsentimiento } from './Privacidad';

/**
 * Casilla grande con el texto de consentimiento (docs/PRIVACIDAD.md) y enlace a la política.
 * Se usa al crear la contraseña (PantallaAcceso) y en la pantalla intermedia de consentimiento.
 */
export function CasillaConsentimiento({ aceptado, onCambio }: { aceptado: boolean; onCambio: (v: boolean) => void }) {
  return (
    <label className={`flex items-start gap-3 rounded-2xl border-2 p-4 cursor-pointer tap ${aceptado ? 'border-brand-400 bg-brand-50/60' : 'border-ink/10 bg-white'}`}>
      <input type="checkbox" checked={aceptado} onChange={(e) => onCambio(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-brand-500" required />
      <span className="text-[15px] leading-relaxed text-ink-soft">
        <TextoConsentimiento />
        <span className="block mt-2"><EnlacePrivacidad>Leer la política de privacidad completa</EnlacePrivacidad></span>
      </span>
    </label>
  );
}

/**
 * Pantalla intermedia (solo modo SUPABASE): un cliente sin consentimiento registrado la ve al
 * entrar, por cualquier vía (Google, contraseña, sesión guardada), antes de llegar a la app.
 */
export function Consentimiento() {
  const sesion = useStore((s) => s.sesion);
  const ejecutar = useStore((s) => s.ejecutar);
  const cerrarSesion = useStore((s) => s.cerrarSesion);
  const [aceptado, setAceptado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const aceptar = async () => {
    if (!aceptado) return;
    setEnviando(true);
    const r = await ejecutar('registrarConsentimiento', {});
    setEnviando(false);
    if (!r.ok) toast.error(r.error);
    // Si va bien, la instantánea recargada ya trae consentimientoEl y App deja pasar al cliente.
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="pt-safe px-6 pt-10 pb-6 text-center">
        <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-20 w-20 mx-auto mb-4" />
        <h1 className="text-3xl leading-tight">Nuevo Palmar <span className="text-brand-600">Pilates</span></h1>
        <p className="text-ink-muted mt-2">Hola, {sesion?.nombre}. Un último paso antes de entrar.</p>
      </header>
      <main className="flex-1 px-4 pb-10 max-w-lg w-full mx-auto">
        <Tarjeta className="p-5 sm:p-6 space-y-4">
          <p className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-6 w-6 text-brand-600" /> Tu privacidad</p>
          <p className="text-ink-soft text-[15px]">Para usar la app necesitamos tu consentimiento para tratar tus datos. Léelo y marca la casilla.</p>
          <CasillaConsentimiento aceptado={aceptado} onCambio={setAceptado} />
          <Boton tamano="lg" ancho disabled={!aceptado} cargando={enviando} onClick={aceptar}>Aceptar y continuar <ChevronRight className="h-5 w-5" /></Boton>
          <Boton tamano="lg" ancho variante="fantasma" onClick={() => void cerrarSesion()}><LogOut className="h-5 w-5" /> Salir sin aceptar</Boton>
        </Tarjeta>
      </main>
    </div>
  );
}
