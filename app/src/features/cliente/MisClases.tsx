import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Ticket, X } from 'lucide-react';
import { addMonths, endOfISOWeek, endOfMonth, format, parseISO, startOfISOWeek, startOfMonth } from 'date-fns';
import type { ISODate } from '@/domain/types';
import { aISODate, diasEntre, fechaLarga, hoyISO, mesLargo } from '@/domain/fechas';
import { recuperacionesDeCliente, reservasDeCliente, type ReservaVista } from '@/data/selectores';
import { Boton, Chip, Tarjeta, Vacio } from '@/ui';
import { cn } from '@/lib/cn';
import { useCliente } from './useCliente';
import { cap, clasesPrevistas, diaMes, periodoTexto, reservasFuturas, reservasPasadas, textoCategorias } from './consultas';
import { ESTADO_RECUPERACION, puntoEstado, type ChipInfo } from './estados';
import { BarraProgreso, Encabezado, HojaCancelar, Pestanas, TarjetaReserva } from './comun';

type Pestana = 'PROXIMAS' | 'PASADAS' | 'RECUPERACIONES';

export function MisClases() {
  const { db, cliente, contrato, tarifa } = useCliente();
  const navegar = useNavigate();
  const ahora = new Date();
  const hoy = hoyISO(ahora);
  const [pestana, setPestana] = useState<Pestana>('PROXIMAS');
  const [mes, setMes] = useState<ISODate>(aISODate(startOfMonth(ahora)));
  const [diaSel, setDiaSel] = useState<ISODate | null>(null);
  const [cancelando, setCancelando] = useState<ReservaVista | null>(null);

  const todas = reservasDeCliente(db, cliente.id);
  const futuras = reservasFuturas(db, cliente.id, ahora);
  const pasadas = reservasPasadas(db, cliente.id, ahora);

  // Rango de meses que se puede recorrer: todo el periodo del contrato y todas las reservas.
  const fechasRef = [hoy, contrato?.fechaInicio, contrato?.fechaFin, todas[0]?.clase.fecha, todas[todas.length - 1]?.clase.fecha].filter((f): f is string => !!f);
  const mesMin = aISODate(startOfMonth(parseISO(fechasRef.reduce((a, b) => (a < b ? a : b)))));
  const mesMax = aISODate(startOfMonth(parseISO(fechasRef.reduce((a, b) => (a > b ? a : b)))));

  const porDia = useMemo(() => {
    const m = new Map<ISODate, ReservaVista[]>();
    for (const v of todas) m.set(v.clase.fecha, [...(m.get(v.clase.fecha) ?? []), v]);
    return m;
  }, [todas]);

  const celdas = useMemo(() => {
    const ini = startOfISOWeek(parseISO(mes));
    const fin = endOfISOWeek(endOfMonth(parseISO(mes)));
    return diasEntre(aISODate(ini), aISODate(fin));
  }, [mes]);

  const delDia = diaSel ? porDia.get(diaSel) ?? [] : [];
  const recuperaciones = recuperacionesDeCliente(db, cliente.id);
  const recDisponibles = recuperaciones.filter((r) => r.estado === 'DISPONIBLE' && r.caducaEl >= hoy);
  const recUsadas = recuperaciones.filter((r) => r.estado === 'USADA');
  const recCaducadas = recuperaciones.filter((r) => r.estado === 'CADUCADA' || (r.estado === 'DISPONIBLE' && r.caducaEl < hoy));
  const previstas = clasesPrevistas(db, contrato);

  const lista = diaSel ? delDia : pestana === 'PROXIMAS' ? futuras : pasadas;

  return (
    <div>
      <Encabezado titulo="Mis clases" subtitulo="Tus reservas, cancelaciones y recuperaciones." />

      <Pestanas
        valor={pestana}
        onCambio={(p) => { setPestana(p); setDiaSel(null); }}
        items={[
          { id: 'PROXIMAS', etiqueta: 'Próximas', contador: futuras.filter((v) => v.reserva.estado === 'RESERVADA').length },
          { id: 'PASADAS', etiqueta: 'Pasadas' },
          { id: 'RECUPERACIONES', etiqueta: 'Recuperaciones', contador: recDisponibles.length },
        ]}
      />

      {pestana !== 'RECUPERACIONES' && (
        <>
          <Tarjeta className="p-3 sm:p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setMes(aISODate(addMonths(parseISO(mes), -1)))} disabled={mes <= mesMin} aria-label="Mes anterior" className="h-11 w-11 rounded-full flex items-center justify-center text-ink-soft hover:bg-sand tap disabled:opacity-30">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <h2 className="text-xl">{cap(mesLargo(mes))}</h2>
              <button type="button" onClick={() => setMes(aISODate(addMonths(parseISO(mes), 1)))} disabled={mes >= mesMax} aria-label="Mes siguiente" className="h-11 w-11 rounded-full flex items-center justify-center text-ink-soft hover:bg-sand tap disabled:opacity-30">
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-xs font-semibold text-ink-muted mb-1">
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {celdas.map((d) => {
                const enMes = d.slice(0, 7) === mes.slice(0, 7);
                const rs = porDia.get(d) ?? [];
                const activo = diaSel === d;
                const esHoy = d === hoy;
                const enPeriodo = contrato ? d >= contrato.fechaInicio && d <= contrato.fechaFin : false;
                const cierre = db.config.diasCierre.some((c) => c.fecha === d);
                return (
                  <button
                    key={d} type="button" onClick={() => setDiaSel(activo ? null : d)} aria-label={fechaLarga(d)} aria-pressed={activo}
                    className={cn('h-12 sm:h-14 rounded-xl flex flex-col items-center justify-center gap-1 tap text-[15px]',
                      !enMes && 'opacity-30', activo ? 'bg-brand-500 text-sand shadow-lift' : esHoy ? 'bg-beige-100 text-ink font-bold' : enPeriodo ? 'hover:bg-sand' : 'text-ink-muted',
                      cierre && !activo && 'bg-sand-deep text-ink-muted')}
                  >
                    <span className={cn('leading-none', esHoy && 'font-bold')}>{format(parseISO(d), 'd')}</span>
                    <span className="flex gap-0.5 h-1.5">
                      {rs.slice(0, 3).map((v) => (
                        <span key={v.reserva.id} className={cn('h-1.5 w-1.5 rounded-full', activo ? 'bg-white' : puntoEstado(v.reserva, v.clase, ahora))} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              <Leyenda color="bg-brand-500" texto="Reservada" />
              <Leyenda color="bg-clay" texto="Cancelada · recuperable" />
              <Leyenda color="bg-rose" texto="Cancelada · no recuperable" />
              <Leyenda color="bg-sky" texto="Cancelada por el centro" />
              <Leyenda color="bg-ink/30" texto="No asististe" />
            </div>
          </Tarjeta>

          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-xl truncate">{diaSel ? cap(fechaLarga(diaSel)) : pestana === 'PROXIMAS' ? 'Próximas clases' : 'Clases pasadas'}</h2>
            {diaSel && (
              <Boton variante="suave" tamano="sm" onClick={() => setDiaSel(null)}><X className="h-4 w-4" /> Ver todas</Boton>
            )}
          </div>

          {lista.length === 0 ? (
            <Tarjeta>
              {diaSel ? (
                <Vacio icono={CalendarDays} titulo="No tienes clases este día" accion={pestana === 'PROXIMAS' && diaSel >= hoy ? <Boton variante="suave" onClick={() => navegar('/horario')}>Ver el horario</Boton> : undefined} />
              ) : pestana === 'PROXIMAS' ? (
                <Vacio icono={Ticket} titulo="No tienes clases reservadas" texto="Elige un día en el horario y reserva tu plaza." accion={<Boton onClick={() => navegar('/horario')}>Reservar clase</Boton>} />
              ) : (
                <Vacio icono={CalendarDays} titulo="Todavía no has hecho ninguna clase" />
              )}
            </Tarjeta>
          ) : (
            <ul className="space-y-3">
              {lista.map((v) => <li key={v.reserva.id}><TarjetaReserva vista={v} ahora={ahora} onCancelar={setCancelando} /></li>)}
            </ul>
          )}
        </>
      )}

      {pestana === 'RECUPERACIONES' && (
        <>
          <section className="mb-5">
            <h2 className="text-xl mb-3">Tu tarifa</h2>
            {tarifa && contrato ? (
              <Tarjeta className="p-5">
                <p className="text-lg font-semibold leading-snug">{tarifa.nombre}</p>
                <p className="text-ink-soft">{cap(periodoTexto(contrato))}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tono={contrato.modalidad === 'FIJO' ? 'cocoa' : 'azul'}>{contrato.modalidad === 'FIJO' ? 'Horario fijo' : 'Turno libre'}</Chip>
                  {previstas != null && <Chip tono="gris">{previstas} clases previstas en el periodo</Chip>}
                </div>
                {tarifa.tipo === 'BONO' && tarifa.bono && (
                  <div className="mt-4 rounded-2xl bg-sand p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">Te quedan {contrato.sesionesRestantes ?? 0} de {tarifa.bono.sesiones} sesiones</span>
                    </div>
                    <BarraProgreso valor={contrato.sesionesRestantes ?? 0} total={tarifa.bono.sesiones} className="mt-2" />
                    <p className="text-sm text-ink-soft mt-2">El bono caduca el {diaMes(contrato.fechaFin)}.</p>
                  </div>
                )}
              </Tarjeta>
            ) : (
              <Tarjeta className="p-5 text-ink-soft">No tienes una tarifa activa. Pregunta en recepción.</Tarjeta>
            )}
          </section>

          <section className="mb-5">
            <h2 className="text-xl mb-3">Recuperaciones</h2>
            {recuperaciones.length === 0 ? (
              <Tarjeta><Vacio icono={RefreshCw} titulo="No tienes recuperaciones" texto={`Si cancelas una clase con más de ${db.config.minutosAntelacionCancelacion} minutos de antelación, podrás recuperarla otro día.`} /></Tarjeta>
            ) : (
              <div className="space-y-4">
                {recDisponibles.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Disponibles</p>
                    <ul className="space-y-3">
                      {recDisponibles.map((r) => (
                        <li key={r.id}>
                          <Tarjeta className="p-4 border-beige-200">
                            <div className="flex items-center gap-2 mb-1">
                              <RefreshCw className="h-5 w-5 text-sky shrink-0" />
                              <p className="font-semibold text-lg">Recuperación disponible</p>
                            </div>
                            <p className="text-ink-soft">Sirve para: <span className="font-semibold text-ink">{textoCategorias(r.categoriasPermitidas)}</span></p>
                            <p className="text-ink-soft">Caduca el <span className="font-semibold text-ink">{diaMes(r.caducaEl)}</span></p>
                            {r.nota && <p className="text-sm text-ink-muted mt-1">{r.nota}</p>}
                            <Boton variante="suave" ancho className="mt-3" onClick={() => navegar('/horario')}>Usar esta recuperación</Boton>
                          </Tarjeta>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {recUsadas.length > 0 && <ListaRec titulo="Usadas" items={recUsadas.map((r) => ({ id: r.id, texto: `Usada · ${textoCategorias(r.categoriasPermitidas)}`, chip: ESTADO_RECUPERACION.USADA }))} />}
                {recCaducadas.length > 0 && <ListaRec titulo="Caducadas" items={recCaducadas.map((r) => ({ id: r.id, texto: `Caducó el ${diaMes(r.caducaEl)}`, chip: ESTADO_RECUPERACION.CADUCADA }))} />}
              </div>
            )}
          </section>
        </>
      )}

      <HojaCancelar vista={cancelando} onCerrar={() => setCancelando(null)} />
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return <span className="inline-flex items-center gap-1"><span className={cn('h-2 w-2 rounded-full', color)} />{texto}</span>;
}

function ListaRec({ titulo, items }: { titulo: string; items: { id: string; texto: string; chip: ChipInfo }[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">{titulo}</p>
      <Tarjeta className="divide-y divide-ink/5">
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 p-4 text-ink-soft">
            <span>{i.texto}</span>
            <Chip tono={i.chip.tono}>{i.chip.texto}</Chip>
          </div>
        ))}
      </Tarjeta>
    </div>
  );
}
