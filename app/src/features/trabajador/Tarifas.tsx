import { useRef, useState } from 'react';
import { Dumbbell, ImagePlus, Plus, Tags, Trash2 } from 'lucide-react';
import type { Actividad, Categoria, Tarifa, TipoTarifa } from '@/domain/types';
import { CATEGORIA_LABEL } from '@/domain/types';
import { AreaTexto, Boton, Chip, Entrada, Hoja, Interruptor, Seleccion, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useModo } from '@/data/store';
import { subirImagenActividad } from '@/data/supabase/web';
import { ANCHO_PORTADA, blobADataUrl, recortarYReducir, reducirAncho } from '@/lib/imagen';
import { ICONOS_ACTIVIDAD, esClaveIcono, urlIcono } from '@/lib/iconos';
import { IconoActividad } from '@/features/comun/IconoActividad';
import { useTrabajador } from './useTrabajador';
import { Encabezado, Pestanas, Segmentado, euros } from './comunes';

const TIPO: Record<TipoTarifa, string> = { RECURRENTE: 'Mensual (cupo semanal)', BONO: 'Bono de sesiones', CLASE_SUELTA: 'Clase suelta' };
const CATS: Categoria[] = ['DIRIGIDA', 'REFORMER'];
const COLORES = ['#86735F', '#B9A795', '#A08D79', '#3A3A3A', '#3B82C4', '#6B7A8F', '#C9713F', '#D95A6A'];

