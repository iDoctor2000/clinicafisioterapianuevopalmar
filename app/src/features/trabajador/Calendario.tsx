import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, DoorClosed, Moon } from 'lucide-react';
import type { ClaseVista } from '@/data/selectores';
import { DIAS_SEMANA_CORTO, diaSemanaDe, esDiaCierre, fechaLarga, horaFin, hoyISO, inicioSemana, mesLargo, sumarDias, sumarMeses } from '@/domain/fechas';
import { Boton, Chip, Entrada, Hoja, Seleccion, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { clasesPorDiaDeSemana, clasesPorFechaEntre, clasesSueltasDe, monitores, semanasDelMes, textoRangoSemana } from './consultas';
import { BarraOcupacion, Encabezado, Segmentado, may } from './comunes';
import { CalendarioSemana } from './CalendarioSemana';
import { CalendarioMes } from './CalendarioMes';
import { IconoActividad } from '@/features/comun/IconoActividad';

type Vista = 'DIA' | 'SEMANA' | 'MES';
const CLAVE_VISTA = 'np-cal-vista';
const VISTAS: Vista[] = ['DIA', 'SEMANA', 'MES'];

function leerVista(): Vista {
  try {
    const v = localStorage.getItem(CLAVE_VISTA);
    return VISTAS.includes(v as Vista) ? (v as Vista) : 'DIA';
  } catch { return 'DIA'; }
}

function guardarVista(v: Vista) {
  try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* almacenamiento no disponible */ }
}

export function Calendario() {
  const { db, puede, limitado } = useTrabajador();
  const hoy = hoyISO();
  const [fecha, setFecha] = useState(hoy);
  const [vista, setVistaEstado] = useState<Vista>(leerVista);
  const [nueva, setNueva] = useState(false);
  const semana = clasesPorDiaDeSemana(db, fecha);
  const dia = semana.find((d) => d.fecha === fecha) ?? { fecha, clases: [] };
  const cierre = db.config.diasCierre.find((d) => d.fecha === fecha);
  const setVista = (v: Vista) => { setVistaEstado(v); guardarVista(v); };

  const semanasMes = useMemo(() => semanasDelMes(fecha), [fecha]);
  const clasesMes = useMemo(() => {
    if (vista !== 'MES') return new Map<string, ClaseVista[]>();
    return clasesPorFechaEntre(db, semanasMes[0][0], semanasMes[semanasMes.length - 1][6]);
  }, [db, semanasMes, vista]);

  const subtitulo = vista === 'SEMANA' ? textoRangoSemana(fecha) : may(mesLargo(fecha));

  return (
    <div>
      <Encabezado
        titulo="Calendario"
        subtitulo={<span>{subtitulo}{limitado && <> · <span className="text-cocoa font-semibold">Solo tus clases</span></>}</span>}
        acciones={
          <>
            <Segmentado className="w-full sm:w-auto" valor={vista} onCambio={setVista} opciones={[{ valor: 'DIA', texto: 'Día' }, { valor: 'SEMANA', texto: 'Semana' }, { valor: 'MES', texto: 'Mes' }]} />
            {puede('CLASES_CREAR_CANCELAR') && !limitado && (
              <Boton tamano="sm" onClick={() => setNueva(true)}><CalendarPlus className="h-5 w-5" /> Nueva clase extraordinaria</Boton>
            )}
          </>
        }
      />

      {vista === 'DIA' && (
        <>
          <TiraSemana semana={semana} fecha={fecha} hoy={hoy} onElegir={setFecha} cierres={new Set(db.config.diasCierre.map((d) => d.fecha))} />
          <h2 className="text-xl mt-5 mb-3 font-sans font-semibold">{may(fechaLarga(fecha))}{fecha === hoy && <span className="text-beige-600 text-base font-medium"> · hoy</span>}</h2>
          {cierre && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink/5 px-4 py-3 text-ink-soft">
              <DoorClosed className="h-5 w-5 shrink-0" /> <span>Día de cierre: <strong className="text-ink">{cierre.motivo}</strong>. No hay clases.</span>
            </div>
          )}
          {dia.clases.length === 0 && !cierre && <Vacio icono={Moon} titulo={limitado ? 'No tienes clases este día' : 'Sin clases este día'} texto={limitado ? 'Solo se muestran las clases que impartes.' : 'No hay clases programadas ni extraordinarias.'} />}
          <div className="grid gap-3 md:grid-cols-2">
            {dia.clases.map((v) => <TarjetaClase key={v.clase.id} vista={v} />)}
          </div>
        </>
      )}

      {vista === 'SEMANA' && (
        <>
          <NavegadorRango
            titulo={<><span className="hidden sm:inline">Semana del </span>{textoRangoSemana(fecha)}{inicioSemana(fecha) === inicioSemana(hoy) && <span className="text-beige-600 text-sm font-medium block sm:inline"><span className="hidden sm:inline"> · </span>esta semana</span>}</>}
            etiquetaAnterior="Semana anterior" etiquetaSiguiente="Semana siguiente"
            onAnterior={() => setFecha(sumarDias(fecha, -7))} onSiguiente={() => setFecha(sumarDias(fecha, 7))}
            onHoy={fecha !== hoy ? () => setFecha(hoy) : undefined}
          />
          <CalendarioSemana semana={semana} hoy={hoy} cierres={db.config.diasCierre} limitado={limitado} />
        </>
      )}

      {vista === 'MES' && (
        <>
          <NavegadorRango
            titulo={<>{may(mesLargo(fecha))}{fecha.slice(0, 7) === hoy.slice(0, 7) && <span className="text-beige-600 text-sm font-medium block sm:inline"><span className="hidden sm:inline"> · </span>este mes</span>}</>}
            etiquetaAnterior="Mes anterior" etiquetaSiguiente="Mes siguiente"
            onAnterior={() => setFecha(sumarMeses(fecha, -1))} onSiguiente={() => setFecha(sumarMeses(fecha, 1))}
            onHoy={fecha !== hoy ? () => setFecha(hoy) : undefined}
          />
          <CalendarioMes fecha={fecha} hoy={hoy} cierres={db.config.diasCierre} clasesPorFecha={clasesMes} onElegirDia={(f) => { setFecha(f); setVista('DIA'); }} />
        </>
      )}

      <HojaNuevaClase abierta={nueva} onCerrar={() => setNueva(false)} fechaInicial={fecha < hoy ? hoy : fecha} onCreada={(f) => { setFecha(f); setNueva(false); }} />
    </div>
  );
}

