import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '@/data/store';
import { Boton, Tarjeta, Toasts } from '@/ui';
import { PantallaAcceso } from './PantallaAcceso';
import { Privacidad } from './Privacidad';
import { Consentimiento } from './Consentimiento';
import { CapaCliente } from '@/features/cliente/CapaCliente';
import { CapaTrabajador } from '@/features/trabajador/CapaTrabajador';
import { rutasCliente } from '@/features/cliente/rutas';
import { rutasTrabajador } from '@/features/trabajador/rutas';

export function App() {
  const sesion = useStore((s) => s.sesion);
  const modo = useStore((s) => s.modo);
  const db = useStore((s) => s.db);
  const cargando = useStore((s) => s.cargando);
  const errorCarga = useStore((s) => s.errorCarga);
  const recuperandoContrasena = useStore((s) => s.recuperandoContrasena);
  const arrancar = useStore((s) => s.arrancar);
  useEffect(() => {
    void arrancar();
  }, [arrancar]);

  // Pantalla de arranque: aparece en fundido, se mantiene un mínimo de 1,3 s y se desvanece al tener los datos.
  const [minimoSplash, setMinimoSplash] = useState(true);
  const [splashMontado, setSplashMontado] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setMinimoSplash(false), 1300);
    return () => clearTimeout(t);
  }, []);
  const splashSaliendo = !cargando && !minimoSplash;
  useEffect(() => {
    if (!splashSaliendo) {
      setSplashMontado(true);
      return;
    }
    const t = setTimeout(() => setSplashMontado(false), 800);
    return () => clearTimeout(t);
  }, [splashSaliendo]);

  const splash = splashMontado ? <PantallaCarga saliendo={splashSaliendo} /> : null;
  if (cargando) return splash;
  if (errorCarga) return <><PantallaError mensaje={errorCarga} reintentar={() => void arrancar()} />{splash}</>;
  const mostrarAcceso = !sesion || recuperandoContrasena;
  // En producción, un cliente que aún no ha aceptado la política de privacidad (por cualquier vía de
  // acceso: contraseña, Google, sesión guardada) pasa antes por la pantalla de consentimiento.
  const cliente = sesion?.tipo === 'CLIENTE' ? db.clientes.find((c) => c.id === sesion.clienteId) : undefined;
  const pedirConsentimiento = !mostrarAcceso && modo === 'SUPABASE' && sesion?.tipo === 'CLIENTE' && !!cliente && cliente.consentimientoEl == null;

  return (
    <HashRouter>
      {splash}
      <Toasts />
      <Routes>
        {/* Política de privacidad: legible sin sesión y con cualquier sesión. */}
        <Route path="/privacidad" element={<Privacidad />} />
        {mostrarAcceso && <Route path="*" element={<PantallaAcceso />} />}
        {pedirConsentimiento && <Route path="*" element={<Consentimiento />} />}
        {!mostrarAcceso && !pedirConsentimiento && sesion?.tipo === 'CLIENTE' && (
          <Route element={<CapaCliente />}>
            {rutasCliente}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
        {!mostrarAcceso && sesion?.tipo === 'TRABAJADOR' && (
          <Route element={<CapaTrabajador />}>
            {rutasTrabajador}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </HashRouter>
  );
}

/** Pantalla de arranque a pantalla completa: logotipo con fundido de entrada y de salida. */
function PantallaCarga({ saliendo }: { saliendo: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-[100] bg-sand flex flex-col items-center justify-center px-6 text-center transition-opacity duration-[800ms] ease-out ${saliendo ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      aria-busy={!saliendo}
      aria-label="Cargando"
    >
      <img src={`${import.meta.env.BASE_URL}logo-marca.png`} alt="Nuevo Palmar Pilates" className={`w-60 sm:w-72 max-w-full splash-logo ${saliendo ? 'splash-logo-out' : ''}`} />
      {!saliendo && <p className="text-ink-muted mt-8 flex items-center gap-2 text-sm animate-[aparecer_.6s_ease-out_1s_both]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>}
    </div>
  );
}

function PantallaError({ mensaje, reintentar }: { mensaje: string; reintentar: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4">
      <Toasts />
      <Tarjeta className="p-6 max-w-md w-full text-center space-y-4">
        <AlertTriangle className="h-12 w-12 mx-auto text-clay" />
        <p className="text-lg font-semibold">No se han podido cargar los datos</p>
        <p className="text-ink-muted text-sm break-words">{mensaje}</p>
        <Boton tamano="lg" ancho onClick={reintentar}><RefreshCw className="h-5 w-5" /> Reintentar</Boton>
      </Tarjeta>
    </div>
  );
}