export function Tarifas() {
  const { db } = useTrabajador();
  const [pestana, setPestana] = useState<'TARIFAS' | 'ACTIVIDADES'>('TARIFAS');
  const [tarifa, setTarifa] = useState<Tarifa | 'NUEVA' | null>(null);
  const [actividad, setActividad] = useState<Actividad | 'NUEVA' | null>(null);
  const tarifas = [...db.tarifas].sort((a, b) => a.orden - b.orden);

  return (
    <div>
      <Encabezado
        titulo="Tarifas y actividades"
        acciones={pestana === 'TARIFAS' ? <Boton tamano="sm" onClick={() => setTarifa('NUEVA')}><Plus className="h-5 w-5" /> Nueva tarifa</Boton> : <Boton tamano="sm" onClick={() => setActividad('NUEVA')}><Plus className="h-5 w-5" /> Nueva actividad</Boton>}
      />
      <Pestanas activa={pestana} onCambio={setPestana} items={[{ valor: 'TARIFAS', texto: 'Tarifas', icono: <Tags className="h-4 w-4" /> }, { valor: 'ACTIVIDADES', texto: 'Actividades', icono: <Dumbbell className="h-4 w-4" /> }]} />
      <div className="pt-4">
        {pestana === 'TARIFAS' && (tarifas.length === 0 ? <Vacio icono={Tags} titulo="Sin tarifas" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {tarifas.map((t) => (
              <button key={t.id} type="button" onClick={() => setTarifa(t)} className={cn('text-left bg-white rounded-2xl shadow-card border border-ink/5 p-4 tap hover:border-beige-200', !t.activa && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold text-lg leading-tight">{t.nombre}</div><div className="text-sm text-ink-muted mt-0.5">{t.descripcion}</div></div>
                  <span className="font-bold text-beige-600 whitespace-nowrap">{euros(t.precioCentimos)}</span>
                </div>
                <div className="flex gap-1.5 flex-wrap mt-3">
                  <Chip tono="gris">{TIPO[t.tipo]}</Chip>
                  {t.cupos.map((c) => <Chip key={c.categoria} tono="beige">{c.sesionesSemana}/sem {CATEGORIA_LABEL[c.categoria].toLowerCase()}</Chip>)}
                  {t.bono && <Chip tono="cocoa">{t.bono.sesiones} sesiones · {t.bono.validezMeses} meses</Chip>}
                  {t.recuperacion.permitida ? <Chip tono="azul">Recuperable{t.recuperacion.maxPendientes != null ? ` (máx. ${t.recuperacion.maxPendientes})` : ''}</Chip> : <Chip tono="rojo">Sin recuperación</Chip>}
                  {!t.activa && <Chip tono="gris">Inactiva</Chip>}
                </div>
              </button>
            ))}
          </div>
        ))}
        {pestana === 'ACTIVIDADES' && (
          <div className="grid gap-3 md:grid-cols-2">
            {db.actividades.map((a) => (
              <button key={a.id} type="button" onClick={() => setActividad(a)} className={cn('text-left bg-white rounded-2xl shadow-card border border-ink/5 p-4 tap hover:border-beige-200 flex gap-3', !a.activa && 'opacity-60')}>
                <IconoActividad actividad={a} tamano="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-lg leading-tight">{a.nombre}</span><Chip tono={a.categoria === 'REFORMER' ? 'azul' : 'beige'}>{CATEGORIA_LABEL[a.categoria]}</Chip>{!a.activa && <Chip tono="gris">Inactiva</Chip>}</div>
                  <div className="text-sm text-ink-muted mt-0.5">{a.descripcion}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {tarifa && <HojaTarifa tarifa={tarifa === 'NUEVA' ? null : tarifa} orden={tarifas.length + 1} onCerrar={() => setTarifa(null)} />}
      {actividad && <HojaActividad actividad={actividad === 'NUEVA' ? null : actividad} onCerrar={() => setActividad(null)} />}
    </div>
  );
}

function HojaTarifa({ tarifa, orden, onCerrar }: { tarifa: Tarifa | null; orden: number; onCerrar: () => void }) {
  const { ejecutar } = useTrabajador();
  const [f, setF] = useState<Omit<Tarifa, 'id'>>(tarifa ?? { nombre: '', descripcion: '', tipo: 'RECURRENTE', cupos: [{ categoria: 'DIRIGIDA', sesionesSemana: 2 }], bono: null, recuperacion: { permitida: true, categoriasExtra: [], maxPendientes: null }, precioCentimos: null, activa: true, orden });
  const [precio, setPrecio] = useState(tarifa?.precioCentimos != null ? (tarifa.precioCentimos / 100).toFixed(2) : '');
  const cupo = (c: Categoria) => f.cupos.find((x) => x.categoria === c)?.sesionesSemana ?? 0;
  const setCupo = (c: Categoria, n: number) => setF({ ...f, cupos: [...f.cupos.filter((x) => x.categoria !== c), ...(n > 0 ? [{ categoria: c, sesionesSemana: n }] : [])] });
  const setTipo = (tipo: TipoTarifa) => setF({ ...f, tipo, bono: tipo === 'BONO' ? f.bono ?? { sesiones: 10, categoria: 'DIRIGIDA', validezMeses: 6 } : null, cupos: tipo === 'RECURRENTE' ? f.cupos : [] });
  const guardar = async () => {
    if (!f.nombre.trim()) return toast.error('El nombre es obligatorio.');
    const p = precio.trim().replace(',', '.');
    const precioCentimos = p === '' ? null : Math.round(Number(p) * 100);
    if (precioCentimos != null && Number.isNaN(precioCentimos)) return toast.error('Precio no válido.');
    const r = await ejecutar('guardarTarifa', { tarifa: { ...f, id: tarifa?.id, nombre: f.nombre.trim(), precioCentimos, orden: Number(f.orden) } });
    if (r.ok) { toast.ok('Tarifa guardada.'); onCerrar(); } else toast.error(r.error);
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={tarifa ? 'Editar tarifa' : 'Nueva tarifa'} className="sm:max-w-2xl">
      <div className="space-y-4">
        <Entrada etiqueta="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        <AreaTexto etiqueta="Descripción" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} className="min-h-[4rem]" />
        <Seleccion etiqueta="Tipo" value={f.tipo} onChange={(e) => setTipo(e.target.value as TipoTarifa)}>
          {(Object.keys(TIPO) as TipoTarifa[]).map((t) => <option key={t} value={t}>{TIPO[t]}</option>)}
        </Seleccion>
        {f.tipo === 'RECURRENTE' && (
          <div>
            <span className="block text-[15px] font-semibold mb-1.5">Sesiones por semana</span>
            <div className="grid grid-cols-2 gap-3">
              {CATS.map((c) => <Entrada key={c} etiqueta={CATEGORIA_LABEL[c]} type="number" min={0} max={7} value={cupo(c)} onChange={(e) => setCupo(c, Number(e.target.value))} />)}
            </div>
          </div>
        )}
        {f.tipo === 'BONO' && f.bono && (
          <div className="grid grid-cols-3 gap-3">
            <Entrada etiqueta="Sesiones" type="number" min={1} value={f.bono.sesiones} onChange={(e) => setF({ ...f, bono: { ...f.bono!, sesiones: Number(e.target.value) } })} />
            <Seleccion etiqueta="Categoría" value={f.bono.categoria} onChange={(e) => setF({ ...f, bono: { ...f.bono!, categoria: e.target.value as Categoria } })}>{CATS.map((c) => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}</Seleccion>
            <Entrada etiqueta="Validez (meses)" type="number" min={1} value={f.bono.validezMeses} onChange={(e) => setF({ ...f, bono: { ...f.bono!, validezMeses: Number(e.target.value) } })} />
          </div>
        )}
        <div className="rounded-2xl border border-ink/10 px-4 divide-y divide-ink/5">
          <Interruptor activo={f.recuperacion.permitida} onCambio={(v) => setF({ ...f, recuperacion: { ...f.recuperacion, permitida: v } })} etiqueta="Permite recuperar clases" descripcion="Al cancelar con antelación se genera una recuperación." />
          {f.recuperacion.permitida && (
            <div className="py-3 space-y-3">
              <div>
                <span className="block text-sm font-semibold mb-1">También puede recuperar en</span>
                <div className="flex gap-2">
                  {CATS.map((c) => { const on = f.recuperacion.categoriasExtra.includes(c); return <button key={c} type="button" aria-pressed={on} onClick={() => setF({ ...f, recuperacion: { ...f.recuperacion, categoriasExtra: on ? f.recuperacion.categoriasExtra.filter((x) => x !== c) : [...f.recuperacion.categoriasExtra, c] } })} className={cn('h-10 px-4 rounded-xl border font-semibold text-sm tap', on ? 'bg-sky text-white border-sky' : 'bg-white border-ink/10')}>{CATEGORIA_LABEL[c]}</button>; })}
                </div>
                <p className="text-xs text-ink-muted mt-1">Además de la categoría de la clase cancelada.</p>
              </div>
              <Entrada etiqueta="Máximo de recuperaciones pendientes" ayuda="Vacío = sin límite" type="number" min={0} value={f.recuperacion.maxPendientes ?? ''} onChange={(e) => setF({ ...f, recuperacion: { ...f.recuperacion, maxPendientes: e.target.value === '' ? null : Number(e.target.value) } })} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Precio (€)" ayuda="Vacío = consultar" type="text" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Consultar" />
          <Entrada etiqueta="Orden" type="number" min={1} value={f.orden} onChange={(e) => setF({ ...f, orden: Number(e.target.value) })} />
        </div>
        <div className="rounded-2xl border border-ink/10 px-4"><Interruptor activo={f.activa} onCambio={(v) => setF({ ...f, activa: v })} etiqueta="Tarifa activa" descripcion="Solo las activas se ofrecen en nuevas contrataciones." /></div>
        <Boton ancho onClick={guardar}>{tarifa ? 'Guardar cambios' : 'Crear tarifa'}</Boton>
      </div>
    </Hoja>
  );
}

function HojaActividad({ actividad, onCerrar }: { actividad: Actividad | null; onCerrar: () => void }) {
  const { ejecutar } = useTrabajador();
  const modo = useModo();
  const [f, setF] = useState<Omit<Actividad, 'id'>>(actividad ?? { nombre: '', categoria: 'DIRIGIDA', descripcion: '', color: COLORES[0], activa: true, nombreWeb: '', duracionMin: 55, lema: '', descripcionLarga: '', icono: '', fotoUrl: '' });
  const [subiendo, setSubiendo] = useState<'icono' | 'foto' | null>(null);
  const entradaIcono = useRef<HTMLInputElement>(null);
  const entradaFoto = useRef<HTMLInputElement>(null);
  const idImagen = actividad?.id ?? 'nueva';

  const guardar = async () => {
    if (!f.nombre.trim()) return toast.error('El nombre es obligatorio.');
    const duracion = Number(f.duracionMin);
    if (!Number.isFinite(duracion) || duracion < 10 || duracion > 240) return toast.error('La duración debe estar entre 10 y 240 minutos.');
    const r = await ejecutar('guardarActividad', { actividad: { ...f, id: actividad?.id, nombre: f.nombre.trim(), nombreWeb: (f.nombreWeb ?? '').trim(), duracionMin: duracion, lema: (f.lema ?? '').trim(), descripcionLarga: (f.descripcionLarga ?? '').trim() } });
    if (r.ok) { toast.ok('Actividad guardada.'); onCerrar(); } else toast.error(r.error);
  };

  const subir = async (tipo: 'icono' | 'foto', file: File | undefined) => {
    if (!file) return;
    setSubiendo(tipo);
    try {
      // Icono: cuadrado 512 px (PNG si viene con transparencia). Foto: 1600 px de ancho.
      const blob = tipo === 'icono' ? await recortarYReducir(file, 512, 0.9) : await reducirAncho(file, ANCHO_PORTADA);
      const url = modo === 'SUPABASE' ? await subirImagenActividad(idImagen, tipo, blob) : await blobADataUrl(blob);
      setF((prev) => (tipo === 'icono' ? { ...prev, icono: url } : { ...prev, fotoUrl: url }));
      toast.ok(tipo === 'icono' ? 'Icono subido. Recuerda guardar.' : 'Foto subida. Recuerda guardar.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubiendo(null);
      if (entradaIcono.current) entradaIcono.current.value = '';
      if (entradaFoto.current) entradaFoto.current.value = '';
    }
  };

  const vista: Actividad = { id: idImagen, ...f };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={actividad ? 'Editar actividad' : 'Nueva actividad'}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <IconoActividad actividad={vista} tamano="lg" />
          <div className="flex-1 min-w-0">
            <Entrada etiqueta="Nombre (corto, para la app)" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Reformer" />
          </div>
        </div>
        <Entrada etiqueta="Nombre completo (para la web)" ayuda="Si lo dejas vacío se usa el nombre corto." value={f.nombreWeb ?? ''} onChange={(e) => setF({ ...f, nombreWeb: e.target.value })} placeholder="Pilates Reformer con Torre" />
        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Categoría</span>
          <Segmentado className="w-full" valor={f.categoria} onCambio={(v) => setF({ ...f, categoria: v })} opciones={CATS.map((c) => ({ valor: c, texto: CATEGORIA_LABEL[c] }))} />
          <p className="text-sm text-ink-muted mt-1">La categoría determina qué tarifas dan derecho a esta actividad.</p>
        </div>
        <Entrada etiqueta="Duración por defecto (minutos)" ayuda="Se propone al crear franjas del horario y se muestra en la web." type="number" min={10} max={240} step={5} value={f.duracionMin ?? 55} onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} />
        <AreaTexto etiqueta="Descripción corta" ayuda="Una o dos frases: aparece en listas y en la app." value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
        <AreaTexto etiqueta="Descripción completa" ayuda="Texto largo para la web y la ficha de la actividad." value={f.descripcionLarga ?? ''} onChange={(e) => setF({ ...f, descripcionLarga: e.target.value })} className="min-h-[9rem]" />
        <Entrada etiqueta="Frase final" ayuda='Se muestra en cursiva al final, como "Siente el ritmo".' value={f.lema ?? ''} onChange={(e) => setF({ ...f, lema: e.target.value })} />

        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Icono</span>
          <div className="flex gap-2 flex-wrap items-center">
            {ICONOS_ACTIVIDAD.map((i) => (
              <button key={i.clave} type="button" title={i.nombre} aria-label={i.nombre} aria-pressed={f.icono === i.clave} onClick={() => setF({ ...f, icono: i.clave })} className={cn('h-12 w-12 rounded-full tap ring-offset-2', f.icono === i.clave && 'ring-4 ring-ink/30')}>
                <img src={urlIcono(i.clave) ?? ''} alt="" className="h-12 w-12 rounded-full" />
              </button>
            ))}
            <button type="button" aria-label="Sin icono" aria-pressed={!f.icono} onClick={() => setF({ ...f, icono: '' })} className={cn('h-12 w-12 rounded-full tap ring-offset-2 bg-sand border border-beige-300 text-xs text-ink-muted', !f.icono && 'ring-4 ring-ink/30')}>Ninguno</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Boton variante="suave" tamano="sm" cargando={subiendo === 'icono'} onClick={() => entradaIcono.current?.click()}><ImagePlus className="h-4 w-4" /> Subir icono propio</Boton>
            <input ref={entradaIcono} type="file" accept="image/*" className="hidden" onChange={(e) => void subir('icono', e.target.files?.[0])} />
            {f.icono && !esClaveIcono(f.icono) && <span className="text-sm text-ink-muted">Icono propio subido</span>}
          </div>
        </div>

        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Foto (opcional)</span>
          {f.fotoUrl ? (
            <div className="relative rounded-2xl overflow-hidden aspect-[16/9] bg-sand">
              <img src={f.fotoUrl} alt="" className="h-full w-full object-cover" />
              <button type="button" onClick={() => setF({ ...f, fotoUrl: '' })} className="absolute top-2 right-2 h-9 w-9 rounded-full bg-white/90 text-ink flex items-center justify-center tap" aria-label="Quitar foto"><Trash2 className="h-4 w-4" /></button>
            </div>
          ) : (
            <Boton variante="suave" tamano="sm" cargando={subiendo === 'foto'} onClick={() => entradaFoto.current?.click()}><ImagePlus className="h-4 w-4" /> Subir foto</Boton>
          )}
          <input ref={entradaFoto} type="file" accept="image/*" className="hidden" onChange={(e) => void subir('foto', e.target.files?.[0])} />
        </div>

        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Color en el calendario</span>
          <div className="flex gap-2 flex-wrap items-center">
            {COLORES.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={cn('h-10 w-10 rounded-full tap ring-offset-2', f.color === c && 'ring-4 ring-ink/30')} style={{ backgroundColor: c }} />)}
            <input type="color" aria-label="Color personalizado" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-12 rounded-xl border border-ink/10 bg-white p-1" />
          </div>
        </div>
        <div className="rounded-2xl border border-ink/10 px-4"><Interruptor activo={f.activa} onCambio={(v) => setF({ ...f, activa: v })} etiqueta="Actividad activa" descripcion="Solo las activas se programan y aparecen en la web." /></div>
        <Boton ancho onClick={guardar}>{actividad ? 'Guardar cambios' : 'Crear actividad'}</Boton>
      </div>
    </Hoja>
  );
}
