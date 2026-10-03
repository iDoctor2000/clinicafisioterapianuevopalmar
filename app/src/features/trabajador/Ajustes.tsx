import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarOff, Eye, EyeOff, History, ImagePlus, Images, Plus, Save, Settings, Trash2 } from 'lucide-react';
import type { DiaCierre, PortadaImagen } from '@/domain/types';
import { hoyISO } from '@/domain/fechas';
import { useModo } from '@/data/store';
import { MAX_PORTADA } from '@/data/comandos';
import { portadaOrdenada } from '@/data/selectores';
import { subirImagenPortada } from '@/data/supabase/portada';
import { ANCHO_PORTADA, blobADataUrl, ErrorImagen, reducirAncho } from '@/lib/imagen';
import { Boton, Chip, Entrada, Tarjeta, Vacio, toast } from '@/ui';
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
        <div className="lg:col-span-2"><FotosPortada /></div>
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
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    const config = { ...f, minutosAntelacionCancelacion: Number(f.minutosAntelacionCancelacion), diasVentanaReserva: Number(f.diasVentanaReserva), diasCaducidadRecuperacion: Number(f.diasCaducidadRecuperacion) };
    if (!Number.isFinite(config.minutosAntelacionCancelacion) || config.minutosAntelacionCancelacion < 0) return toast.error('La antelación de cancelación debe ser 0 o más minutos.');
    if (!Number.isFinite(config.diasVentanaReserva) || config.diasVentanaReserva < 1) return toast.error('La ventana de reserva debe ser al menos 1 día.');
    if (!config.recuperacionCaducaConContrato && (!Number.isFinite(config.diasCaducidadRecuperacion) || config.diasCaducidadRecuperacion < 1)) return toast.error('Los días de validez de las recuperaciones deben ser al menos 1.');
    setGuardando(true);
    const r = await ejecutar('actualizarConfig', { config });
    setGuardando(false);
    if (r.ok) {
      const caducidad = config.recuperacionCaducaConContrato ? 'caducan con el contrato' : `caducan a los ${config.diasCaducidadRecuperacion} días`;
      toast.ok(`Ajustes guardados: cancelación con ${config.minutosAntelacionCancelacion} min de antelación, reserva con ${config.diasVentanaReserva} días de ventana, las recuperaciones ${caducidad}.`);
    } else {
      toast.error(`No se han guardado los ajustes. ${r.error}`);
    }
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
          <div className="flex justify-end"><Boton onClick={guardar} disabled={!cambiado} cargando={guardando}><Save className="h-5 w-5" /> Guardar</Boton></div>
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
    if (r.ok) toast.ok(`Días de cierre guardados (${lista.length}). Las clases de esos días quedan canceladas sin penalizar.`); else toast.error(`No se han guardado los días de cierre. ${r.error}`);
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
  FOTO_CLIENTE: 'Foto de cliente', QUITAR_FOTO_CLIENTE: 'Foto de cliente quitada', CONSENTIMIENTO: 'Consentimiento', CONSENTIMIENTO_PAPEL: 'Consentimiento en papel',
  CREAR_PORTADA: 'Foto de portada añadida', EDITAR_PORTADA: 'Foto de portada editada', BORRAR_PORTADA: 'Foto de portada borrada', ORDENAR_PORTADA: 'Portada reordenada',
};

// ---------------------------------------------------------------------------
// Fotos de la portada (carrusel del Inicio del cliente)
// ---------------------------------------------------------------------------

