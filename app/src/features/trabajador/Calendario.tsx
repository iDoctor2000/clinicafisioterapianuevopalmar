import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, DoorClosed, Moon } from 'lucide-react';
import type { ClaseVista } from '@/data/selectores';
import { DIAS_SEMANA_CORTO, diaSemanaDe, esDiaCierre, fechaLarga, horaFin, hoyISO, mesLargo, sumarDias } from '@/domain/fechas';
import { Boton, Chip, Entrada, Hoja, Seleccion, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { clasesPorDiaDeSemana, clasesSueltasDe, monitores } from './consultas';
import { BarraOcupacion, Encabezado, PuntoColor, Segmentado, may } from './comunes';

export function Calendario() {
  const { db, puede } = useTrabajador();
  const hoy = hoyISO();
  const [fecha, setFecha] = useState(hoy);
  const [vista, setVista] = useState<'DIA' | 'SEMANA'>('DIA');
  const [nueva, setNueva] = useState(false);
  const semana = clasesPorDiaDeSemana(db, fecha);
  const dia = semana.find((d) => d.fecha === fecha) ?? { fecha, clases: [] };
  const cierre = db.config.diasCierre.find((d) => d.fecha === fecha);

  return (
    <div>
      <Encabezado
        titulo="Calendario"
        subtitulo={may(mesLargo(fecha))}
        acciones={
          <>
            <Segmentado className="hidden md:inline-flex" tamano="sm" valor={vista} onCambio={setVista} opciones={[{ valor: 'DIA', texto: 'Día' }, { valor: 'SEMANA', texto: 'Semana' }]} />
            {puede('CLASES_CREAR_CANCELAR') && (
              <Boton tamano="sm" onClick={() => setNueva(true)}><CalendarPlus className="h-5 w-5" /> Nueva clase extraordinaria</Boton>
            )}
          </>
        }
      />

      <TiraSemana semana={semana} fecha={fecha} hoy={hoy} onElegir={setFecha} cierres={new Set(db.config.diasCierre.map((d) => d.fecha))} />

      <div className={cn(vista === 'SEMANA' && 'md:hidden')}>
        <h2 className="text-xl mt-5 mb-3 font-sans font-semibold">{may(fechaLarga(fecha))}{fecha === hoy && <span className="text-brand-600 text-base font-medium"> · hoy</span>}</h2>
        {cierre && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink/5 px-4 py-3 text-ink-soft">
            <DoorClosed className="h-5 w-5 shrink-0" /> <span>Día de cierre: <strong className="text-ink">{cierre.motivo}</strong>. No hay clases.</span>
          </div>
        )}
        {dia.clases.length === 0 && !cierre && <Vacio icono={Moon} titulo="Sin clases este día" texto="No hay clases programadas ni extraordinarias." />}
        <div className="grid gap-3 md:grid-cols-2">
          {dia.clases.map((v) => <TarjetaClase key={v.clase.id} vista={v} />)}
        </div>
      </div>

      {vista === 'SEMANA' && (
        <div className="hidden md:block mt-5">
          <VistaSemana semana={semana} hoy={hoy} cierres={db.config.diasCierre} />
        </div>
      )}

      <HojaNuevaClase abierta={nueva} onCerrar={() => setNueva(false)} fechaInicial={fecha < hoy ? hoy : fecha} onCreada={(f) => { setFecha(f); setNueva(false); }} />
    </div>
  );
}

