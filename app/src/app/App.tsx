import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '@/data/store';
import { Boton, Tarjeta, Toasts } from '@/ui';
import { PantallaAcceso } from './PantallaAcceso';
import { CapaCliente } from '@/features/cliente/CapaCliente';
import { CapaTrabajador } from '@/features/trabajador/CapaTrabajador';
import { rutasCliente } from '@/features/cliente/rutas';
import { rutasTrabajador } from '@/features/trabajador/rutas';

export function App() {
  const sesion = useStore((s) => s.sesion);
  const cargando = useStore((s) => s.cargando);
  const errorCarga = useStore((s) => s.errorCarga);
  const recuperandoContrasena = useStore((s) => s.recuperandoContrasena);
  const arrancar = useStore((s) => s.arrancar);
  useEffect(() => {
    void arrancar();
  }, [arrancar]);

  if (cargando) return <PantallaCarga />;
  if (errorCarga) return <PantallaError mensaje={errorCarga} reintentar={() => void arrancar()} />;
  const mostrarAcceso = !sesion || recuperandoContrasena;

  return (
    <HashRouter>
      <Toasts />
      <Routes>
        {mostrarAcceso && <Route path="*" element={<PantallaAcceso />} />}
        {!mostrarAcceso && sesion?.tipo === 'CLIENTE' && (
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

function PantallaCarga() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 text-center" aria-busy="true">
      <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-20 w-20 mb-4" />
      <h1 className="text-2xl leading-tight">Nuevo Palmar <span className="text-brand-600">Pilates</span></h1>
      <p className="text-ink-muted mt-4 flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Cargando…</p>
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
