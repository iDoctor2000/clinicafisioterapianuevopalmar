import { Route } from 'react-router-dom';
import { Inicio } from './Inicio';
import { Horario } from './Horario';
import { MisClases } from './MisClases';
import { Avisos } from './Avisos';
import { Perfil } from './Perfil';

export const rutasCliente = (
  <>
    <Route index element={<Inicio />} />
    <Route path="horario" element={<Horario />} />
    <Route path="reservas" element={<MisClases />} />
    <Route path="avisos" element={<Avisos />} />
    <Route path="perfil" element={<Perfil />} />
  </>
);
