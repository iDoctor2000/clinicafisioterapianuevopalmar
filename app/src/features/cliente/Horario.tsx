import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, DoorClosed, Hourglass, Info, User, Users } from 'lucide-react';
import { useStore } from '@/data/store';
import { recuperacionesDisponiblesDe, vistaClase, type ClaseVista, type ReservaVista } from '@/data/selectores';
import { CATEGORIA_LABEL } from '@/domain/types';
import type { ISODate } from '@/domain/types';
import { DIAS_SEMANA_CORTO, diaSemanaDe, fechaLarga, horaFin, hoyISO, inicioSemana, sumarDias } from '@/domain/fechas';
import { parseISO, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Boton, Chip, Hoja, Tarjeta, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { IconoActividad } from '@/features/comun/IconoActividad';
import { useCliente } from './useCliente';
import { actividadIncluida, cap, clasesVisiblesDelDia, enEsperaDe, evaluarReservaDe, evaluarReservaSinPlazas, listaEsperaDisponible, miEntradaEnLista, opcionesDeCambio, posicionEnLista, recuperacionCubre, reservaActivaEn, vistaReserva } from './consultas';
import { Encabezado, HojaCancelar, Nota, Pestanas, PuntoActividad } from './comun';
import { HorarioSemana } from './HorarioSemana';
import { HORAS_CIERRE_LISTA_ESPERA } from '@/domain/rules';

const DIAS_TIRA = 14;
const MAX_SEMANAS = 8;

export function Horario() {
  const { db, cliente, contrato, tarifa } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const ahora = new Date();
  const hoy = hoyISO(ahora);

  const [inicio, setInicio] = useState<ISODate>(hoy);
  const [fecha, setFecha] = useState<ISODate>(hoy);
  const [vista, setVista] = useState<'DIA' | 'SEMANA'>('DIA');
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<ReservaVista | null>(null);

  const dias = useMemo(() => Array.from({ length: DIAS_TIRA }, (_, i) => sumarDias(inicio, i)), [inicio]);
  const limiteInicio = sumarDias(hoy, MAX_SEMANAS * 7 - DIAS_TIRA);
  const limiteFin = sumarDias(limiteInicio, DIAS_TIRA - 1);
  const clases = clasesVisiblesDelDia(db, cliente.id, fecha);
  const cierre = db.config.diasCierre.find((d) => d.fecha === fecha) ?? null;
  const recuperaciones = recuperacionesDisponiblesDe(db, cliente.id, hoy);

  const irAFecha = (f: ISODate) => {
    if (f < inicio || f > sumarDias(inicio, DIAS_TIRA - 1)) setInicio(f < hoy ? hoy : f);
    setFecha(f);
  };
  const moverSemana = (n: number) => {
    const nuevo = sumarDias(inicio, n * 7);
    const acotado = nuevo < hoy ? hoy : nuevo > limiteInicio ? limiteInicio : nuevo;
    setInicio(acotado);
    setFecha(acotado);
  };
  // Vista Semana: la semana natural (lunes-domingo) de la fecha elegida, dentro del mismo rango que la tira.
  const lunesActual = inicioSemana(fecha);
  const puedeSemanaAnterior = lunesActual > inicioSemana(hoy);
  const puedeSemanaSiguiente = sumarDias(lunesActual, 7) <= limiteFin;
  const moverSemanaNatural = (n: number) => {
    const lunes = sumarDias(lunesActual, n * 7);
    irAFecha(lunes < hoy ? hoy : lunes);
  };

  // Desplaza la tira para que el día elegido quede a la vista.
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const el = refs.current[fecha];
    try { el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch { /* navegadores antiguos */ }
  }, [fecha]);

  const detalleClase = detalleId ? db.clases.find((c) => c.id === detalleId) ?? null : null;
  const detalleVista: ClaseVista | null = detalleClase ? vistaClase(db, detalleClase) : null;

  /** Fila de una clase (lista diaria y semanal): misma lógica de chips y atenuado. */
  const filaClase = (v: ClaseVista, compacta = false): ReactNode => {
    const mia = reservaActivaEn(db, cliente.id, v.clase.id);
    const espera = miEntradaEnLista(db, cliente.id, v.clase.id);
    const enEspera = enEsperaDe(db, v.clase);
    const cancelada = v.clase.estado === 'CANCELADA';
    const incluida = actividadIncluida(tarifa, contrato, v.actividad) || recuperacionCubre(recuperaciones, v.actividad.categoria);
    const alternativa = v.clase.claseAlternativaId ? db.clases.find((c) => c.id === v.clase.claseAlternativaId) ?? null : null;
    const pasada = v.clase.fecha === hoy && v.clase.horaInicio < format(ahora, 'HH:mm');
    const atenuada = (cancelada || !incluida || pasada) && !mia;
    return (
      <Tarjeta className={cn(atenuada && 'bg-white/60', mia && 'border-beige-300')}>
        <button type="button" data-clase={v.clase.id} onClick={() => setDetalleId(v.clase.id)} className={cn('w-full text-left flex items-center gap-3 tap rounded-2xl hover:bg-sand/60', compacta ? 'px-3 py-2.5 min-h-[64px]' : 'p-4')}>
          <div className={cn('w-[4.25rem] shrink-0 text-center rounded-xl py-2', atenuada ? 'bg-sand-deep text-ink-muted' : mia ? 'bg-brand-500 text-sand' : 'bg-beige-100 text-ink')}>
            <div className="text-xl font-bold leading-none">{v.clase.horaInicio}</div>
            {!compacta && <div className={cn('text-xs mt-1', mia && !atenuada ? 'text-white/85' : '')}>{v.clase.duracionMin} min</div>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <IconoActividad actividad={v.actividad} tamano="sm" className={cn(atenuada && 'opacity-50')} />
              <span className={cn('font-semibold text-lg truncate', cancelada && 'line-through', atenuada && 'text-ink-soft')}>{v.actividad.nombre}</span>
            </div>
            {!compacta && v.monitor && <div className="text-sm text-ink-muted">Con {v.monitor.nombre}</div>}
            <div className={cn('flex flex-wrap gap-1.5', compacta ? 'mt-1' : 'mt-1.5')}>
              {cancelada ? <Chip tono="rojo">Cancelada</Chip>
                : mia ? <Chip tono="beige">Tienes plaza</Chip>
                : pasada ? <Chip tono="gris">Ya ha empezado</Chip>
                : espera ? <Chip tono="azul">En lista de espera ({posicionEnLista(db, espera)}º)</Chip>
                : v.libresAlumnos > 0 ? <Chip tono={v.libresAlumnos <= 2 ? 'ambar' : 'gris'}>{v.libresAlumnos === 1 ? '1 plaza libre' : `${v.libresAlumnos} plazas libres`}</Chip>
                : <Chip tono="rojo">Completa{enEspera > 0 ? ` · ${enEspera} en espera` : ''}</Chip>}
              {!incluida && !cancelada && !mia && <Chip tono="gris">{compacta ? 'No incluida' : 'No incluida en tu tarifa'}</Chip>}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
        </button>
        {cancelada && !compacta && (
          <div className="px-4 pb-4 -mt-1">
            {v.clase.motivoCancelacion && <p className="text-sm text-ink-soft mb-2">Motivo: {v.clase.motivoCancelacion}</p>}
            {alternativa && (
              <Boton variante="suave" tamano="sm" onClick={() => { irAFecha(alternativa.fecha); setDetalleId(alternativa.id); }}>
                Ver clase alternativa ({fechaLarga(alternativa.fecha)} a las {alternativa.horaInicio})
              </Boton>
            )}
          </div>
        )}
      </Tarjeta>
    );
  };

  const reservar = async (claseId: string) => {
    const r = await ejecutar('reservar', { claseId });
    if (r.ok) {
      const v = vistaReserva(r.db, r.valor);
      toast.ok(`Plaza reservada: ${v.actividad.nombre}, ${fechaLarga(v.clase.fecha)} a las ${v.clase.horaInicio}.`);
      setDetalleId(null);
    } else {
      toast.error(r.error);
    }
  };

  return (
    <div>
      <Encabezado titulo="Horario" subtitulo={vista === 'DIA' ? 'Elige un día y toca una clase para ver los detalles.' : 'Toca una clase para ver los detalles o reservar.'} />

      <Pestanas valor={vista} onCambio={setVista} items={[{ id: 'DIA', etiqueta: 'Día' }, { id: 'SEMANA', etiqueta: 'Semana' }]} />

      {vista === 'DIA' && (
        <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <button type="button" onClick={() => moverSemana(-1)} disabled={inicio <= hoy} aria-label="Semana anterior" className="h-12 w-12 rounded-full bg-white shadow-card flex items-center justify-center text-ink-soft tap disabled:opacity-30">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <p className="font-semibold text-ink-soft text-center">
          {inicio === hoy ? 'Próximos 14 días' : `Desde el ${format(parseISO(inicio), "d 'de' MMMM", { locale: es })}`}
        </p>
        <button type="button" onClick={() => moverSemana(1)} disabled={inicio >= limiteInicio} aria-label="Semana siguiente" className="h-12 w-12 rounded-full bg-white shadow-card flex items-center justify-center text-ink-soft tap disabled:opacity-30">
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-3 snap-x" role="tablist" aria-label="Días">
        {dias.map((d) => {
          const activo = d === fecha;
          const esHoy = d === hoy;
          const cerrado = db.config.diasCierre.some((c) => c.fecha === d);
          const dow = diaSemanaDe(d);
          return (
            <button
              key={d} ref={(el) => { refs.current[d] = el; }} type="button" role="tab" aria-selected={activo} onClick={() => setFecha(d)}
              className={cn('snap-center shrink-0 w-[4.25rem] h-[4.75rem] rounded-2xl flex flex-col items-center justify-center gap-0.5 tap border',
                activo ? 'bg-brand-500 text-sand border-brand-500 shadow-lift' : 'bg-white text-ink border-ink/5 shadow-card',
                !activo && cerrado && 'text-ink-muted bg-sand-deep', !activo && (dow === 7) && 'text-ink-muted')}
            >
              <span className={cn('text-xs font-semibold uppercase', activo ? 'text-white/90' : 'text-ink-muted')}>{esHoy ? 'Hoy' : DIAS_SEMANA_CORTO[dow]}</span>
              <span className="text-2xl font-bold leading-none">{format(parseISO(d), 'd')}</span>
              <span className={cn('text-[11px]', activo ? 'text-white/80' : 'text-ink-muted')}>{format(parseISO(d), 'MMM', { locale: es })}</span>
            </button>
          );
        })}
      </div>

      <h2 className="text-xl mt-2 mb-3">{cap(fechaLarga(fecha))}</h2>

      {cierre ? (
        <Tarjeta><Vacio icono={DoorClosed} titulo="Centro cerrado" texto={cierre.motivo} /></Tarjeta>
      ) : clases.length === 0 ? (
        <Tarjeta><Vacio icono={CalendarDays} titulo="No hay clases este día" texto="Prueba con otro día de la semana." /></Tarjeta>
      ) : (
        <ul className="space-y-3">
          {clases.map((v) => <li key={v.clase.id}>{filaClase(v)}</li>)}
        </ul>
      )}
        </>
      )}

      {vista === 'SEMANA' && (
        <HorarioSemana
          fecha={fecha} hoy={hoy} desde={hoy} hasta={limiteFin} cierres={db.config.diasCierre}
          clasesDe={(d) => clasesVisiblesDelDia(db, cliente.id, d)} renderClase={(v) => filaClase(v, true)}
          puedeAnterior={puedeSemanaAnterior} puedeSiguiente={puedeSemanaSiguiente}
          onAnterior={() => moverSemanaNatural(-1)} onSiguiente={() => moverSemanaNatural(1)}
        />
      )}

      <p className="text-sm text-ink-muted mt-5 mb-2 flex items-start gap-2"><Info className="h-4 w-4 mt-0.5 shrink-0" /> Puedes reservar con hasta {db.config.diasVentanaReserva} días de antelación. Para cancelar y poder recuperar la clase, hazlo con más de {db.config.minutosAntelacionCancelacion} minutos de antelación.</p>

      {detalleVista && (
        <HojaDetalleClase
          vista={detalleVista}
          ahora={ahora}
          onCerrar={() => setDetalleId(null)}
          onReservar={() => reservar(detalleVista.clase.id)}
          onCancelar={() => {
            const mia = reservaActivaEn(db, cliente.id, detalleVista.clase.id);
            if (mia) { setCancelando(vistaReserva(db, mia)); setDetalleId(null); }
          }}
        />
      )}
      <HojaCancelar vista={cancelando} onCerrar={() => setCancelando(null)} />
    </div>
  );
}

function HojaDetalleClase({ vista, ahora, onCerrar, onReservar, onCancelar }: { vista: ClaseVista; ahora: Date; onCerrar: () => void; onReservar: () => void; onCancelar: () => void }) {
  const { db, cliente } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const { clase, actividad, monitor, libresAlumnos: libres } = vista;
  const mia = reservaActivaEn(db, cliente.id, clase.id);
  const ev = mia ? null : evaluarReservaDe(db, cliente.id, clase.id, ahora);
  const recuperaciones = recuperacionesDisponiblesDe(db, cliente.id, hoyISO(ahora));
  // Lista de espera (0021): solo si la clase está completa y faltan más de 2 horas.
  const espera = miEntradaEnLista(db, cliente.id, clase.id);
  const enEspera = enEsperaDe(db, clase);
  const ofrecerLista = listaEsperaDisponible(db, cliente.id, vista, ahora);
  const evSinPlazas = ofrecerLista && !espera ? evaluarReservaSinPlazas(db, cliente.id, clase.id, ahora) : null;
  const opciones = ofrecerLista && !espera ? opcionesDeCambio(db, cliente.id, clase.id, ahora) : [];
  const [modo, setModo] = useState<'NORMAL' | 'CAMBIO'>(evSinPlazas && !evSinPlazas.ok && opciones.some((o) => !o.motivo) ? 'CAMBIO' : 'NORMAL');
  const [cambioId, setCambioId] = useState<string>(opciones.find((o) => !o.motivo)?.vista.reserva.id ?? '');
  const [enviando, setEnviando] = useState(false);
  const puedeApuntarse = modo === 'NORMAL' ? !!evSinPlazas?.ok : !!cambioId;

  const apuntarse = async () => {
    if (enviando) return;
    setEnviando(true);
    const r = await ejecutar('apuntarListaEspera', { claseId: clase.id, reservaCambioId: modo === 'CAMBIO' ? cambioId : null });
    setEnviando(false);
    if (r.ok) toast.ok(`Estás en la lista de espera (posición ${r.valor.posicion}). Te avisaremos si entras.`);
    else toast.error(r.error);
  };
  const salir = async () => {
    if (enviando) return;
    setEnviando(true);
    const r = await ejecutar('salirListaEspera', { claseId: clase.id });
    setEnviando(false);
    if (r.ok) toast.ok('Ya no estás en la lista de espera.');
    else toast.error(r.error);
  };

  let viaTexto: string | null = null;
  if (ev?.ok) {
    if (ev.via === 'RECUPERACION') viaTexto = `Se usará una de tus recuperaciones${recuperaciones.length > 1 ? ` (tienes ${recuperaciones.length})` : ''}.`;
    else viaTexto = ev.mensaje;
    if (ev.via === 'RECUPERACION' && ev.mensaje.startsWith('Semana completa')) viaTexto = `Ya tienes todas las clases de esta semana, así que se usará una de tus recuperaciones.`;
  }

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={actividad.nombre}>
      <div className="flex items-center gap-2 text-ink-soft"><PuntoActividad color={actividad.color} />{CATEGORIA_LABEL[actividad.categoria] === actividad.nombre ? 'Clase en máquina' : CATEGORIA_LABEL[actividad.categoria]}</div>
      <ul className="mt-3 space-y-2 text-[17px]">
        <li className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-beige-600 shrink-0" /> {cap(fechaLarga(clase.fecha))}</li>
        <li className="flex items-center gap-2"><Clock className="h-5 w-5 text-beige-600 shrink-0" /> De {clase.horaInicio} a {horaFin(clase.horaInicio, clase.duracionMin)} ({clase.duracionMin} min)</li>
        {monitor && <li className="flex items-center gap-2"><User className="h-5 w-5 text-beige-600 shrink-0" /> Con {monitor.nombre} {monitor.apellidos}</li>}
        <li className="flex items-center gap-2"><Users className="h-5 w-5 text-beige-600 shrink-0" /> {clase.estado === 'CANCELADA' ? 'Clase cancelada' : libres > 0 ? `Plazas libres: ${libres} de ${clase.plazas}` : `Completa (${clase.plazas} plazas)`}</li>
        {clase.estado !== 'CANCELADA' && enEspera > 0 && <li className="flex items-center gap-2"><Hourglass className="h-5 w-5 text-beige-600 shrink-0" /> {enEspera === 1 ? '1 persona en lista de espera' : `${enEspera} personas en lista de espera`}</li>}
      </ul>
      {actividad.descripcion && <p className="text-ink-soft mt-3 leading-snug">{actividad.descripcion}</p>}

      <div className="mt-4">
        {mia ? (
          <Nota tono="ok">Tienes plaza en esta clase{mia.origen === 'RECUPERACION' ? ' (con una recuperación)' : mia.origen === 'BONO' ? ' (de tu bono)' : ''}.</Nota>
        ) : espera ? (
          <Nota tono="info">Estás en la lista de espera (posición {posicionEnLista(db, espera)}). Si se libera una plaza, entrarás automáticamente y te avisaremos{espera.reservaCambioId ? '; tu otra clase de esa semana se cambiará por esta' : ''}.</Nota>
        ) : ev?.ok ? (
          <Nota tono="ok">{viaTexto}</Nota>
        ) : ev && ev.codigo === 'SIN_PLAZAS' && clase.estado === 'PROGRAMADA' && !ofrecerLista ? (
          <Nota tono="aviso">La clase está completa. La lista de espera se cierra {HORAS_CIERRE_LISTA_ESPERA} horas antes de la clase: si te interesa, pregunta en recepción.</Nota>
        ) : ev && !ofrecerLista ? (
          <Nota tono="aviso">{ev.motivo}</Nota>
        ) : null}
      </div>

      {ofrecerLista && !espera && (
        <div className="mt-4 rounded-2xl bg-sand p-4 space-y-3">
          <p className="font-semibold flex items-center gap-2"><Hourglass className="h-5 w-5 text-beige-600" /> Clase completa: apúntate a la lista de espera</p>
          <p className="text-sm text-ink-soft leading-snug">Si alguien deja su plaza, entra el primero de la lista automáticamente y recibe un aviso. La lista funciona hasta {HORAS_CIERRE_LISTA_ESPERA} horas antes de la clase.</p>
          <div className="grid gap-2" role="radiogroup" aria-label="Cómo entrar">
            <label className={cn('flex items-start gap-3 rounded-xl bg-white p-3 cursor-pointer border', modo === 'NORMAL' ? 'border-brand-500' : 'border-transparent')}>
              <input type="radio" name="modo-espera" className="mt-1 h-5 w-5 accent-brand-500" checked={modo === 'NORMAL'} onChange={() => setModo('NORMAL')} />
              <span className="min-w-0">
                <span className="font-semibold block">Reservar con mi tarifa</span>
                <span className="text-sm text-ink-soft block">{evSinPlazas?.ok ? (evSinPlazas.via === 'RECUPERACION' ? 'Se usaría una de tus recuperaciones.' : evSinPlazas.mensaje) : evSinPlazas?.motivo}</span>
              </span>
            </label>
            {opciones.length > 0 && (
              <label className={cn('flex items-start gap-3 rounded-xl bg-white p-3 cursor-pointer border', modo === 'CAMBIO' ? 'border-brand-500' : 'border-transparent')}>
                <input type="radio" name="modo-espera" className="mt-1 h-5 w-5 accent-brand-500" checked={modo === 'CAMBIO'} onChange={() => setModo('CAMBIO')} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold block">A cambio de otra clase mía de esa semana</span>
                  <span className="text-sm text-ink-soft block">Si entro, mi reserva antigua pasa a esta clase (no gasto nada).</span>
                  {modo === 'CAMBIO' && (
                    <span className="grid gap-1.5 mt-2">
                      {opciones.map((o) => (
                        <label key={o.vista.reserva.id} className={cn('flex items-start gap-2 text-sm rounded-lg px-2 py-1.5', o.motivo ? 'opacity-60' : 'cursor-pointer hover:bg-sand')}>
                          <input type="radio" name="cambio" className="mt-0.5 h-4 w-4 accent-brand-500" disabled={!!o.motivo} checked={cambioId === o.vista.reserva.id} onChange={() => setCambioId(o.vista.reserva.id)} />
                          <span><span className="font-semibold">{o.vista.actividad.nombre}</span>, {fechaLarga(o.vista.clase.fecha)} a las {o.vista.clase.horaInicio}{o.motivo && <span className="block text-ink-muted">{o.motivo}</span>}</span>
                        </label>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-2">
        {mia ? (
          <Boton variante="secundario" tamano="lg" ancho onClick={onCancelar}>Cancelar mi plaza</Boton>
        ) : espera ? (
          <Boton variante="secundario" tamano="lg" ancho cargando={enviando} onClick={() => void salir()}>Salir de la lista de espera</Boton>
        ) : ofrecerLista ? (
          <Boton tamano="lg" ancho disabled={!puedeApuntarse} cargando={enviando} onClick={() => void apuntarse()}>Apuntarme a la lista de espera</Boton>
        ) : (
          <Boton tamano="lg" ancho disabled={!ev?.ok} onClick={onReservar}>Reservar</Boton>
        )}
        <Boton variante="fantasma" ancho onClick={onCerrar}>Volver al horario</Boton>
      </div>
    </Hoja>
  );
}