function NavegadorRango({ titulo, etiquetaAnterior, etiquetaSiguiente, onAnterior, onSiguiente, onHoy }: { titulo: ReactNode; etiquetaAnterior: string; etiquetaSiguiente: string; onAnterior: () => void; onSiguiente: () => void; onHoy?: () => void }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 mb-3">
      <button type="button" aria-label={etiquetaAnterior} onClick={onAnterior} className="h-11 w-11 rounded-full flex items-center justify-center hover:bg-ink/5 tap shrink-0"><ChevronLeft className="h-6 w-6" /></button>
      <h2 className="flex-1 min-w-0 text-center text-[17px] sm:text-xl font-sans font-semibold leading-tight">{titulo}</h2>
      <button type="button" aria-label={etiquetaSiguiente} onClick={onSiguiente} className="h-11 w-11 rounded-full flex items-center justify-center hover:bg-ink/5 tap shrink-0"><ChevronRight className="h-6 w-6" /></button>
      {onHoy && <Boton variante="suave" tamano="sm" onClick={onHoy}>Hoy</Boton>}
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
              className={cn('h-[68px] rounded-2xl flex flex-col items-center justify-center gap-0.5 tap border', activa ? 'bg-brand-500 text-sand border-brand-500 shadow-lift' : cerrado ? 'bg-ink/5 text-ink-muted border-transparent' : 'bg-white border-ink/5 hover:border-beige-200')}
            >
              <span className={cn('text-xs font-semibold uppercase', activa ? 'text-white/80' : 'text-ink-muted')}>{DIAS_SEMANA_CORTO[diaSemanaDe(d.fecha)]}</span>
              <span className={cn('text-lg font-bold leading-none', esHoy && !activa && 'text-beige-600')}>{Number(d.fecha.slice(8))}</span>
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
    <Link to={`/clase/${clase.id}`} className={cn('block bg-white rounded-2xl shadow-card border border-ink/5 p-4 tap hover:border-beige-200', cancelada && 'opacity-70')}>
      <div className="flex gap-4">
        <div className="w-16 shrink-0 text-center">
          <div className="text-xl font-bold leading-tight">{clase.horaInicio}</div>
          <div className="text-xs text-ink-muted">{horaFin(clase.horaInicio, clase.duracionMin)}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <IconoActividad actividad={actividad} tamano="xs" />
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

