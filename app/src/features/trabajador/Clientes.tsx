import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, UserPlus, Users } from 'lucide-react';
import type { Cliente } from '@/domain/types';
import { hoyISO } from '@/domain/fechas';
import { nombreCompleto } from '@/data/selectores';
import { Boton, Chip, Entrada, Interruptor, Tarjeta, Vacio, toast } from '@/ui';
import { useTrabajador } from './useTrabajador';
import { buscarClientes, resumenCliente } from './consultas';
import { Avatar, CampoBusqueda, Encabezado, Segmentado } from './comunes';

export function Clientes() {
  const { db, puede } = useTrabajador();
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState<'ACTIVOS' | 'TODOS'>('ACTIVOS');
  const hoy = hoyISO();
  const lista = buscarClientes(db, texto, filtro === 'ACTIVOS');

  return (
    <div>
      <Encabezado
        titulo="Clientes"
        subtitulo={`${db.clientes.filter((c) => c.activo).length} activos · ${db.clientes.length} en total`}
        acciones={puede('CLIENTES_EDITAR') && <Boton tamano="sm" onClick={() => navigate('/clientes/nuevo')}><UserPlus className="h-5 w-5" /> Nuevo cliente</Boton>}
      />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <CampoBusqueda valor={texto} onCambio={setTexto} placeholder="Buscar por nombre, apellidos, DNI o teléfono" className="flex-1" />
        <Segmentado valor={filtro} onCambio={setFiltro} opciones={[{ valor: 'ACTIVOS', texto: 'Activos' }, { valor: 'TODOS', texto: 'Todos' }]} />
      </div>
      {lista.length === 0 ? (
        <Vacio icono={Users} titulo="Sin resultados" texto={texto ? 'Prueba con otro nombre, DNI o teléfono.' : 'Todavía no hay clientes.'} />
      ) : (
        <Tarjeta>
          <ul className="divide-y divide-ink/5">
            {lista.map((c) => {
              const r = resumenCliente(db, c, hoy);
              return (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="flex items-center gap-3 p-3 sm:px-4 hover:bg-sand tap">
                    <Avatar nombre={c.nombre} apellidos={c.apellidos} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">{nombreCompleto(c)}</span>
                        {!c.activo && <Chip tono="rojo">Baja</Chip>}
                      </span>
                      <span className="block text-sm text-ink-muted truncate">
                        {r.tarifa ? `${r.tarifa.nombre} · ${r.contrato?.modalidad === 'FIJO' ? 'horario fijo' : 'turno libre'}` : 'Sin tarifa activa'}
                      </span>
                    </span>
                    <span className="hidden sm:flex gap-1.5 shrink-0">
                      {r.tarifa?.tipo === 'BONO' && r.contrato && <Chip tono="cocoa">{r.contrato.sesionesRestantes ?? 0}/{r.tarifa.bono?.sesiones}</Chip>}
                      {r.recuperaciones > 0 && <Chip tono="azul">{r.recuperaciones} recup.</Chip>}
                    </span>
                    <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario de datos personales (compartido por alta y edición)
// ---------------------------------------------------------------------------

export type DatosCliente = Pick<Cliente, 'nombre' | 'apellidos' | 'dni' | 'telefono' | 'email' | 'direccion' | 'notificacionesPush' | 'activo' | 'altaEl' | 'bajaEl'>;

export function FormularioCliente({ inicial, onGuardar, textoGuardar = 'Guardar', edicion, onCancelar }: { inicial: DatosCliente; onGuardar: (d: DatosCliente) => void; textoGuardar?: string; edicion?: boolean; onCancelar?: () => void }) {
  const [d, setD] = useState<DatosCliente>(inicial);
  const set = <K extends keyof DatosCliente>(k: K, v: DatosCliente[K]) => setD((x) => ({ ...x, [k]: v }));
  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.nombre.trim() || !d.apellidos.trim()) return toast.error('Nombre y apellidos son obligatorios.');
    onGuardar({ ...d, nombre: d.nombre.trim(), apellidos: d.apellidos.trim(), dni: d.dni.trim().toUpperCase(), telefono: d.telefono.trim(), email: d.email.trim() });
  };
  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Entrada etiqueta="Nombre" value={d.nombre} onChange={(e) => set('nombre', e.target.value)} required autoComplete="off" />
        <Entrada etiqueta="Apellidos" value={d.apellidos} onChange={(e) => set('apellidos', e.target.value)} required autoComplete="off" />
        <Entrada etiqueta="DNI / NIE" value={d.dni} onChange={(e) => set('dni', e.target.value)} autoComplete="off" />
        <Entrada etiqueta="Teléfono" type="tel" value={d.telefono} onChange={(e) => set('telefono', e.target.value)} autoComplete="off" />
        <Entrada etiqueta="Correo electrónico" type="email" value={d.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
        <Entrada etiqueta="Dirección" value={d.direccion} onChange={(e) => set('direccion', e.target.value)} autoComplete="off" />
        <Entrada etiqueta="Fecha de alta" type="date" value={d.altaEl} onChange={(e) => set('altaEl', e.target.value)} />
        {edicion && <Entrada etiqueta="Fecha de baja" type="date" value={d.bajaEl ?? ''} onChange={(e) => set('bajaEl', e.target.value || null)} />}
      </div>
      <div className="divide-y divide-ink/5 rounded-2xl border border-ink/10 px-4">
        <Interruptor activo={d.notificacionesPush} onCambio={(v) => set('notificacionesPush', v)} etiqueta="Notificaciones en el móvil" descripcion="Recibe avisos del centro en la app." />
        {edicion && <Interruptor activo={d.activo} onCambio={(v) => set('activo', v)} etiqueta="Cliente activo" descripcion="Un cliente de baja no aparece en la lista principal ni recibe avisos." />}
      </div>
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        {onCancelar && <Boton type="button" variante="secundario" onClick={onCancelar}>Cancelar</Boton>}
        <Boton type="submit">{textoGuardar}</Boton>
      </div>
    </form>
  );
}

export function NuevoCliente() {
  const { ejecutar } = useTrabajador();
  const navigate = useNavigate();
  const guardar = async (d: DatosCliente) => {
    const r = await ejecutar('guardarCliente', { cliente: { ...d, clinica: { lesiones: '', patologias: '', observaciones: '', actualizadaEl: null }, userId: null } });
    if (r.ok) { toast.ok('Cliente creado.'); navigate(`/clientes/${r.valor.id}`, { replace: true }); } else toast.error(r.error);
  };
  return (
    <div className="max-w-3xl">
      <Encabezado atras="/clientes" titulo="Nuevo cliente" subtitulo="Después podrás asignarle una tarifa desde su ficha." />
      <Tarjeta className="p-4 sm:p-6">
        <FormularioCliente
          inicial={{ nombre: '', apellidos: '', dni: '', telefono: '', email: '', direccion: '', notificacionesPush: true, activo: true, altaEl: hoyISO(), bajaEl: null }}
          onGuardar={guardar} textoGuardar="Crear cliente" onCancelar={() => navigate('/clientes')}
        />
      </Tarjeta>
    </div>
  );
}
