import { useCallback, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, CalendarDays, CircleHelp, Globe, Home, LogOut, ShieldCheck, Ticket, UserCircle2 } from 'lucide-react';
import { useStore } from '@/data/store';
import { avisosNoLeidos } from '@/data/selectores';
import { CabeceraCapa, MenuLateral, manualAyuda, type ItemMenu } from '@/ui';
import { AvatarCliente } from '@/features/comun/AvatarCliente';
import { cn } from '@/lib/cn';
import { abrirWebClinica } from '@/lib/webClinica';
import { Celebraciones } from './Celebraciones';

const items = [
  { to: '/', etiqueta: 'Inicio', icono: Home },
  { to: '/horario', etiqueta: 'Horario', icono: CalendarDays },
  { to: '/reservas', etiqueta: 'Mis clases', icono: Ticket },
  { to: '/avisos', etiqueta: 'Avisos', icono: Bell },
  { to: '/perfil', etiqueta: 'Perfil', icono: UserCircle2 },
];

/**
 * Estructura de la zona cliente: cabecera con menú desplegable (todas las secciones),
 * barra inferior grande y clara (móvil) y menú lateral fijo (escritorio).
 */
export function CapaCliente() {
  const db = useStore((s) => s.db);
  const sesion = useStore((s) => s.sesion);
  const cerrar = useStore((s) => s.cerrarSesion);
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const cerrarMenu = useCallback(() => setMenu(false), []);
  const noLeidos = sesion?.tipo === 'CLIENTE' ? avisosNoLeidos(db, sesion.clienteId) : 0;
  const cliente = sesion?.tipo === 'CLIENTE' ? db.clientes.find((c) => c.id === sesion.clienteId) : undefined;

  const itemsMenu: ItemMenu[] = [
    ...items.map((i): ItemMenu => ({ to: i.to, etiqueta: i.etiqueta, icono: i.icono, end: i.to === '/', contador: i.to === '/avisos' ? noLeidos : undefined })),
    { etiqueta: 'Clínica Nuevo Palmar', icono: Globe, separador: true, onClick: () => abrirWebClinica() },
    { etiqueta: 'Manual de ayuda', icono: CircleHelp, onClick: () => { window.open(manualAyuda('cliente'), '_blank', 'noopener'); } },
    { to: '/privacidad', etiqueta: 'Política de privacidad', icono: ShieldCheck },
    { etiqueta: 'Cerrar sesión', icono: LogOut, onClick: () => void cerrar() },
  ];

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      <nav className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-beige-200 bg-white p-4 gap-1 sticky top-0 h-dvh">
        <div className="flex items-center gap-3 px-2 py-3 mb-4">
          <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-10 w-10 rounded-xl" />
          <div className="leading-tight"><div className="font-serif text-lg">Nuevo Palmar</div><div className="lema">Pilates</div></div>
        </div>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('flex items-center gap-3 px-3 h-12 rounded-xl font-semibold', isActive ? 'bg-beige-100 text-ink' : 'text-ink-soft hover:bg-sand')}>
            <i.icono className="h-5 w-5" /> {i.etiqueta}
            {i.to === '/avisos' && noLeidos > 0 && <span className="ml-auto h-6 min-w-6 px-1.5 rounded-full bg-rose text-white text-xs font-bold flex items-center justify-center">{noLeidos}</span>}
          </NavLink>
        ))}
        <div className="mt-auto border-t border-beige-200 pt-3">
          <button type="button" onClick={() => void cerrar()} className="flex items-center gap-3 px-3 h-11 rounded-xl font-semibold text-ink-soft hover:bg-sand w-full tap"><LogOut className="h-5 w-5" /> Salir</button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <CabeceraCapa zona="Pilates" onMenu={() => setMenu(true)} menuAbierto={menu} ayuda={manualAyuda('cliente')} />
        <main key={loc.pathname} className="flex-1 min-w-0 pb-24 md:pb-8 animate-[aparecer_.2s_ease-out]">
          <div className="max-w-3xl mx-auto w-full px-4">
            <Outlet />
            {sesion?.tipo === 'CLIENTE' && cliente && <Celebraciones />}
          </div>
        </main>
      </div>

      <MenuLateral
        abierto={menu} onCerrar={cerrarMenu} items={itemsMenu} zona="Pilates"
        cabecera={cliente && (
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-card">
            <AvatarCliente cliente={cliente} tamano="md" />
            <div className="min-w-0"><div className="font-semibold truncate">{cliente.nombre} {cliente.apellidos}</div><div className="text-sm text-ink-muted">Cliente</div></div>
          </div>
        )}
      />

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-beige-200 pb-safe" aria-label="Navegación principal">
        <ul className="grid grid-cols-5">
          {items.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.to === '/'} className={({ isActive }) => cn('relative flex flex-col items-center justify-center gap-1 h-16 text-[12px] font-semibold tap', isActive ? 'text-ink' : 'text-ink-muted')}>
                {({ isActive }) => (
                  <>
                    <span className={cn('h-8 w-12 rounded-full flex items-center justify-center', isActive && 'bg-beige-100')}><i.icono className="h-6 w-6" /></span>
                    {i.etiqueta}
                    {i.to === '/avisos' && noLeidos > 0 && <span className="absolute top-2 right-1/2 translate-x-4 h-5 min-w-5 px-1 rounded-full bg-rose text-white text-[11px] font-bold flex items-center justify-center">{noLeidos}</span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <style>{`@keyframes aparecer{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
