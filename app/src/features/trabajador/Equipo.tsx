import { useState } from 'react';
import { Building2, GraduationCap, Plus, ShieldCheck } from 'lucide-react';
import type { Ambito, Permiso, RolTrabajador, Trabajador } from '@/domain/types';
import { AMBITO_DESCRIPCION, AMBITO_LABEL, PERMISOS, PERMISO_LABEL } from '@/domain/types';
import { Boton, Chip, Entrada, Hoja, Interruptor, Seleccion, Tarjeta, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { Avatar, Encabezado, ROL_TEXTO } from './comunes';

const COLORES = ['#548C2F', '#3B82C4', '#C9713F', '#D95A6A', '#6E2818', '#7FB356', '#8A98A6'];

export function Equipo() {
  const { db } = useTrabajador();
  const [edicion, setEdicion] = useState<Trabajador | 'NUEVO' | null>(null);
  return (
    <div>
      <Encabezado titulo="Equipo" subtitulo="Trabajadores del centro, sus permisos y su ámbito. Solo el administrador gestiona esta sección." acciones={<Boton tamano="sm" onClick={() => setEdicion('NUEVO')}><Plus className="h-5 w-5" /> Nuevo trabajador</Boton>} />
      <Tarjeta>
        <ul className="divide-y divide-ink/5">
          {db.trabajadores.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setEdicion(t)} className={cn('w-full flex items-center gap-3 p-3 sm:px-4 text-left hover:bg-sand tap', !t.activo && 'opacity-60')}>
                <Avatar nombre={t.nombre} apellidos={t.apellidos} color={t.color} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{t.nombre} {t.apellidos}</span>{!t.activo && <Chip tono="rojo">Inactivo</Chip>}</span>
                  <span className="block text-sm text-ink-muted truncate">{t.email}{t.telefono && ` · ${t.telefono}`}</span>
                  <span className="flex gap-1.5 flex-wrap mt-1.5 sm:hidden"><ChipsTrabajador t={t} /></span>
                </span>
                <span className="hidden sm:flex gap-1.5 shrink-0 flex-wrap justify-end"><ChipsTrabajador t={t} /></span>
              </button>
            </li>
          ))}
        </ul>
      </Tarjeta>
      {edicion && <HojaTrabajador trabajador={edicion === 'NUEVO' ? null : edicion} onCerrar={() => setEdicion(null)} />}
    </div>
  );
}

function ChipsTrabajador({ t }: { t: Trabajador }) {
  return (
    <>
      <Chip tono={t.rol === 'ADMIN' ? 'cocoa' : 'gris'}>{ROL_TEXTO[t.rol]}</Chip>
      {t.esMonitor && t.rol !== 'MONITOR' && <Chip tono="verde">Imparte clases</Chip>}
      {t.rol !== 'ADMIN' && t.ambito === 'SUS_CLASES' && <Chip tono="ambar"><GraduationCap className="h-3.5 w-3.5" /> Solo sus clases</Chip>}
      <Chip tono="azul"><ShieldCheck className="h-3.5 w-3.5" /> {t.rol === 'ADMIN' ? 'todos' : t.permisos.length} permisos</Chip>
    </>
  );
}

const AMBITOS: { valor: Ambito; icono: typeof Building2 }[] = [
  { valor: 'CENTRO', icono: Building2 },
  { valor: 'SUS_CLASES', icono: GraduationCap },
];

/** Radio grande "Ámbito": sobre qué clases actúan los permisos del trabajador. */
function SelectorAmbito({ valor, onCambio, esAdmin }: { valor: Ambito; onCambio: (a: Ambito) => void; esAdmin: boolean }) {
  return (
    <div>
      <span className="block text-[15px] font-semibold mb-0.5">Ámbito</span>
      <p className="text-sm text-ink-muted mb-2">Sobre qué clases y alumnos actúan sus permisos.</p>
      <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Ámbito">
        {AMBITOS.map((a) => {
          const activo = valor === a.valor;
          return (
            <button
              key={a.valor} type="button" role="radio" aria-checked={activo} disabled={esAdmin} onClick={() => onCambio(a.valor)}
              className={cn('text-left rounded-2xl border p-4 flex gap-3 tap', activo ? 'border-brand-400 bg-brand-50' : 'border-ink/10 bg-white hover:border-brand-300', esAdmin && 'opacity-60 cursor-not-allowed')}
            >
              <span className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', activo ? 'bg-brand-500 text-white' : 'bg-sand text-ink-soft')}><a.icono className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block font-semibold">{AMBITO_LABEL[a.valor]}</span>
                <span className="block text-sm text-ink-muted">{AMBITO_DESCRIPCION[a.valor]}</span>
              </span>
            </button>
          );
        })}
      </div>
      {esAdmin && <p className="text-xs text-ink-muted mt-1.5">El administrador siempre tiene ámbito «Todo el centro».</p>}
    </div>
  );
}

