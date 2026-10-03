import { useState } from 'react';
import { CalendarClock, Info, Plus } from 'lucide-react';
import type { DiaSemana, PlantillaClase } from '@/domain/types';
import { DIAS_SEMANA_CORTO, DIAS_SEMANA_LABEL, horaFin } from '@/domain/fechas';
import { Boton, Chip, Entrada, Hoja, Interruptor, Seleccion, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { monitores, ocupacionFijaDePlantilla, plantillasPorDia } from './consultas';
import { Encabezado, PuntoColor, Segmentado } from './comunes';

const DIAS: DiaSemana[] = [1, 2, 3, 4, 5, 6, 7];

export function Horarios() {
  const { db, puede, limitado } = useTrabajador();
  const [dia, setDia] = useState<DiaSemana>(1);
  const [edicion, setEdicion] = useState<PlantillaClase | 'NUEVA' | null>(null);
  const porDia = plantillasPorDia(db);
  const puedeEditar = puede('HORARIOS_GESTIONAR') && !limitado; // con ámbito SUS_CLASES el horario es de solo lectura
  const abrir = (p: PlantillaClase | 'NUEVA') => puedeEditar && setEdicion(p);

  return (
    <div>
      <Encabezado
        titulo="Horarios" subtitulo={`${db.plantillas.filter((p) => p.activa).length} franjas activas a la semana${limitado ? ' · solo tus franjas (solo lectura)' : ''}`}
        acciones={puedeEditar && <Boton tamano="sm" onClick={() => abrir('NUEVA')}><Plus className="h-5 w-5" /> Nueva franja</Boton>}
      />
      <div className="mb-4 flex items-start gap-2 rounded-2xl bg-beige-100 text-ink px-4 py-3 text-sm"><Info className="h-5 w-5 shrink-0" /><span>Las clases de las próximas 10 semanas se generan automáticamente a partir de este horario. Los cambios afectan a las clases que aún no existen.</span></div>

      {db.plantillas.length === 0 && <Vacio icono={CalendarClock} titulo="Sin horario" texto="Crea la primera franja semanal." />}

      {/* Móvil: lista por día */}
      <div className="md:hidden">
        <Segmentado className="w-full" tamano="sm" valor={String(dia) as `${DiaSemana}`} onCambio={(v) => setDia(Number(v) as DiaSemana)} opciones={DIAS.map((d) => ({ valor: String(d) as `${DiaSemana}`, texto: DIAS_SEMANA_CORTO[d] }))} />
        <h2 className="text-lg font-sans font-semibold mt-4 mb-2">{DIAS_SEMANA_LABEL[dia]}</h2>
        <div className="space-y-2">
          {porDia[dia].length === 0 && <p className="text-ink-muted">No hay franjas este día.</p>}
          {porDia[dia].map((p) => <BloquePlantilla key={p.id} p={p} onClick={() => abrir(p)} detallada />)}
        </div>
      </div>

      {/* Escritorio: rejilla semanal */}
      <div className="hidden md:grid grid-cols-7 gap-2">
        {DIAS.map((d) => (
          <div key={d} className="min-w-0">
            <div className="text-center text-sm font-semibold text-ink-soft mb-2">{DIAS_SEMANA_LABEL[d]}</div>
            <div className="space-y-1.5">
              {porDia[d].map((p) => <BloquePlantilla key={p.id} p={p} onClick={() => abrir(p)} />)}
              {porDia[d].length === 0 && <div className="rounded-xl border border-dashed border-ink/10 h-16 flex items-center justify-center text-xs text-ink-muted">Sin clases</div>}
            </div>
          </div>
        ))}
      </div>

      {edicion && <HojaPlantilla plantilla={edicion === 'NUEVA' ? null : edicion} diaInicial={dia} onCerrar={() => setEdicion(null)} />}
    </div>
  );
}

function BloquePlantilla({ p, onClick, detallada }: { p: PlantillaClase; onClick: () => void; detallada?: boolean }) {
  const { db } = useTrabajador();
  const a = db.actividades.find((x) => x.id === p.actividadId);
  const m = db.trabajadores.find((x) => x.id === p.monitorId);
  const fijos = ocupacionFijaDePlantilla(db, p.id);
  return (
    <button type="button" onClick={onClick} className={cn('w-full text-left rounded-xl bg-white shadow-card border-l-4 tap hover:ring-2 hover:ring-beige-200', detallada ? 'p-3' : 'p-2 text-xs', !p.activa && 'opacity-50')} style={{ borderLeftColor: a?.color ?? '#999' }}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('font-bold', detallada && 'text-lg')}>{p.horaInicio}<span className="text-ink-muted font-normal">–{horaFin(p.horaInicio, p.duracionMin)}</span></span>
        {!p.activa && <Chip tono="gris">Inactiva</Chip>}
      </div>
      <div className={cn('font-semibold flex items-center gap-1.5', !detallada && 'truncate')}>{detallada && <PuntoColor color={a?.color ?? '#999'} />}{a?.nombre ?? 'Actividad eliminada'}</div>
      <div className={cn('text-ink-muted', detallada ? 'text-sm' : 'truncate')}>{m?.nombre ?? 'Sin monitor'} · {fijos}/{p.plazas}{detallada ? ' fijos' : ''}</div>
      {(p.vigenciaDesde || p.vigenciaHasta) && <div className="text-[11px] text-clay mt-0.5">{p.vigenciaDesde ? `desde ${p.vigenciaDesde}` : ''} {p.vigenciaHasta ? `hasta ${p.vigenciaHasta}` : ''}</div>}
    </button>
  );
}

