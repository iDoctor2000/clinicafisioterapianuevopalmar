import { Navigate, Route } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Permiso } from '@/domain/types';
import { Calendario } from './Calendario';
import { DetalleClase } from './DetalleClase';
import { Clientes, NuevoCliente } from './Clientes';
import { FichaCliente } from './FichaCliente';
import { Horarios } from './Horarios';
import { Avisos } from './Avisos';
import { Tarifas } from './Tarifas';
import { Estadisticas } from './Estadisticas';
import { Equipo } from './Equipo';
import { Ajustes } from './Ajustes';
import { Mas } from './Mas';
import { useTrabajador } from './useTrabajador';

/** Redirige al calendario si el trabajador no tiene el permiso necesario. */
function Requiere({ permiso, admin, children }: { permiso?: Permiso; admin?: boolean; children: ReactNode }) {
  const { puede, esAdmin } = useTrabajador();
  if (admin && !esAdmin) return <Navigate to="/" replace />;
  if (permiso && !puede(permiso)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const rutasTrabajador = (
  <>
    <Route index element={<Calendario />} />
    <Route path="clase/:id" element={<DetalleClase />} />
    <Route path="clientes" element={<Requiere permiso="CLIENTES_VER"><Clientes /></Requiere>} />
    <Route path="clientes/nuevo" element={<Requiere permiso="CLIENTES_EDITAR"><NuevoCliente /></Requiere>} />
    <Route path="clientes/:id" element={<Requiere permiso="CLIENTES_VER"><FichaCliente /></Requiere>} />
    <Route path="horarios" element={<Requiere permiso="HORARIOS_GESTIONAR"><Horarios /></Requiere>} />
    <Route path="avisos" element={<Requiere permiso="AVISOS_ENVIAR"><Avisos /></Requiere>} />
    <Route path="tarifas" element={<Requiere permiso="TARIFAS_GESTIONAR"><Tarifas /></Requiere>} />
    <Route path="estadisticas" element={<Requiere permiso="ESTADISTICAS_VER"><Estadisticas /></Requiere>} />
    <Route path="equipo" element={<Requiere admin><Equipo /></Requiere>} />
    <Route path="ajustes" element={<Requiere admin><Ajustes /></Requiere>} />
    <Route path="mas" element={<Mas />} />
  </>
);
