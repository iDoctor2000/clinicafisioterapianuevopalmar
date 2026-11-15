/**
 * "El día de hoy": la pantalla de cada mañana para el equipo. Junta lo que hay hoy (clases,
 * quién viene, a quién tener un detalle) y lo que conviene mirar (fijos sin plaza, listas sin
 * pasar, altas nuevas). Solo lee datos: no cambia nada.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, ClipboardCheck, Moon, PartyPopper, Sparkles, Sun, UserPlus, Users } from 'lucide-react';
import type { ClaseVista } from '@/data/selectores';
import type { Id } from '@/domain/types';
import { DIAS_SEMANA_CORTO, diaSemanaDe, fechaLarga, horaFin, hoyISO, sumarDias } from '@/domain/fechas';
import { HITOS_CLASES } from '@/domain/logros';
import { conteoClases } from '@/data/logros';
import { Chip, Tarjeta } from '@/ui';
import { cn } from '@/lib/cn';
import { IconoActividad } from '@/features/comun/IconoActividad';
import { useTrabajador } from './useTrabajador';
import { AvatarCliente, BarraOcupacion, Encabezado, Seccion, may } from './comunes';
import { BannerSinPublicar } from './SinPublicar';
import { BannerRenovaciones } from './Renovaciones';
import { CumpleanosDeHoy } from './CumpleanosDeHoy';
import {
  agruparPorAlumno, altasRecientes, cifrasDia, claseDestacada, clasesDeDia, clasesSinPasarLista, detallesDeClase, fijosSinPlaza, saludo,
  type ClaseDeHoy, type Detalle,
} from './hoy';

/** "Carmen López" (nombre y primer apellido). */
const nombreCorto = (c: { nombre: string; apellidos: string }) => `${c.nombre} ${c.apellidos.split(' ')[0] ?? ''}`.trim();
/** "lun 16" */
const diaCorto = (fecha: string) => `${DIAS_SEMANA_CORTO[diaSemanaDe(fecha)].toLowerCase()} ${Number(fecha.slice(8, 10))}`;

/** Se refresca cada minuto para que "en curso", "siguiente" y "falta pasar lista" vayan al día. */
function useAhora(): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return ahora;
}