function HojaPlantilla({ plantilla, diaInicial, onCerrar }: { plantilla: PlantillaClase | null; diaInicial: DiaSemana; onCerrar: () => void }) {
  const { db, ejecutar } = useTrabajador();
  const mons = monitores(db);
  const acts = db.actividades.filter((a) => a.activa || a.id === plantilla?.actividadId);
  const [f, setF] = useState<Omit<PlantillaClase, 'id'>>(
    plantilla ?? { actividadId: acts[0]?.id ?? '', diaSemana: diaInicial, horaInicio: '10:00', duracionMin: 55, monitorId: mons[0]?.id ?? '', plazas: 8, activa: true, vigenciaDesde: null, vigenciaHasta: null },
  );
  const guardar = async () => {
    if (!f.actividadId || !f.monitorId || !f.horaInicio) return toast.error('Completa actividad, hora y monitor.');
    const r = await ejecutar('guardarPlantilla', { plantilla: { ...f, id: plantilla?.id, duracionMin: Number(f.duracionMin), plazas: Number(f.plazas) } });
    if (r.ok) { toast.ok(plantilla ? 'Franja actualizada.' : 'Franja creada. Se han generado sus clases.'); onCerrar(); } else toast.error(r.error);
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={plantilla ? 'Editar franja' : 'Nueva franja'}>
      <div className="space-y-4">
        <Seleccion etiqueta="Actividad" value={f.actividadId} onChange={(e) => setF({ ...f, actividadId: e.target.value })}>
          {acts.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </Seleccion>
        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Día de la semana</span>
          <div className="grid grid-cols-7 gap-1">
            {DIAS.map((d) => <button key={d} type="button" aria-pressed={f.diaSemana === d} onClick={() => setF({ ...f, diaSemana: d })} className={cn('h-11 rounded-xl font-semibold tap border', f.diaSemana === d ? 'bg-brand-500 text-sand border-brand-500' : 'bg-white border-ink/10')}>{DIAS_SEMANA_CORTO[d]}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Entrada etiqueta="Hora" type="time" value={f.horaInicio} onChange={(e) => setF({ ...f, horaInicio: e.target.value })} />
          <Entrada etiqueta="Minutos" type="number" min={15} step={5} value={f.duracionMin} onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} />
          <Entrada etiqueta="Plazas" type="number" min={1} value={f.plazas} onChange={(e) => setF({ ...f, plazas: Number(e.target.value) })} />
        </div>
        <Seleccion etiqueta="Monitor/a" value={f.monitorId} onChange={(e) => setF({ ...f, monitorId: e.target.value })}>
          {mons.map((m) => <option key={m.id} value={m.id}>{m.nombre} {m.apellidos}</option>)}
        </Seleccion>
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Vigente desde" ayuda="Opcional" type="date" value={f.vigenciaDesde ?? ''} onChange={(e) => setF({ ...f, vigenciaDesde: e.target.value || null })} />
          <Entrada etiqueta="Vigente hasta" ayuda="Opcional" type="date" value={f.vigenciaHasta ?? ''} onChange={(e) => setF({ ...f, vigenciaHasta: e.target.value || null })} />
        </div>
        <div className="rounded-2xl border border-ink/10 px-4"><Interruptor activo={f.activa} onCambio={(v) => setF({ ...f, activa: v })} etiqueta="Franja activa" descripcion="Si se desactiva, no se generan nuevas clases." /></div>
        <Boton ancho onClick={guardar}>{plantilla ? 'Guardar cambios' : 'Crear franja'}</Boton>
      </div>
    </Hoja>
  );
}