function FotosPortada() {
  const { db, ejecutar } = useTrabajador();
  const modo = useModo();
  const fotos = portadaOrdenada(db.portada);
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<PortadaImagen | null>(null);
  const [pies, setPies] = useState<Record<string, string>>({});
  // Si cambia la lista desde fuera (otro administrador), descartamos los pies que ya no existen.
  useEffect(() => { setPies((p) => Object.fromEntries(Object.entries(p).filter(([id]) => fotos.some((f) => f.id === id)))); }, [fotos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = async (file: File | undefined) => {
    if (entrada.current) entrada.current.value = '';
    if (!file) return;
    if (fotos.length >= MAX_PORTADA) return toast.error(`La portada admite como mucho ${MAX_PORTADA} fotos. Borra alguna antes de añadir otra.`);
    setSubiendo(true);
    try {
      const blob = await reducirAncho(file, ANCHO_PORTADA);
      const id = modo === 'SUPABASE' ? crypto.randomUUID() : undefined;
      const url = modo === 'SUPABASE' && id ? await subirImagenPortada(id, blob) : await blobADataUrl(blob);
      const r = await ejecutar('guardarPortadaImagen', { imagen: { id, url, pie: '', activa: true } });
      if (!r.ok) return toast.error(`No se ha podido añadir la foto. ${r.error}`);
      toast.ok('Foto añadida a la portada.');
    } catch (e) {
      toast.error(e instanceof ErrorImagen || e instanceof Error ? e.message : 'No se ha podido procesar la imagen.');
    } finally {
      setSubiendo(false);
    }
  };

  const guardar = async (foto: PortadaImagen, cambios: Partial<Pick<PortadaImagen, 'pie' | 'activa'>>, mensaje: string) => {
    setOcupado(foto.id);
    const r = await ejecutar('guardarPortadaImagen', { imagen: { ...foto, ...cambios } });
    setOcupado(null);
    if (!r.ok) return toast.error(`No se ha podido guardar. ${r.error}`);
    if (cambios.pie != null) setPies((p) => { const { [foto.id]: _quitar, ...resto } = p; return resto; });
    toast.ok(mensaje);
  };

  const mover = async (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= fotos.length) return;
    const ids = fotos.map((f) => f.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOcupado(fotos[i].id);
    const r = await ejecutar('ordenarPortada', { ids });
    setOcupado(null);
    if (!r.ok) toast.error(`No se ha podido reordenar. ${r.error}`);
  };

  const confirmarBorrar = async () => {
    if (!borrar) return;
    setOcupado(borrar.id);
    const r = await ejecutar('borrarPortadaImagen', { id: borrar.id });
    setOcupado(null);
    setBorrar(null);
    if (!r.ok) return toast.error(`No se ha podido borrar la foto. ${r.error}`);
    toast.ok('Foto borrada de la portada.');
  };

  const activas = fotos.filter((f) => f.activa).length;
  return (
    <Tarjeta className="p-4 sm:p-6">
      <Seccion
        titulo={<span className="flex items-center gap-2"><Images className="h-5 w-5 text-beige-600" /> Fotos de la portada</span>}
        acciones={<span className="text-sm text-ink-muted">{activas} visible{activas === 1 ? '' : 's'} de {fotos.length}</span>}
      >
        <p className="text-sm text-ink-muted mb-3">Carrusel que ven los clientes al entrar (Inicio). Las fotos se reducen a {ANCHO_PORTADA} px de ancho antes de guardarse. Usa fotos apaisadas del centro: máximo {MAX_PORTADA}.</p>
        <input ref={entrada} type="file" accept="image/*" className="sr-only" onChange={(e) => void elegir(e.target.files?.[0])} aria-label="Elegir imagen para la portada" />
        {fotos.length === 0 ? (
          <Vacio icono={Images} titulo="Todavía no hay fotos" texto="Sin fotos, la portada del cliente no muestra el carrusel." accion={<Boton onClick={() => entrada.current?.click()} cargando={subiendo}><ImagePlus className="h-5 w-5" /> Subir una foto</Boton>} />
        ) : (
          <ul className="space-y-3">
            {fotos.map((f, i) => {
              const pie = pies[f.id] ?? f.pie;
              const pieCambiado = pie !== f.pie;
              const trabajando = ocupado === f.id;
              return (
                <li key={f.id} className={cn('rounded-2xl border border-beige-200 p-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] items-start', !f.activa && 'bg-sand')}>
                  <div className="relative aspect-[16/10] rounded-xl overflow-hidden bg-beige-100">
                    <img src={f.url} alt={f.pie || `Foto ${i + 1}`} loading="lazy" className={cn('h-full w-full object-cover', !f.activa && 'opacity-50')} />
                    <span className="absolute top-1.5 left-1.5 h-6 min-w-6 px-1.5 rounded-full bg-brand-500 text-sand text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tono={f.activa ? 'beige' : 'gris'}>{f.activa ? 'Visible' : 'Oculta'}</Chip>
                    </div>
                    <div className="flex gap-2 items-end">
                      <Entrada etiqueta="Pie de foto" value={pie} maxLength={120} placeholder="Opcional: p. ej. Sala de Reformer" onChange={(e) => setPies((p) => ({ ...p, [f.id]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && pieCambiado && void guardar(f, { pie: pie.trim() }, 'Pie de foto guardado.')} />
                      <Boton variante="suave" disabled={!pieCambiado || trabajando} onClick={() => void guardar(f, { pie: pie.trim() }, 'Pie de foto guardado.')} aria-label="Guardar pie de foto"><Save className="h-5 w-5" /></Boton>
                    </div>
                  </div>
                  <div className="flex sm:flex-col gap-1 flex-wrap">
                    <Boton variante="fantasma" tamano="sm" disabled={i === 0 || trabajando} onClick={() => void mover(i, -1)} aria-label="Subir"><ArrowUp className="h-5 w-5" /><span className="sm:hidden">Subir</span></Boton>
                    <Boton variante="fantasma" tamano="sm" disabled={i === fotos.length - 1 || trabajando} onClick={() => void mover(i, 1)} aria-label="Bajar"><ArrowDown className="h-5 w-5" /><span className="sm:hidden">Bajar</span></Boton>
                    <Boton variante="fantasma" tamano="sm" disabled={trabajando} onClick={() => void guardar(f, { activa: !f.activa }, f.activa ? 'Foto oculta: ya no se muestra en la portada.' : 'Foto visible en la portada.')} aria-label={f.activa ? 'Ocultar' : 'Mostrar'}>
                      {f.activa ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}<span className="sm:hidden">{f.activa ? 'Ocultar' : 'Mostrar'}</span>
                    </Boton>
                    <Boton variante="fantasma" tamano="sm" disabled={trabajando} className="text-rose hover:bg-rose/10" onClick={() => setBorrar(f)} aria-label="Borrar"><Trash2 className="h-5 w-5" /><span className="sm:hidden">Borrar</span></Boton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {fotos.length > 0 && (
          <div className="flex justify-end mt-4">
            <Boton onClick={() => entrada.current?.click()} cargando={subiendo} disabled={fotos.length >= MAX_PORTADA}><ImagePlus className="h-5 w-5" /> Subir otra foto</Boton>
          </div>
        )}
      </Seccion>
      <Confirmacion abierta={borrar !== null} onCerrar={() => setBorrar(null)} titulo="Borrar foto de la portada" textoConfirmar="Borrar" peligro onConfirmar={() => void confirmarBorrar()}>
        <p>La foto <strong className="text-ink">{borrar?.pie || `nº ${fotos.findIndex((f) => f.id === borrar?.id) + 1}`}</strong> dejará de verse en la portada y se eliminará del servidor.</p>
      </Confirmacion>
    </Tarjeta>
  );
}

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
