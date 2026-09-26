import { Link } from 'react-router-dom';
import { ChevronRight, LogOut, RotateCcw } from 'lucide-react';
import { useStore } from '@/data/store';
import { tienePermiso } from '@/domain/types';
import { Boton, Tarjeta } from '@/ui';
import { itemsTrabajador } from './CapaTrabajador';
import { useTrabajador } from './useTrabajador';
import { Avatar, Encabezado, ROL_TEXTO } from './comunes';

export function Mas() {
  const { sesion, trabajador } = useTrabajador();
  const cerrar = useStore((s) => s.cerrarSesion);
  const reiniciar = useStore((s) => s.reiniciarDemo);
  const secciones = itemsTrabajador.filter((i) => !i.principal && (!i.permiso || tienePermiso(sesion, i.permiso)) && (i.to !== '/ajustes' || sesion.rol === 'ADMIN'));
  return (
    <div className="max-w-lg">
      <Encabezado titulo="Más" />
      <Tarjeta className="p-4 flex items-center gap-3 mb-4">
        <Avatar nombre={trabajador?.nombre ?? sesion.nombre} apellidos={trabajador?.apellidos} color={trabajador?.color} tamano="lg" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-lg">{trabajador ? `${trabajador.nombre} ${trabajador.apellidos}` : sesion.nombre}</div>
          <div className="text-sm text-ink-muted">{ROL_TEXTO[sesion.rol]}{trabajador?.email && ` · ${trabajador.email}`}</div>
          <div className="text-xs text-ink-muted mt-0.5">{sesion.rol === 'ADMIN' ? 'Todos los permisos' : `${sesion.permisos.length} permisos`}</div>
        </div>
      </Tarjeta>
      {secciones.length > 0 && (
        <Tarjeta className="mb-4">
          <ul className="divide-y divide-ink/5">
            {secciones.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="flex items-center gap-3 p-4 hover:bg-sand tap">
                  <span className="h-10 w-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><i.icono className="h-5 w-5" /></span>
                  <span className="flex-1 font-semibold">{i.etiqueta}</span>
                  <ChevronRight className="h-5 w-5 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
      <div className="space-y-2">
        <Boton ancho variante="secundario" onClick={cerrar}><LogOut className="h-5 w-5" /> Cerrar sesión</Boton>
        <Boton ancho variante="fantasma" tamano="sm" onClick={() => { if (confirm('¿Restaurar los datos de demostración? Se perderán los cambios.')) reiniciar(); }}><RotateCcw className="h-4 w-4" /> Restaurar datos de demo</Boton>
      </div>
    </div>
  );
}