function HojaTrabajador({ trabajador, onCerrar }: { trabajador: Trabajador | null; onCerrar: () => void }) {
  const { ejecutar, sesion } = useTrabajador();
  const [f, setF] = useState<Omit<Trabajador, 'id'>>(trabajador ?? { nombre: '', apellidos: '', email: '', telefono: '', rol: 'RECEPCION', permisos: ['CLIENTES_VER', 'RESERVAS_GESTIONAR', 'ASISTENCIA_REGISTRAR'], ambito: 'CENTRO', esMonitor: false, color: COLORES[1], activo: true, userId: null });
  const esYo = trabajador?.id === sesion.trabajadorId;
  const alternar = (p: Permiso) => setF({ ...f, permisos: f.permisos.includes(p) ? f.permisos.filter((x) => x !== p) : [...f.permisos, p] });
  const guardar = async () => {
    if (!f.nombre.trim() || !f.email.trim()) return toast.error('Nombre y correo son obligatorios.');
    if (esYo && f.rol !== 'ADMIN' && trabajador?.rol === 'ADMIN') return toast.error('No puedes quitarte a ti mismo el rol de administrador.');
    const r = await ejecutar('guardarTrabajador', { trabajador: { ...f, id: trabajador?.id, nombre: f.nombre.trim(), apellidos: f.apellidos.trim(), email: f.email.trim(), ambito: f.rol === 'ADMIN' ? 'CENTRO' : f.ambito } });
    if (r.ok) { toast.ok('Trabajador guardado.'); onCerrar(); } else toast.error(r.error);
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={trabajador ? 'Editar trabajador' : 'Nuevo trabajador'} className="sm:max-w-2xl">
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Entrada etiqueta="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          <Entrada etiqueta="Apellidos" value={f.apellidos} onChange={(e) => setF({ ...f, apellidos: e.target.value })} />
          <Entrada etiqueta="Correo electrónico" ayuda="Será su usuario de acceso" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Entrada etiqueta="Teléfono" type="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} />
          <Seleccion etiqueta="Rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as RolTrabajador })}>
            {(Object.keys(ROL_TEXTO) as RolTrabajador[]).map((r) => <option key={r} value={r}>{ROL_TEXTO[r]}</option>)}
          </Seleccion>
          <div>
            <span className="block text-[15px] font-semibold mb-1.5">Color</span>
            <div className="flex gap-2 flex-wrap">{COLORES.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={cn('h-10 w-10 rounded-full tap', f.color === c && 'ring-4 ring-ink/30 ring-offset-2')} style={{ backgroundColor: c }} />)}</div>
          </div>
        </div>
        <div className="rounded-2xl border border-ink/10 px-4 divide-y divide-ink/5">
          <Interruptor activo={f.esMonitor} onCambio={(v) => setF({ ...f, esMonitor: v })} etiqueta="Imparte clases" descripcion="Aparece como monitor/a en horarios y clases." />
          <Interruptor activo={f.activo} onCambio={(v) => setF({ ...f, activo: v })} etiqueta="Activo" descripcion="Un trabajador inactivo no puede acceder." />
        </div>
        <SelectorAmbito valor={f.rol === 'ADMIN' ? 'CENTRO' : f.ambito} onCambio={(a) => setF({ ...f, ambito: a })} esAdmin={f.rol === 'ADMIN'} />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[15px] font-semibold">Permisos</span>
            {f.rol !== 'ADMIN' && <span className="flex gap-1"><Boton variante="fantasma" tamano="sm" onClick={() => setF({ ...f, permisos: [...PERMISOS] })}>Todos</Boton><Boton variante="fantasma" tamano="sm" onClick={() => setF({ ...f, permisos: [] })}>Ninguno</Boton></span>}
          </div>
          {f.rol === 'ADMIN' ? (
            <p className="rounded-2xl bg-brand-50 text-brand-800 p-3 text-sm flex gap-2"><ShieldCheck className="h-5 w-5 shrink-0" /> El administrador tiene todos los permisos siempre, incluida la configuración del centro.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-1.5">
              {PERMISOS.map((p) => (
                <label key={p} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer', f.permisos.includes(p) ? 'border-brand-300 bg-brand-50' : 'border-ink/10 bg-white')}>
                  <input type="checkbox" className="h-5 w-5 accent-brand-500 shrink-0" checked={f.permisos.includes(p)} onChange={() => alternar(p)} />
                  <span className="text-sm font-medium">{PERMISO_LABEL[p]}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <Boton ancho onClick={guardar}>{trabajador ? 'Guardar cambios' : 'Crear trabajador'}</Boton>
      </div>
    </Hoja>
  );
}
