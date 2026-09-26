import { Route } from 'react-router-dom';
import { Placeholder } from '@/app/Placeholder';

export const rutasTrabajador = (
  <>
    <Route index element={<Placeholder titulo="Calendario" />} />
    <Route path="clientes" element={<Placeholder titulo="Clientes" />} />
    <Route path="horarios" element={<Placeholder titulo="Horarios" />} />
    <Route path="avisos" element={<Placeholder titulo="Avisos" />} />
    <Route path="tarifas" element={<Placeholder titulo="Tarifas" />} />
    <Route path="estadisticas" element={<Placeholder titulo="Estadísticas" />} />
    <Route path="equipo" element={<Placeholder titulo="Equipo" />} />
    <Route path="ajustes" element={<Placeholder titulo="Ajustes" />} />
    <Route path="mas" element={<Placeholder titulo="Más" />} />
  </>
);
