import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, ClipboardList, LogOut, Settings, Tags, Users, UserCog, type LucideIcon } from 'lucide-react';
import { useStore } from '@/data/store';
import { tienePermiso, type Permiso } from '@/domain/types';
import { cn } from '@/lib/cn';

interface Item { to: string; etiqueta: string; icono: LucideIcon; permiso: Permiso | null; principal?: boolean }

const items: Item[] = [
  { to: '/', etiqueta: 'Calendario', icono: CalendarDays, permiso: null, principal: true },
  { to: '/clientes', etiqueta: 'Clientes', icono: Users, permiso: 'CLIENTES_VER', principal: true },
  { to: '/horarios', etiqueta: 'Horarios', icono: ClipboardList, permiso: 'HORARIOS_GESTIONAR', principal: true },
  { to: '/avisos', etiqueta: 'Avisos', icono: Bell, permiso: 'AVISOS_ENVIAR', principal: true },
  { to: '/tarifas', etiqueta: 'Tarifas', icono: Tags, permiso: 'TARIFAS_GESTIONAR' },
  { to: '/estadisticas', etiqueta: 'Estadísticas', icono: BarChart3, permiso: 'ESTADISTICAS_VER' },
  { to: '/equipo', etiqueta: 'Equipo', icono: UserCog, permiso: 'TRABAJADORES_GESTIONAR' },
  { to: '/ajustes', etiqueta: 'Ajustes', icono: Settings, permiso: 'TRABAJADORES_GESTIONAR' },
];

/** Estructura de la zona trabajador: menú lateral en escritorio, barra inferior + "Más" en móvil. */
export function CapaTrabajador() {
  const sesion = useStore((s) => s.sesion);
  const cerrar = useStore((s) => s.cerrarSesion);
  const loc = useLocation();
  const visibles = items.filter((i) => !i.permiso || tienePermiso(sesion, i.permiso));
  const enMovil = visibles.filter((i) => i.principal).slice(0, 4);

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <nav className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-ink/5 bg-white p-4 gap-1 sticky top-0 h-dvh">
        <div className="flex items-center gap-3 px-2 py-3 mb-4">
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-10 w-10" />
          <div className="leading-tight"><div className="font-serif text-lg">Nuevo Palmar</div><div className="text-xs text-cocoa font-semibold tracking-wide uppercase">Gestión</div></div>
        </div>
        {visibles.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex items-center gap-3 px-3 h-11 rounded-xl font-semibold', isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-sand')}>
            <i.icono className="h-5 w-5" /> {i.etiqueta}
          </NavLink>
        ))}
        <div className="mt-auto border-t border-ink/5 pt-3">
          <div className="px-3 py-2 text-sm"><div className="font-semibold">{sesion?.nombre}</div><div className="text-ink-muted">{sesion?.tipo === 'TRABAJADOR' && { ADMIN: 'Administrador', MONITOR: 'Monitor/a', RECEPCION: 'Recepción' }[sesion.rol]}</div></div>
          <button type="button" onClick={cerrar} className="flex items-center gap-3 px-3 h-11 rounded-xl font-semibold text-ink-soft hover:bg-sand w-full tap"><LogOut className="h-5 w-5" /> Salir</button>
        </div>
      </nav>

      <main key={loc.pathname} className="flex-1 min-w-0 pb-24 md:pb-8 animate-[aparecer_.2s_ease-out]">
        <div className="max-w-6xl mx-auto w-full px-4 pt-safe">
          <Outlet />
        </div>
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-ink/5 pb-safe" aria-label="Navegación principal">
        <ul className="grid grid-cols-5">
          {enMovil.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 h-16 text-[12px] font-semibold tap', isActive ? 'text-brand-600' : 'text-ink-muted')}>
                <i.icono className="h-6 w-6" /> {i.etiqueta}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/mas" className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 h-16 text-[12px] font-semibold tap', isActive ? 'text-brand-600' : 'text-ink-muted')}>
              <Settings className="h-6 w-6" /> Más
            </NavLink>
          </li>
        </ul>
      </nav>
      <style>{`@keyframes aparecer{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

export const itemsTrabajador = items;