function TiraSemana({ semana, fecha, hoy, onElegir, cierres }: { semana: { fecha: string; clases: ClaseVista[] }[]; fecha: string; hoy: string; onElegir: (f: string) => void; cierres: Set<string> }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button type="button" aria-label="Semana anterior" onClick={() => onElegir(sumarDias(fecha, -7))} className="h-11 w-11 rounded-full flex items-center justify-center hover:bg-ink/5 tap shrink-0"><ChevronLeft className="h-6 w-6" /></button>
      <div className="flex-1 grid grid-cols-7 gap-1">
        {semana.map((d) => {
          const activa = d.fecha === fecha;
          const esHoy = d.fecha === hoy;
          const cerrado = cierres.has(d.fecha);
          const n = d.clases.filter((c) => c.clase.estado === 'PROGRAMADA').length;
          return (
            <button
              key={d.fecha} type="button" onClick={() => onElegir(d.fecha)} aria-pressed={activa}
              className={cn('h-[68px] rounded-2xl flex flex-col items-center justify-center gap-0.5 tap border', activa ? 'bg-brand-500 text-white border-brand-500 shadow-lift' : cerrado ? 'bg-ink/5 text-ink-muted border-transparent' : 'bg-white border-ink/5 hover:border-brand-200')}
            >
              <span className={cn('text-xs font-semibold uppercase', activa ? 'text-white/80' : 'text-ink-muted')}>{DIAS_SEMANA_CORTO[diaSemanaDe(d.fecha)]}</span>
              <span className={cn('text-lg font-bold leading-none', esHoy && !activa && 'text-brand-600')}>{Number(d.fecha.slice(8))}</span>
              <span className={cn('text-[11px] leading-none', activa ? 'text-white/80' : 'text-ink-muted')}>{cerrado ? 'cierre' : n ? `${n} cl.` : '·'}</span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Semana siguiente" onClick={() => onElegir(sumarDias(fecha, 7))} className="h-11 w-11 rounded-full flex items-center justify-center hover:bg-ink/5 tap shrink-0"><ChevronRight className="h-6 w-6" /></button>
      {fecha !== hoy && <Boton variante="suave" tamano="sm" onClick={() => onElegir(hoy)} className="hidden sm:inline-flex">Hoy</Boton>}
    </div>
  );
}

export function TarjetaClase({ vista }: { vista: ClaseVista }) {
  const { clase, actividad, monitor, ocupadas } = vista;
  const cancelada = clase.estado === 'CANCELADA';
  const cs = clasesSueltasDe(vista);
  return (
    <Link to={`/clase/${clase.id}`} className={cn('block bg-white rounded-2xl shadow-card border border-ink/5 p-4 tap hover:border-brand-200', cancelada && 'opacity-70')}>
      <div className="flex gap-4">
        <div className="w-16 shrink-0 text-center">
          <div className="text-xl font-bold leading-tight">{clase.horaInicio}</div>
          <div className="text-xs text-ink-muted">{horaFin(clase.horaInicio, clase.duracionMin)}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PuntoColor color={actividad.color} />
            <span className={cn('font-semibold text-lg leading-tight', cancelada && 'line-through')}>{actividad.nombre}</span>
            {clase.extraordinaria && <Chip tono="cocoa">Extraordinaria</Chip>}
            {cancelada && <Chip tono="rojo">Cancelada</Chip>}
            {!cancelada && ocupadas >= clase.plazas && <Chip tono="ambar">Completa</Chip>}
            {cs > 0 && <Chip tono="cocoa">{cs} CS</Chip>}
          </div>
          <div className="text-sm text-ink-muted mt-0.5">{monitor ? `${monitor.nombre} ${monitor.apellidos}` : 'Sin monitor'} · {clase.duracionMin} min</div>
          <div className="mt-2 flex items-center gap-3">
            <BarraOcupacion ocupadas={ocupadas} plazas={clase.plazas} className="flex-1" />
            <span className="text-sm font-semibold tabular-nums">{ocupadas}/{clase.plazas}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function VistaSemana({ semana, hoy, cierres }: { semana: { fecha: string; clases: ClaseVista[] }[]; hoy: string; cierres: { fecha: string; motivo: string }[] }) {
  const dias = semana.slice(0, 6);
  return (
    <div className="grid grid-cols-6 gap-2">
      {dias.map((d) => {
        const cierre = cierres.find((c) => c.fecha === d.fecha);
        return (
          <div key={d.fecha} className="min-w-0">
            <div className={cn('text-center text-sm font-semibold mb-2 rounded-xl py-1', d.fecha === hoy ? 'bg-brand-50 text-brand-700' : 'text-ink-soft')}>
              {DIAS_SEMANA_CORTO[diaSemanaDe(d.fecha)]} {Number(d.fecha.slice(8))}
            </div>
            <div className="space-y-1.5">
              {cierre && <div className="rounded-xl bg-ink/5 text-ink-muted text-xs p-2 text-center">Cierre: {cierre.motivo}</div>}
              {d.clases.map((v) => (
                <Link
                  key={v.clase.id} to={`/clase/${v.clase.id}`}
                  className={cn('block rounded-xl border-l-4 bg-white shadow-card p-2 text-xs tap hover:ring-2 hover:ring-brand-200', v.clase.estado === 'CANCELADA' && 'opacity-60')}
                  style={{ borderLeftColor: v.actividad.color }}
                >
                  <div className="flex justify-between font-semibold"><span>{v.clase.horaInicio}</span><span className="tabular-nums">{v.ocupadas}/{v.clase.plazas}</span></div>
                  <div className={cn('truncate text-ink-soft', v.clase.estado === 'CANCELADA' && 'line-through')}>{v.actividad.nombre}</div>
                  <BarraOcupacion ocupadas={v.ocupadas} plazas={v.clase.plazas} className="mt-1 h-1" />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HojaNuevaClase({ abierta, onCerrar, fechaInicial, onCreada }: { abierta: boolean; onCerrar: () => void; fechaInicial: string; onCreada: (fecha: string) => void }) {
  const { db, ejecutar } = useTrabajador();
  const mons = monitores(db);
  const acts = db.actividades.filter((a) => a.activa);
  const [f, setF] = useState({ actividadId: acts[0]?.id ?? '', fecha: fechaInicial, horaInicio: '10:00', duracionMin: 55, monitorId: mons[0]?.id ?? '', plazas: 8 });
  const [ultimaFecha, setUltimaFecha] = useState(fechaInicial);
  if (ultimaFecha !== fechaInicial) { setUltimaFecha(fechaInicial); setF((x) => ({ ...x, fecha: fechaInicial })); }
  const cierre = esDiaCierre(f.fecha, db.config);

  const guardar = async () => {
    if (!f.actividadId || !f.fecha || !f.horaInicio || !f.monitorId) return toast.error('Completa todos los campos.');
    const r = await ejecutar('crearClaseExtraordinaria', { ...f, duracionMin: Number(f.duracionMin), plazas: Number(f.plazas) });
    if (r.ok) { toast.ok('Clase extraordinaria creada.'); onCreada(f.fecha); } else toast.error(r.error);
  };

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Nueva clase extraordinaria">
      <div className="space-y-4">
        <Seleccion etiqueta="Actividad" value={f.actividadId} onChange={(e) => setF({ ...f, actividadId: e.target.value })}>
          {acts.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </Seleccion>
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Fecha" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
          <Entrada etiqueta="Hora" type="time" value={f.horaInicio} onChange={(e) => setF({ ...f, horaInicio: e.target.value })} />
        </div>
        {cierre && <p className="text-sm text-clay font-medium">Ese día está marcado como cierre del centro.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Duración (min)" type="number" min={15} step={5} value={f.duracionMin} onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} />
          <Entrada etiqueta="Plazas" type="number" min={1} value={f.plazas} onChange={(e) => setF({ ...f, plazas: Number(e.target.value) })} />
        </div>
        <Seleccion etiqueta="Monitor/a" value={f.monitorId} onChange={(e) => setF({ ...f, monitorId: e.target.value })}>
          {mons.map((m) => <option key={m.id} value={m.id}>{m.nombre} {m.apellidos}</option>)}
        </Seleccion>
        <Boton ancho onClick={guardar} disabled={cierre}>Crear clase</Boton>
      </div>
    </Hoja>
  );
}