export function Hoy() {
  const { db, sesion, trabajador, puede, limitado } = useTrabajador();
  const ahora = useAhora();
  const hoy = hoyISO(ahora);
  const manana = sumarDias(hoy, 1);
  const clases = useMemo(() => clasesDeDia(db, hoy, ahora), [db, hoy, ahora]);
  const cifras = cifrasDia(clases);
  const destacada = claseDestacada(clases);
  const clasesManana = useMemo(() => clasesDeDia(db, manana, ahora), [db, manana, ahora]);
  const cifrasManana = cifrasDia(clasesManana);
  const cierre = db.config.diasCierre.find((d) => d.fecha === hoy);
  const verAlumnos = puede('CLIENTES_VER') && !limitado;
  const sinPlaza = useMemo(() => (verAlumnos ? agruparPorAlumno(fijosSinPlaza(db, ahora, hoy, 7)) : []), [db, ahora, hoy, verAlumnos]);
  const sinLista = useMemo(() => (puede('ASISTENCIA_REGISTRAR') ? clasesSinPasarLista(db, ahora, hoy, 7) : []), [db, ahora, hoy, puede]);
  const altas = useMemo(() => (verAlumnos ? altasRecientes(db, hoy, 7) : []), [db, hoy, verAlumnos]);
  const nada = sinPlaza.length === 0 && sinLista.length === 0 && altas.length === 0;
  const nombre = (trabajador?.nombre ?? sesion.nombre).split(' ')[0];

  return (
    <div className="max-w-3xl">
      <Encabezado
        titulo={`${saludo(ahora)}, ${nombre}`}
        subtitulo={<span>{may(fechaLarga(hoy))}{limitado && <> · <span className="text-cocoa font-semibold">Solo tus clases</span></>}</span>}
      />

      <BannerSinPublicar />
      <BannerRenovaciones />
      <CumpleanosDeHoy />

      {cierre ? (
        <Tarjeta className="p-5 mb-5 flex items-center gap-3 text-ink-soft"><Moon className="h-6 w-6 shrink-0" /><span>Hoy es día de cierre: <strong className="text-ink">{cierre.motivo}</strong>. No hay clases.</span></Tarjeta>
      ) : cifras.clases > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <Cifra valor={cifras.clases} texto={cifras.clases === 1 ? 'clase hoy' : 'clases hoy'} />
          <Cifra valor={cifras.alumnos} texto={cifras.alumnos === 1 ? 'alumno apuntado' : 'alumnos apuntados'} />
          <Cifra valor={cifras.plazasLibres} texto={cifras.plazasLibres === 1 ? 'plaza libre' : 'plazas libres'} />
          <Cifra valor={cifras.enEspera} texto="en lista de espera" />
        </div>
      )}

      {destacada && <ClaseAhora clase={destacada} />}

      {clases.length > 0 && (
        <Seccion titulo="Clases de hoy" className="mb-6">
          <Tarjeta className="divide-y divide-ink/5">
            {clases.map((c) => <FilaClase key={c.vista.clase.id} clase={c} />)}
          </Tarjeta>
        </Seccion>
      )}
      {clases.length === 0 && !cierre && (
        <Tarjeta className="p-5 mb-6 flex items-center gap-3 text-ink-soft"><Moon className="h-6 w-6 shrink-0" />{limitado ? 'Hoy no tienes clases.' : 'Hoy no hay clases.'}</Tarjeta>
      )}

      <Seccion titulo="Para mirar" className="mb-6">
        {nada ? (
          <Tarjeta className="p-5 flex items-center gap-3 text-ink-soft"><Sparkles className="h-6 w-6 text-beige-600 shrink-0" /><span><strong className="text-ink">Todo en orden.</strong> No hay nada pendiente de revisar.</span></Tarjeta>
        ) : (
          <div className="space-y-3">
            {sinPlaza.length > 0 && (
              <Tarjeta className="p-4">
                <TituloAviso icono={Users} texto={`${sinPlaza.length === 1 ? '1 alumno de horario fijo' : `${sinPlaza.length} alumnos de horario fijo`} sin plaza esta semana`} />
                <p className="text-sm text-ink-soft mt-1">Su clase está completa. Están primeros en la lista de espera y entran solos si se libera sitio (se les avisa). Si no se libera, se puede subir una plaza o cambiarles de hora.</p>
                <ul className="mt-3 space-y-2">
                  {sinPlaza.map((g) => (
                    <li key={g.cliente.id}>
                      <Link to={`/clientes/${g.cliente.id}`} className="flex items-center gap-3 rounded-xl p-2 -mx-2 hover:bg-sand tap">
                        <AvatarCliente cliente={g.cliente} tamano="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold truncate">{nombreCorto(g.cliente)}</span>
                          <span className="block text-sm text-ink-muted">
                            {g.clases.map((x, i) => (
                              <span key={x.vista.clase.id}>{i > 0 && ' · '}{diaCorto(x.vista.clase.fecha)} {x.vista.clase.horaInicio} {x.vista.actividad?.nombre}{x.posicion ? ` (${x.posicion}º en espera)` : ' (no está en la lista)'}</span>
                            ))}
                          </span>
                        </span>
                        <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}
            {sinLista.length > 0 && (
              <Tarjeta className="p-4">
                <TituloAviso icono={ClipboardCheck} texto={`${sinLista.length === 1 ? '1 clase' : `${sinLista.length} clases`} de esta semana sin pasar lista`} />
                <p className="text-sm text-ink-soft mt-1">Las medallas y el cliente del mes salen de la asistencia. Se puede marcar ahora, entrando en la clase.</p>
                <ul className="mt-3 space-y-1">
                  {sinLista.map((v) => (
                    <li key={v.clase.id}>
                      <Link to={`/clase/${v.clase.id}`} className="flex items-center gap-3 rounded-xl p-2 -mx-2 hover:bg-sand tap">
                        <IconoActividad actividad={v.actividad} tamano="xs" />
                        <span className="flex-1 min-w-0 truncate"><strong>{v.clase.fecha === hoy ? 'Hoy' : may(diaCorto(v.clase.fecha))}</strong> {v.clase.horaInicio} · {v.actividad?.nombre}{v.monitor ? ` · ${v.monitor.nombre}` : ''}</span>
                        <span className="text-sm text-ink-muted tabular-nums shrink-0">{v.ocupadas} al.</span>
                        <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}
            {altas.length > 0 && (
              <Tarjeta className="p-4">
                <TituloAviso icono={UserPlus} texto={altas.length === 1 ? '1 alumno nuevo esta semana' : `${altas.length} alumnos nuevos esta semana`} />
                <p className="text-sm text-ink-soft mt-1">Para darles la bienvenida en su primera clase.</p>
                <ul className="mt-3 space-y-1">
                  {altas.map((c) => (
                    <li key={c.id}>
                      <Link to={`/clientes/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 -mx-2 hover:bg-sand tap">
                        <AvatarCliente cliente={c} tamano="sm" />
                        <span className="flex-1 min-w-0 truncate font-semibold">{nombreCorto(c)}</span>
                        <span className="text-sm text-ink-muted shrink-0">alta {c.altaEl === hoy ? 'hoy' : `el ${diaCorto(c.altaEl)}`}</span>
                        <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Tarjeta>
            )}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Mañana" className="mb-6">
        <Tarjeta className="p-4 flex items-center gap-3 text-ink-soft">
          <CalendarClock className="h-6 w-6 text-ink-muted shrink-0" />
          {db.config.diasCierre.some((d) => d.fecha === manana) ? <span>{may(fechaLarga(manana))}: día de cierre.</span>
            : cifrasManana.clases === 0 ? <span>{may(fechaLarga(manana))}: {limitado ? 'no tienes clases' : 'no hay clases'}.</span>
              : (
                <span>
                  {may(fechaLarga(manana))}: <strong className="text-ink">{cifrasManana.clases} {cifrasManana.clases === 1 ? 'clase' : 'clases'}</strong>, la primera a las {clasesManana.find((c) => c.momento !== 'CANCELADA')?.vista.clase.horaInicio}.
                  {' '}{cifrasManana.alumnos} apuntados{cifrasManana.completas > 0 ? `, ${cifrasManana.completas === 1 ? '1 completa' : `${cifrasManana.completas} completas`}` : ''}{cifrasManana.enEspera > 0 ? ` y ${cifrasManana.enEspera} en lista de espera` : ''}.
                </span>
              )}
        </Tarjeta>
      </Seccion>
    </div>
  );
}

function Cifra({ valor, texto }: { valor: number; texto: string }) {
  return (
    <div className="rounded-2xl bg-white border border-ink/5 shadow-card px-3 py-3 text-center">
      <div className="font-serif text-3xl leading-none tabular-nums">{valor}</div>
      <div className="text-xs text-ink-muted mt-1">{texto}</div>
    </div>
  );
}

function TituloAviso({ icono: Icono, texto }: { icono: typeof Users; texto: string }) {
  return <p className="flex items-center gap-2 font-semibold text-[17px]"><Icono className="h-5 w-5 text-beige-600 shrink-0" /> {texto}</p>;
}

const MOMENTO: Record<ClaseDeHoy['momento'], { texto: string; tono: 'gris' | 'azul' | 'beige' | 'rojo' }> = {
  PROXIMA: { texto: 'Próxima', tono: 'beige' },
  EN_CURSO: { texto: 'En curso', tono: 'azul' },
  TERMINADA: { texto: 'Terminada', tono: 'gris' },
  CANCELADA: { texto: 'Cancelada', tono: 'rojo' },
};

function FilaClase({ clase }: { clase: ClaseDeHoy }) {
  const { vista, momento, enEspera, sinLista } = clase;
  const { clase: c, actividad, monitor, ocupadas } = vista;
  const cancelada = momento === 'CANCELADA';
  return (
    <Link to={`/clase/${c.id}`} className={cn('flex items-center gap-3 p-3 hover:bg-sand tap', momento === 'TERMINADA' && !sinLista && 'opacity-70')}>
      <div className="w-14 shrink-0 text-center">
        <div className="font-bold leading-tight">{c.horaInicio}</div>
        <div className="text-[11px] text-ink-muted">{horaFin(c.horaInicio, c.duracionMin)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <IconoActividad actividad={actividad} tamano="xs" />
          <span className={cn('font-semibold leading-tight', cancelada && 'line-through')}>{actividad?.nombre}</span>
          <Chip tono={MOMENTO[momento].tono}>{MOMENTO[momento].texto}</Chip>
          {sinLista && <Chip tono="ambar">Falta pasar lista</Chip>}
          {!cancelada && enEspera > 0 && <Chip tono="cocoa">{enEspera} en espera</Chip>}
        </div>
        <div className="text-sm text-ink-muted truncate">{monitor ? `${monitor.nombre} ${monitor.apellidos}` : 'Sin monitor'}</div>
      </div>
      {!cancelada && (
        <div className="w-16 shrink-0">
          <div className={cn('text-sm font-semibold tabular-nums text-right', ocupadas >= c.plazas && 'text-rose')}>{ocupadas}/{c.plazas}</div>
          <BarraOcupacion ocupadas={ocupadas} plazas={c.plazas} className="mt-1" />
        </div>
      )}
      <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
    </Link>
  );
}

/** Alumnos que llegan hoy a una cifra redonda de clases (10, 25, 50, 100…). */
function useHitos(vista: ClaseVista): Map<Id, number> {
  const [hitos, setHitos] = useState<Map<Id, number>>(new Map());
  const clave = vista.reservas.filter((r) => r.estado === 'RESERVADA').map((r) => r.clienteId).sort().join(',');
  const fecha = vista.clase.fecha;
  useEffect(() => {
    if (!clave) { setHitos(new Map()); return; }
    let vivo = true;
    conteoClases(clave.split(','), fecha)
      .then((m) => { if (vivo) setHitos(new Map([...m].filter(([, n]) => HITOS_CLASES.includes(n)))); })
      .catch(() => { /* sin datos: no se muestra nada */ });
    return () => { vivo = false; };
  }, [clave, fecha]);
  return hitos;
}

function textoDetalle(d: Detalle): string {
  if (d.tipo === 'CUMPLE') return '🎂 Cumple hoy';
  if (d.tipo === 'NUEVO') return 'Primera clase';
  return `Vuelve tras ${d.semanas} semanas`;
}

/** La clase en curso o la siguiente, con quién viene y a quién tener un detalle. */
function ClaseAhora({ clase }: { clase: ClaseDeHoy }) {
  const { db } = useTrabajador();
  const { vista, momento } = clase;
  const detalles = useMemo(() => detallesDeClase(db, vista), [db, vista]);
  const hitos = useHitos(vista);
  const alumnos = vista.reservas
    .filter((r) => r.estado === 'RESERVADA')
    .map((r) => db.clientes.find((c) => c.id === r.clienteId))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const conDetalle = alumnos.filter((a) => detalles.has(a.id) || hitos.has(a.id)).length;
  return (
    <Seccion titulo={momento === 'EN_CURSO' ? 'Ahora en clase' : 'Siguiente clase'} className="mb-6">
      <Tarjeta className="p-4">
        <Link to={`/clase/${vista.clase.id}`} className="flex items-center gap-3 tap">
          <span className="h-12 w-12 rounded-2xl bg-beige-100 flex items-center justify-center shrink-0">{momento === 'EN_CURSO' ? <Sun className="h-6 w-6 text-beige-600" /> : <IconoActividad actividad={vista.actividad} tamano="sm" />}</span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-lg leading-tight">{vista.clase.horaInicio} · {vista.actividad?.nombre}</span>
            <span className="block text-sm text-ink-muted">{vista.monitor ? `${vista.monitor.nombre} ${vista.monitor.apellidos}` : 'Sin monitor'} · {vista.ocupadas}/{vista.clase.plazas}{clase.enEspera > 0 ? ` · ${clase.enEspera} en espera` : ''}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
        </Link>
        {alumnos.length === 0 ? <p className="mt-3 text-ink-muted">Todavía no hay nadie apuntado.</p> : (
          <>
            {conDetalle > 0 && <p className="mt-3 text-sm text-ink-soft flex items-center gap-2"><PartyPopper className="h-4 w-4 text-beige-600 shrink-0" /> Hoy hay {conDetalle === 1 ? 'alguien' : `${conDetalle} personas`} a quien tener un detalle.</p>}
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {alumnos.map((a) => {
                const chips = [...(detalles.get(a.id) ?? []).map(textoDetalle), ...(hitos.has(a.id) ? [`🎉 Su clase ${hitos.get(a.id)}`] : [])];
                return (
                  <li key={a.id} className={cn('flex items-center gap-2 rounded-xl px-2 py-1.5', chips.length > 0 && 'bg-beige-50')}>
                    <AvatarCliente cliente={a} tamano="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{nombreCorto(a)}</span>
                      {chips.length > 0 && <span className="block text-xs font-semibold text-cocoa">{chips.join(' · ')}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Tarjeta>
    </Seccion>
  );
}

/** Acceso desde el calendario: "El día de hoy · 7 clases · 2 cosas que mirar ›". */
export function EnlaceHoy() {
  const { db, puede, limitado } = useTrabajador();
  const ahora = useAhora();
  const hoy = hoyISO(ahora);
  const n = useMemo(() => {
    const verAlumnos = puede('CLIENTES_VER') && !limitado;
    return {
      clases: cifrasDia(clasesDeDia(db, hoy, ahora)).clases,
      mirar: (verAlumnos ? agruparPorAlumno(fijosSinPlaza(db, ahora, hoy, 7)).length : 0)
        + (puede('ASISTENCIA_REGISTRAR') ? clasesSinPasarLista(db, ahora, hoy, 7).length : 0)
        + (verAlumnos ? altasRecientes(db, hoy, 7).length : 0),
    };
  }, [db, hoy, ahora, puede, limitado]);
  return (
    <Link to="/hoy" className="mb-4 flex items-center gap-3 rounded-2xl bg-white border border-beige-200 shadow-card px-4 py-3 tap hover:border-beige-300">
      <Sun className="h-5 w-5 text-beige-600 shrink-0" />
      <span className="flex-1 min-w-0 text-ink-soft">
        <strong className="text-ink">El día de hoy</strong>
        {' · '}{n.clases === 0 ? 'sin clases' : n.clases === 1 ? '1 clase' : `${n.clases} clases`}
        {n.mirar > 0 ? <> · <span className="text-cocoa font-semibold">{n.mirar === 1 ? '1 cosa que mirar' : `${n.mirar} cosas que mirar`}</span></> : ' · todo en orden'}
      </span>
      <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
    </Link>
  );
}
