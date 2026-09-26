import { useState } from 'react';
import { CalendarOff, History, Plus, Save, Settings, Trash2 } from 'lucide-react';
import type { DiaCierre } from '@/domain/types';
import { hoyISO } from '@/domain/fechas';
import { Boton, Entrada, Tarjeta, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { normalizar } from './consultas';
import { CampoBusqueda, Confirmacion, Encabezado, Seccion, Segmentado, fechaMedia, instanteCorto } from './comunes';

export function Ajustes() {
  const { db, esAdmin } = useTrabajador();
  if (!esAdmin) return <Vacio icono={Settings} titulo="Solo para el administrador" texto="La configuración del centro la gestiona el administrador." />;
  return (
    <div>
      <Encabezado titulo="Ajustes" subtitulo={db.config.nombre} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Reglas />
        <Cierres />
        <div className="lg:col-span-2"><Auditoria /></div>
      </div>
    </div>
  );
}

function Reglas() {
  const { db, ejecutar } = useTrabajador();
  const c = db.config;
  const [f, setF] = useState({ minutosAntelacionCancelacion: c.minutosAntelacionCancelacion, diasVentanaReserva: c.diasVentanaReserva, recuperacionCaducaConContrato: c.recuperacionCaducaConContrato, diasCaducidadRecuperacion: c.diasCaducidadRecuperacion });
  const cambiado = JSON.stringify(f) !== JSON.stringify({ minutosAntelacionCancelacion: c.minutosAntelacionCancelacion, diasVentanaReserva: c.diasVentanaReserva, recuperacionCaducaConContrato: c.recuperacionCaducaConContrato, diasCaducidadRecuperacion: c.diasCaducidadRecuperacion });
  const guardar = async () => {
    const r = await ejecutar('actualizarConfig', { config: { ...f, minutosAntelacionCancelacion: Number(f.minutosAntelacionCancelacion), diasVentanaReserva: Number(f.diasVentanaReserva), diasCaducidadRecuperacion: Number(f.diasCaducidadRecuperacion) } });
    if (r.ok) toast.ok('Ajustes guardados.'); else toast.error(r.error);
  };
  const horas = Math.floor(Number(f.minutosAntelacionCancelacion) / 60);
  const mins = Number(f.minutosAntelacionCancelacion) % 60;
  return (
    <Tarjeta className="p-4 sm:p-6">
      <Seccion titulo="Reglas de reserva y cancelación">
        <div className="space-y-4">
          <Entrada etiqueta="Antelación mínima de cancelación (minutos)" ayuda={`Con esta antelación o más, la cancelación es recuperable. Actualmente: ${horas ? `${horas} h` : ''}${mins ? ` ${mins} min` : ''}.`} type="number" min={0} step={15} value={f.minutosAntelacionCancelacion} onChange={(e) => setF({ ...f, minutosAntelacionCancelacion: Number(e.target.value) })} />
          <Entrada etiqueta="Ventana de reserva (días)" ayuda="Con cuántos días de antelación puede reservar un cliente de turno libre." type="number" min={1} value={f.diasVentanaReserva} onChange={(e) => setF({ ...f, diasVentanaReserva: Number(e.target.value) })} />
          <div>
            <span className="block text-[15px] font-semibold mb-1.5">Caducidad de las recuperaciones</span>
            <Segmentado className="w-full" valor={f.recuperacionCaducaConContrato ? 'CONTRATO' : 'DIAS'} onCambio={(v) => setF({ ...f, recuperacionCaducaConContrato: v === 'CONTRATO' })} opciones={[{ valor: 'CONTRATO', texto: 'Con el contrato' }, { valor: 'DIAS', texto: 'A los N días' }]} />
            {f.recuperacionCaducaConContrato
              ? <p className="text-sm text-ink-muted mt-1">Las recuperaciones caducan al finalizar el periodo de la tarifa del cliente.</p>
              : <div className="mt-2"><Entrada etiqueta="Días de validez" type="number" min={1} value={f.diasCaducidadRecuperacion} onChange={(e) => setF({ ...f, diasCaducidadRecuperacion: Number(e.target.value) })} /></div>}
          </div>
          <div className="flex justify-end"><Boton onClick={guardar} disabled={!cambiado}><Save className="h-5 w-5" /> Guardar</Boton></div>
        </div>
      </Seccion>
    </Tarjeta>
  );
}

function Cierres() {
  const { db, ejecutar } = useTrabajador();
  const [lista, setLista] = useState<DiaCierre[]>([...db.config.diasCierre].sort((a, b) => a.fecha.localeCompare(b.fecha)));
  const [nuevo, setNuevo] = useState({ fecha: '', motivo: '' });
  const [confirmar, setConfirmar] = useState(false);
  const hoy = hoyISO();
  const cambiado = JSON.stringify(lista) !== JSON.stringify([...db.config.diasCierre].sort((a, b) => a.fecha.localeCompare(b.fecha)));
  const anadir = () => {
    if (!nuevo.fecha) return toast.error('Indica la fecha.');
    if (lista.some((d) => d.fecha === nuevo.fecha)) return toast.error('Esa fecha ya está en la lista.');
    setLista([...lista, { fecha: nuevo.fecha, motivo: nuevo.motivo.trim() || 'Cierre' }].sort((a, b) => a.fecha.localeCompare(b.fecha)));
    setNuevo({ fecha: '', motivo: '' });
  };
  const guardar = async () => {
    const r = await ejecutar('actualizarConfig', { config: { diasCierre: lista } });
    if (r.ok) toast.ok('Días de cierre guardados. Las clases de esos días quedan canceladas sin penalizar.'); else toast.error(r.error);
    setConfirmar(false);
  };
  const nuevosFuturos = lista.filter((d) => d.fecha >= hoy && !db.config.diasCierre.some((x) => x.fecha === d.fecha));
  const clasesAfectadas = db.clases.filter((c) => c.estado === 'PROGRAMADA' && nuevosFuturos.some((d) => d.fecha === c.fecha)).length;
  return (
    <Tarjeta className="p-4 sm:p-6">
      <Seccion titulo="Días de cierre y festivos">
        <p className="text-sm text-ink-muted mb-3">Esos días no se generan clases. Si ya existían, se cancelan y las reservas quedan canceladas por el centro sin penalizar (el periodo del contrato ya descuenta los cierres).</p>
        <ul className="divide-y divide-ink/5 rounded-2xl border border-ink/10 mb-3 max-h-64 overflow-y-auto">
          {lista.length === 0 && <li className="p-4 text-center text-ink-muted">No hay días de cierre.</li>}
          {lista.map((d) => (
            <li key={d.fecha} className={cn('flex items-center gap-3 px-3 py-2', d.fecha < hoy && 'opacity-50')}>
              <CalendarOff className="h-5 w-5 text-ink-muted shrink-0" />
              <span className="flex-1 min-w-0"><span className="font-semibold">{fechaMedia(d.fecha)}</span><span className="block text-sm text-ink-muted truncate">{d.motivo}</span></span>
              <button type="button" aria-label="Quitar" onClick={() => setLista(lista.filter((x) => x.fecha !== d.fecha))} className="h-10 w-10 rounded-full flex items-center justify-center text-ink-muted hover:bg-rose/10 hover:text-rose tap"><Trash2 className="h-5 w-5" /></button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <Entrada etiqueta="Fecha" type="date" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} />
          <Entrada etiqueta="Motivo" value={nuevo.motivo} onChange={(e) => setNuevo({ ...nuevo, motivo: e.target.value })} placeholder="Festivo" onKeyDown={(e) => e.key === 'Enter' && anadir()} />
          <Boton variante="suave" onClick={anadir} aria-label="Añadir"><Plus className="h-5 w-5" /></Boton>
        </div>
        <div className="flex justify-end mt-4"><Boton onClick={() => (clasesAfectadas > 0 ? setConfirmar(true) : guardar())} disabled={!cambiado}><Save className="h-5 w-5" /> Guardar cierres</Boton></div>
      </Seccion>
      <Confirmacion abierta={confirmar} onCerrar={() => setConfirmar(false)} titulo="Confirmar días de cierre" textoConfirmar="Guardar y cancelar clases" peligro onConfirmar={guardar}>
        <p>Hay <strong className="text-ink">{clasesAfectadas} clase{clasesAfectadas === 1 ? '' : 's'}</strong> programada{clasesAfectadas === 1 ? '' : 's'} en los nuevos días de cierre. Se cancelarán y sus reservas pasarán a "canceladas por el centro" sin penalizar a nadie.</p>
      </Confirmacion>
    </Tarjeta>
  );
}

const ACCION_TEXTO: Record<string, string> = {
  SEED: 'Datos de demo', RESERVAR: 'Reserva', CANCELAR_RESERVA: 'Cancelación de reserva', ANADIR_ALUMNO: 'Alumno añadido', ASISTENCIA: 'Asistencia', AUTORIZAR_RECUPERACION: 'Recuperación autorizada',
  CANCELAR_CLASE: 'Clase cancelada', CREAR_CLASE_EXTRA: 'Clase extraordinaria', CREAR_HORARIO: 'Franja creada', EDITAR_HORARIO: 'Franja editada', CREAR_CLIENTE: 'Cliente creado', EDITAR_CLIENTE: 'Cliente editado',
  CREAR_CONTRATO: 'Contratación', FINALIZAR_CONTRATO: 'Contrato finalizado', PUBLICAR_AVISO: 'Aviso publicado', EDITAR_PERFIL: 'Perfil editado', CREAR_TARIFA: 'Tarifa creada', EDITAR_TARIFA: 'Tarifa editada',
  CREAR_ACTIVIDAD: 'Actividad creada', EDITAR_ACTIVIDAD: 'Actividad editada', CREAR_TRABAJADOR: 'Trabajador creado', EDITAR_TRABAJADOR: 'Trabajador editado', CONFIG: 'Configuración',
};

function Auditoria() {
  const { db } = useTrabajador();
  const [texto, setTexto] = useState('');
  const [limite, setLimite] = useState(50);
  const q = normalizar(texto);
  const filas = db.auditoria.filter((a) => !q || normalizar(`${a.actorNombre} ${a.accion} ${ACCION_TEXTO[a.accion] ?? ''} ${a.detalle} ${a.entidad}`).includes(q));
  return (
    <Tarjeta className="p-4 sm:p-6">
      <Seccion titulo={<span className="flex items-center gap-2"><History className="h-5 w-5 text-ink-muted" /> Registro de cambios</span>} acciones={<span className="text-sm text-ink-muted">{filas.length} registros</span>}>
        <CampoBusqueda valor={texto} onCambio={setTexto} placeholder="Buscar por persona, acción o detalle" className="mb-3" />
        <ul className="divide-y divide-ink/5">
          {filas.slice(0, limite).map((a) => (
            <li key={a.id} className="py-2.5 grid sm:grid-cols-[10rem_10rem_1fr] gap-x-4 gap-y-0.5 text-sm">
              <span className="text-ink-muted tabular-nums">{instanteCorto(a.instante)}</span>
              <span className="font-semibold truncate">{a.actorNombre}</span>
              <span><span className="font-medium">{ACCION_TEXTO[a.accion] ?? a.accion}</span>{a.detalle && <span className="text-ink-soft"> · {a.detalle}</span>}</span>
            </li>
          ))}
        </ul>
        {filas.length > limite && <div className="flex justify-center mt-3"><Boton variante="secundario" tamano="sm" onClick={() => setLimite(limite + 100)}>Mostrar más</Boton></div>}
      </Seccion>
    </Tarjeta>
  );
}
