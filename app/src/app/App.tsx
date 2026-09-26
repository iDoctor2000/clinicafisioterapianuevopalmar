import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from '@/data/store';
import { Toasts } from '@/ui';
import { PantallaAcceso } from './PantallaAcceso';
import { CapaCliente } from '@/features/cliente/CapaCliente';
import { CapaTrabajador } from '@/features/trabajador/CapaTrabajador';
import { rutasCliente } from '@/features/cliente/rutas';
import { rutasTrabajador } from '@/features/trabajador/rutas';

export function App() {
  const sesion = useStore((s) => s.sesion);
  const mantenimiento = useStore((s) => s.mantenimientoDiario);
  useEffect(() => {
    mantenimiento();
  }, [mantenimiento]);

  return (
    <HashRouter>
      <Toasts />
      <Routes>
        {!sesion && <Route path="*" element={<PantallaAcceso />} />}
        {sesion?.tipo === 'CLIENTE' && (
          <Route element={<CapaCliente />}>
            {rutasCliente}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
        {sesion?.tipo === 'TRABAJADOR' && (
          <Route element={<CapaTrabajador />}>
            {rutasTrabajador}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </HashRouter>
  );
}
