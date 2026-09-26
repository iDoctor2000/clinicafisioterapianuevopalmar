import { Route } from 'react-router-dom';
import { Placeholder } from '@/app/Placeholder';

export const rutasCliente = (
  <>
    <Route index element={<Placeholder titulo="Inicio" />} />
    <Route path="horario" element={<Placeholder titulo="Horario" />} />
    <Route path="reservas" element={<Placeholder titulo="Mis clases" />} />
    <Route path="avisos" element={<Placeholder titulo="Avisos" />} />
    <Route path="perfil" element={<Placeholder titulo="Perfil" />} />
  </>
);
