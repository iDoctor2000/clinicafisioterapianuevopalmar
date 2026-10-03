import { useCallback, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Bell, CalendarDays, ClipboardList, LogOut, Settings, ShieldCheck, Tags, Users, UserCog, type LucideIcon } from 'lucide-react';
import { useStore } from '@/data/store';
import { tienePermiso, type Permiso, type Sesion } from '@/domain/types';
import { CabeceraCapa, MenuLateral, type ItemMenu } from '@/ui';
import { Avatar } from '@/ui/Avatar';
import { cn } from '@/lib/cn';

interface Item { to: string; etiqueta: string; icono: LucideIcon; permiso: Permiso | null; principal?: boolean; /** Solo para el rol ADMIN (equipo y ajustes). */ soloAdmin?: boolean }

const items: Item[] = [
  { to: '/', etiqueta: 'Calendario', icono: CalendarDays, permiso: null, principal: true },
  { to: '/clientes', etiqueta: 'Clientes', icono: Users, permiso: 'CLIENTES_VER', principal: true },
  { to: '/horarios', etiqueta: 'Horarios', icono: ClipboardList, permiso: 'HORARIOS_GESTIONAR', principal: true },
  { to: '/avisos', etiqueta: 'Avisos', icono: Bell, permiso: 'AVISOS_ENVIAR', principal: true },
  { to: '/tarifas', etiqueta: 'Tarifas', icono: Tags, permiso: 'TARIFAS_GESTIONAR' },
  { to: '/estadisticas', etiqueta: 'Estadísticas', icono: BarChart3, permiso: 'ESTADISTICAS_VER' },
  { to: '/equipo', etiqueta: 'Equipo', icono: UserCog, permiso: null, soloAdmin: true },
  { to: '/ajustes', etiqueta: 'Ajustes', icono: Settings, permiso: null, soloAdmin: true },
];

const ROL = { ADMIN: 'Administrador', MONITOR: 'Monitor/a', RECEPCION: 'Recepción' } as const;

/** Un item es visible si el trabajador tiene su permiso y, si es solo para ADMIN, tiene ese rol. */
export function itemVisible(item: Item, sesion: Sesion | null): boolean {
  if (item.soloAdmin && !(sesion?.tipo === 'TRABAJADOR' && sesion.rol === 'ADMIN')) return false;
  return !item.permiso || tienePermiso(sesion, item.permiso);
}

/**
 * Estructura de la zona trabajador: cabecera con menú desplegable (todas las secciones),
 * menú lateral fijo en escritorio, barra inferior + "Más" en móvil.
 */
export function CapaTrabajador() {
  const sesion = useStore((s) => s.sesion);
  const db = useStore((s) => s.db);
  const cerrar = useStore((s) => s.cerrarSesion);
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const cerrarMenu = useCallback(() => setMenu(false), []);
  const visibles = items.filter((i) => itemVisible(i, sesion));
  const enMovil = visibles.filter((i) => i.principal).slice(0, 4);
  const trabajador = sesion?.tipo === 'TRABAJADOR' ? db.trabajadores.find((t) => t.id === sesion.trabajadorId) : undefined;
  const rol = sesion?.tipo === 'TRABAJADOR' ? ROL[sesion.rol] : '';

  const itemsMenu: ItemMenu[] = [
    ...visibles.map((i): ItemMenu => ({ to: i.to, etiqueta: i.etiqueta, icono: i.icono, end: i.to === '/' })),
    { to: '/privacidad', etiqueta: 'Política de privacidad', icono: ShieldCheck, separador: true },
    { etiqueta: 'Cerrar sesión', icono: LogOut, onClick: () => void cerrar() },
  ];

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <nav className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-beige-200 bg-white p-4 gap-1 sticky top-0 h-dvh">
        <div className="flex items-center gap-3 px-2 py-3 mb-4">
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-10 w-10 rounded-xl" />
          <div className="leading-tight"><div className="font-serif text-lg">Nuevo Palmar</div><div className="lema">Gestión</div></div>
        </div>
        {visibles.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex items-center gap-3 px-3 h-11 rounded-xl font-semibold', isActive ? 'bg-beige-100 text-ink' : 'text-ink-soft hover:bg-sand')}>
            <i.icono className="h-5 w-5" /> {i.etiqueta}
          </NavLink>
        ))}
        <div className="mt-auto border-t border-beige-200 pt-3">
          <div className="px-3 py-2 text-sm"><div className="font-semibold">{sesion?.nombre}</div><div className="text-ink-muted">{rol}</div></div>
          <button type="button" onClick={() => void cerrar()} className="flex items-center gap-3 px-3 h-11 rounded-xl font-semibold text-ink-soft hover:bg-sand w-full tap"><LogOut className="h-5 w-5" /> Salir</button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <CabeceraCapa
          zona="Gestión" onMenu={() => setMenu(true)} menuAbierto={menu}
          derecha={sesion && (
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-right leading-tight"><div className="text-sm font-semibold">{sesion.nombre}</div><div className="text-xs text-ink-muted">{rol}</div></div>
              <Avatar nombre={trabajador?.nombre ?? sesion.nombre} apellidos={trabajador?.apellidos} color={trabajador?.color} tamano="sm" />
            </div>
          )}
        />
        <main key={loc.pathname} className="flex-1 min-w-0 pb-24 md:pb-8 animate-[aparecer_.2s_ease-out]">
          <div className="max-w-6xl mx-auto w-full px-4">
            <Outlet />
          </div>
        </main>
      </div>

      <MenuLateral
        abierto={menu} onCerrar={cerrarMenu} items={itemsMenu} zona="Gestión"
        cabecera={sesion && (
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
            <Avatar nombre={trabajador?.nombre ?? sesion.nombre} apellidos={trabajador?.apellidos} color={trabajador?.color} tamano="md" />
            <div className="min-w-0"><div className="font-semibold truncate">{trabajador ? `${trabajador.nombre} ${trabajador.apellidos}` : sesion.nombre}</div><div className="text-sm text-ink-muted">{rol}</div></div>
          </div>
        )}
      />

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-beige-200 pb-safe" aria-label="Navegación principal">
        <ul className="grid grid-cols-5">
          {enMovil.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 h-16 text-[12px] font-semibold tap', isActive ? 'text-ink' : 'text-ink-muted')}>
                {({ isActive }) => (
                  <>
                    <span className={cn('h-8 w-12 rounded-full flex items-center justify-center', isActive && 'bg-beige-100')}><i.icono className="h-6 w-6" /></span>
                    {i.etiqueta}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink to="/mas" className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 h-16 text-[12px] font-semibold tap', isActive ? 'text-ink' : 'text-ink-muted')}>
              {({ isActive }) => (
                <>
                  <span className={cn('h-8 w-12 rounded-full flex items-center justify-center', isActive && 'bg-beige-100')}><Settings className="h-6 w-6" /></span>
                  Más
                </>
              )}
            </NavLink>
          </li>
        </ul>
      </nav>
      <style>{`@keyframes aparecer{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

export const itemsTrabajador = items;
