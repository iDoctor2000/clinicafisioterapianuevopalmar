import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, ClipboardList, FilePlus2, Tag } from 'lucide-react';
import type { Categoria, Cliente, Contrato, Modalidad, Reserva, Tarifa } from '@/domain/types';
import { CATEGORIA_LABEL } from '@/domain/types';
import { DIAS_SEMANA_LABEL, fechaCorta, fechaLarga, hoyISO, sumarDias, sumarMeses } from '@/domain/fechas';
import { clasificarCancelacion, fechaFinPorDefecto, sesionesPrevistas } from '@/domain/rules';
import { clasesDelDia } from '@/data/selectores';
import { AreaTexto, Boton, Chip, Entrada, Hoja, Interruptor, Seleccion, Tarjeta, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { contratosDeCliente, plantillaVista, resumenCliente, reservasDeClienteSeparadas } from './consultas';
import { ChipAsistencia, ChipEstadoReserva, ChipOrigen, Confirmacion, Dato, PuntoColor, Segmentado, fechaMedia, may } from './comunes';

const TIPO_TARIFA = { RECURRENTE: 'Mensual', BONO: 'Bono', CLASE_SUELTA: 'Clase suelta' } as const;
const ESTADO_CONTRATO = { ACTIVO: { texto: 'Activo', tono: 'verde' }, FINALIZADO: { texto: 'Finalizado', tono: 'gris' }, CANCELADO: { texto: 'Cancelado', tono: 'rojo' } } as const;

// ---------------------------------------------------------------------------
// Tarifa
// ---------------------------------------------------------------------------

export function PestanaTarifa({ cliente }: { cliente: Cliente }) {
  const { db, puede, ejecutar } = useTrabajador();
  const [nueva, setNueva] = useState(false);
  const [finalizar, setFinalizar] = useState<Contrato | null>(null);
  const [cancelarFuturas, setCancelarFuturas] = useState(true);
  const hoy = hoyISO();
  const { contrato, tarifa } = resumenCliente(db, cliente, hoy);
  const historial = contratosDeCliente(db, cliente.id).filter((c) => c.id !== contrato?.id);
  const previstas = contrato && contrato.modalidad === 'FIJO' ? sesionesPrevistas(contrato, db.plantillas, db.config).total : null;
  const reservasFuturas = finalizar ? db.reservas.filter((r) => r.contratoId === finalizar.id && r.estado === 'RESERVADA' && (db.clases.find((c) => c.id === r.claseId)?.fecha ?? '') >= hoy).length : 0;

  const confirmarFin = async () => {
    if (!finalizar) return;
    const r = await ejecutar('finalizarContrato', { contratoId: finalizar.id, cancelarReservasFuturas: cancelarFuturas });
    if (r.ok) toast.ok('Contrato finalizado.'); else toast.error(r.error);
    setFinalizar(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px] max-w-5xl">
      <div className="space-y-4">
        {contrato && tarifa ? (
          <Tarjeta className="p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-sans font-semibold">{tarifa.nombre}</h2><Chip tono="verde">Activo</Chip><Chip tono="gris">{TIPO_TARIFA[tarifa.tipo]}</Chip></div>
                <p className="text-sm text-ink-muted mt-1">{tarifa.descripcion}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-5">
              <Dato etiqueta="Periodo">{fechaMedia(contrato.fechaInicio)} → {fechaMedia(contrato.fechaFin)}</Dato>
              <Dato etiqueta="Modalidad">{contrato.modalidad === 'FIJO' ? 'Horario fijo' : 'Turno libre'}</Dato>
              {tarifa.tipo === 'BONO' && <Dato etiqueta="Sesiones restantes">{contrato.sesionesRestantes ?? 0} de {tarifa.bono?.sesiones}</Dato>}
              {tarifa.tipo === 'RECURRENTE' && <Dato etiqueta="Cupo semanal">{tarifa.cupos.map((c) => `${c.sesionesSemana} ${CATEGORIA_LABEL[c.categoria].toLowerCase()}`).join(' + ')}</Dato>}
              {previstas != null && <Dato etiqueta="Sesiones previstas en el periodo">{previstas} (descontando cierres)</Dato>}
              {contrato.notas && <Dato etiqueta="Notas" className="sm:col-span-2">{contrato.notas}</Dato>}
            </div>
            {contrato.modalidad === 'FIJO' && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">Franjas fijas</div>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {contrato.franjasFijas.map((f) => {
                    const v = plantillaVista(db, f.plantillaId);
                    if (!v) return <li key={f.plantillaId} className="rounded-xl bg-sand p-3 text-sm text-ink-muted">Franja eliminada</li>;
                    return (
                      <li key={f.plantillaId} className="rounded-xl bg-sand p-3 flex items-center gap-3">
                        <PuntoColor color={v.actividad?.color ?? '#999'} />
                        <span><span className="font-semibold">{DIAS_SEMANA_LABEL[v.plantilla.diaSemana]} {v.plantilla.horaInicio}</span><span className="block text-sm text-ink-muted">{v.actividad?.nombre} · {v.monitor?.nombre}</span></span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {puede('CLIENTES_EDITAR') && <div className="mt-6 flex justify-end"><Boton variante="peligro" tamano="sm" onClick={() => setFinalizar(contrato)}>Finalizar contrato</Boton></div>}
          </Tarjeta>
        ) : (
          <Tarjeta><Vacio icono={Tag} titulo="Sin tarifa activa" texto="Este cliente no tiene ninguna contratación en vigor." /></Tarjeta>
        )}

        {historial.length > 0 && (
          <Tarjeta>
            <h3 className="px-4 pt-4 pb-2 font-semibold">Historial de contratos</h3>
            <ul className="divide-y divide-ink/5">
              {historial.map((c) => {
                const t = db.tarifas.find((x) => x.id === c.tarifaId);
                return (
                  <li key={c.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <span className="flex-1 min-w-[10rem]"><span className="font-medium">{t?.nombre ?? 'Tarifa eliminada'}</span><span className="block text-sm text-ink-muted">{fechaMedia(c.fechaInicio)} → {fechaMedia(c.fechaFin)} · {c.modalidad === 'FIJO' ? 'fijo' : 'libre'}</span></span>
                    <Chip tono={ESTADO_CONTRATO[c.estado].tono}>{ESTADO_CONTRATO[c.estado].texto}</Chip>
                  </li>
                );
              })}
            </ul>
          </Tarjeta>
        )}
      </div>
      <aside>
        {puede('CLIENTES_EDITAR') && <Boton ancho onClick={() => setNueva(true)}><FilePlus2 className="h-5 w-5" /> Nueva contratación</Boton>}
        {contrato && puede('CLIENTES_EDITAR') && <p className="text-sm text-ink-muted mt-2 text-center">Al crear una nueva contratación, la actual se finaliza automáticamente.</p>}
      </aside>

      {nueva && <HojaNuevaContratacion cliente={cliente} onCerrar={() => setNueva(false)} />}
      <Confirmacion abierta={finalizar != null} onCerrar={() => setFinalizar(null)} titulo="Finalizar contrato" textoConfirmar="Finalizar" peligro onConfirmar={confirmarFin}>
        <p>El contrato de <strong className="text-ink">{tarifa?.nombre}</strong> termina hoy. El cliente dejará de poder reservar con esta tarifa.</p>
        <div className="rounded-2xl border border-ink/10 px-4">
          <Interruptor activo={cancelarFuturas} onCambio={setCancelarFuturas} etiqueta="Cancelar sus reservas futuras" descripcion={`${reservasFuturas} reserva${reservasFuturas === 1 ? '' : 's'} pendiente${reservasFuturas === 1 ? '' : 's'} de este contrato. Se cancelan como "por el centro", sin penalizar.`} />
        </div>
      </Confirmacion>
    </div>
  );
}

function HojaNuevaContratacion({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const { db, ejecutar } = useTrabajador();
  const hoy = hoyISO();
  const tarifas = db.tarifas.filter((t) => t.activa).sort((a, b) => a.orden - b.orden);
  const [tarifaId, setTarifaId] = useState(tarifas[0]?.id ?? '');
  const [inicio, setInicio] = useState(hoy);
  const [finManual, setFinManual] = useState<string | null>(null);
  const [modalidad, setModalidad] = useState<Modalidad>('FIJO');
  const [franjas, setFranjas] = useState<string[]>([]);
  const [notas, setNotas] = useState('');
  const tarifa: Tarifa | undefined = tarifas.find((t) => t.id === tarifaId);
  const fin = finManual ?? (tarifa ? fechaFinPorDefecto(tarifa, inicio, sumarMeses) : inicio);
  const esRecurrente = tarifa?.tipo === 'RECURRENTE';
  const modalidadReal: Modalidad = esRecurrente ? modalidad : 'LIBRE';
  const cupoPorCat = useMemo(() => new Map((tarifa?.cupos ?? []).map((c) => [c.categoria, c.sesionesSemana])), [tarifa]);
  const totalFranjas = Array.from(cupoPorCat.values()).reduce((a, b) => a + b, 0);
  const plantillas = db.plantillas
    .filter((p) => p.activa && cupoPorCat.has(db.actividades.find((a) => a.id === p.actividadId)?.categoria as Categoria))
    .sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio));
  const categoriaDe = (plantillaId: string): Categoria => db.actividades.find((a) => a.id === db.plantillas.find((p) => p.id === plantillaId)?.actividadId)?.categoria ?? 'DIRIGIDA';
  const elegidasPorCat = (cat: Categoria) => franjas.filter((f) => categoriaDe(f) === cat).length;
  const alternar = (id: string) => {
    if (franjas.includes(id)) return setFranjas(franjas.filter((f) => f !== id));
    const cat = categoriaDe(id);
    if (elegidasPorCat(cat) >= (cupoPorCat.get(cat) ?? 0)) return toast.info(`Esta tarifa incluye ${cupoPorCat.get(cat)} sesión/es semanales de ${CATEGORIA_LABEL[cat].toLowerCase()}.`);
    setFranjas([...franjas, id]);
  };
  const previstas = modalidadReal === 'FIJO' ? sesionesPrevistas({ fechaInicio: inicio, fechaFin: fin, franjasFijas: franjas.map((plantillaId) => ({ plantillaId })) }, db.plantillas, db.config).total : null;

  const guardar = async () => {
    if (!tarifa) return;
    if (fin < inicio) return toast.error('La fecha de fin debe ser posterior al inicio.');
    if (modalidadReal === 'FIJO' && franjas.length === 0) return toast.error('Elige al menos una franja fija.');
    const r = await ejecutar('crearContrato', {
      contrato: { clienteId: cliente.id, tarifaId: tarifa.id, fechaInicio: inicio, fechaFin: fin, modalidad: modalidadReal, franjasFijas: modalidadReal === 'FIJO' ? franjas.map((plantillaId) => ({ plantillaId })) : [], sesionesRestantes: tarifa.bono?.sesiones ?? null, actividadesPermitidasIds: [], notas: notas.trim() },
    });
    if (r.ok) { toast.ok('Contratación creada. Las reservas de horario fijo se han generado automáticamente.'); onCerrar(); } else toast.error(r.error);
  };

  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Nueva contratación" className="sm:max-w-2xl">
      <div className="space-y-4">
        <Seleccion etiqueta="Tarifa" value={tarifaId} onChange={(e) => { setTarifaId(e.target.value); setFranjas([]); setFinManual(null); }}>
          {tarifas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </Seleccion>
        {tarifa && <p className="text-sm text-ink-muted -mt-2">{tarifa.descripcion}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Fecha de inicio" type="date" value={inicio} onChange={(e) => { setInicio(e.target.value); setFinManual(null); }} />
          <Entrada etiqueta="Fecha de fin" type="date" value={fin} min={inicio} onChange={(e) => setFinManual(e.target.value)} />
        </div>
        {esRecurrente && (
          <div>
            <span className="block text-[15px] font-semibold mb-1.5">Modalidad</span>
            <Segmentado className="w-full" valor={modalidad} onCambio={setModalidad} opciones={[{ valor: 'FIJO', texto: 'Horario fijo' }, { valor: 'LIBRE', texto: 'Turno libre' }]} />
            <p className="text-sm text-ink-muted mt-1">{modalidad === 'FIJO' ? 'Las reservas se generan automáticamente cada semana en las franjas elegidas.' : 'El cliente reserva cada semana las clases que quiera dentro de su cupo.'}</p>
          </div>
        )}
        {esRecurrente && modalidad === 'FIJO' && (
          <div>
            <span className="block text-[15px] font-semibold mb-1.5">Franjas fijas <span className="text-ink-muted font-normal">({franjas.length}/{totalFranjas})</span></span>
            <div className="max-h-64 overflow-y-auto rounded-2xl border border-ink/10 divide-y divide-ink/5">
              {plantillas.map((p) => {
                const v = plantillaVista(db, p.id)!;
                const activa = franjas.includes(p.id);
                return (
                  <label key={p.id} className={cn('flex items-center gap-3 p-3 cursor-pointer', activa ? 'bg-brand-50' : 'hover:bg-sand')}>
                    <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={activa} onChange={() => alternar(p.id)} />
                    <PuntoColor color={v.actividad?.color ?? '#999'} />
                    <span className="flex-1 min-w-0"><span className="font-semibold">{DIAS_SEMANA_LABEL[p.diaSemana]} {p.horaInicio}</span><span className="block text-sm text-ink-muted truncate">{v.actividad?.nombre} · {v.monitor?.nombre} · {p.plazas} plazas</span></span>
                  </label>
                );
              })}
            </div>
            {previstas != null && <p className="text-sm font-medium text-brand-700 mt-2">{previstas} sesiones previstas en el periodo (descontando días de cierre).</p>}
          </div>
        )}
        {tarifa?.tipo === 'BONO' && tarifa.bono && <p className="text-sm text-ink-soft rounded-2xl bg-sand p-3">Bono de <strong>{tarifa.bono.sesiones} sesiones</strong> de {CATEGORIA_LABEL[tarifa.bono.categoria].toLowerCase()}, válido hasta el {fechaMedia(fin)}.</p>}
        <AreaTexto etiqueta="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" className="min-h-[4rem]" />
        <Boton ancho onClick={guardar}>Crear contratación</Boton>
      </div>
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

export function PestanaReservas({ cliente }: { cliente: Cliente }) {
  const { db, puede, ejecutar } = useTrabajador();
  const ahora = new Date();
  const [vista, setVista] = useState<'PROXIMAS' | 'PASADAS'>('PROXIMAS');
  const [reservar, setReservar] = useState(false);
  const [cancelar, setCancelar] = useState<Reserva | null>(null);
  const { proximas, pasadas } = reservasDeClienteSeparadas(db, cliente.id, ahora);
  const lista = vista === 'PROXIMAS' ? proximas : pasadas;
  const clases = new Map(db.clases.map((c) => [c.id, c]));
  const claseCancelar = cancelar ? clases.get(cancelar.claseId) : null;
  const clasif = claseCancelar ? clasificarCancelacion(claseCancelar, ahora, db.config) : null;

  const confirmarCancelar = async () => {
    if (!cancelar) return;
    const r = await ejecutar('cancelarReserva', { reservaId: cancelar.id });
    if (r.ok) toast.ok(r.valor.recuperable ? 'Reserva cancelada. Se ha generado una recuperación.' : 'Reserva cancelada sin recuperación.'); else toast.error(r.error);
    setCancelar(null);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <Segmentado valor={vista} onCambio={setVista} opciones={[{ valor: 'PROXIMAS', texto: `Próximas (${proximas.length})` }, { valor: 'PASADAS', texto: `Pasadas (${pasadas.length})` }]} />
        {puede('RESERVAS_GESTIONAR') && cliente.activo && <Boton tamano="sm" onClick={() => setReservar(true)}><CalendarPlus className="h-5 w-5" /> Reservar clase</Boton>}
      </div>
      {lista.length === 0 ? (
        <Vacio icono={ClipboardList} titulo={vista === 'PROXIMAS' ? 'Sin reservas próximas' : 'Sin reservas pasadas'} />
      ) : (
        <Tarjeta>
          <ul className="divide-y divide-ink/5">
            {lista.map((r) => {
              const c = clases.get(r.claseId)!;
              const a = db.actividades.find((x) => x.id === c.actividadId);
              return (
                <li key={r.id} className="p-3 sm:px-4 flex items-center gap-3">
                  <div className="w-16 text-center shrink-0"><div className="text-xs text-ink-muted">{may(fechaCorta(c.fecha))}</div><div className="font-bold">{c.horaInicio}</div></div>
                  <div className="flex-1 min-w-0">
                    <Link to={`/clase/${c.id}`} className="font-semibold hover:underline flex items-center gap-2"><PuntoColor color={a?.color ?? '#999'} />{a?.nombre}{c.estado === 'CANCELADA' && <Chip tono="rojo">Clase cancelada</Chip>}</Link>
                    <div className="flex gap-1.5 flex-wrap mt-1"><ChipEstadoReserva estado={r.estado} corto /><ChipOrigen origen={r.origen} /><ChipAsistencia asistencia={r.asistencia} /></div>
                  </div>
                  {vista === 'PROXIMAS' && r.estado === 'RESERVADA' && c.estado === 'PROGRAMADA' && puede('RESERVAS_GESTIONAR') && (
                    <Boton variante="fantasma" tamano="sm" onClick={() => setCancelar(r)}>Cancelar</Boton>
                  )}
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}
      {reservar && <HojaReservarPara cliente={cliente} onCerrar={() => setReservar(false)} />}
      <Confirmacion abierta={cancelar != null} onCerrar={() => setCancelar(null)} titulo="Cancelar reserva" textoConfirmar="Cancelar reserva" peligro onConfirmar={confirmarCancelar}>
        {claseCancelar && clasif && (
          <>
            <p>Clase del <strong className="text-ink">{may(fechaLarga(claseCancelar.fecha))}</strong> a las {claseCancelar.horaInicio}.</p>
            {clasif.recuperable
              ? <p className="text-brand-700 font-medium">Se cancela con {Math.max(0, Math.round(clasif.minutosAntelacion / 60))} h de antelación: el cliente recibe una recuperación.</p>
              : <p className="text-rose font-medium">Quedan menos de {db.config.minutosAntelacionCancelacion} minutos: la cancelación no es recuperable.</p>}
          </>
        )}
      </Confirmacion>
    </div>
  );
}

function HojaReservarPara({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const { db, ejecutar } = useTrabajador();
  const hoy = hoyISO();
  const [fecha, setFecha] = useState(hoy);
  const clases = clasesDelDia(db, fecha).filter((v) => v.clase.estado === 'PROGRAMADA');
  const mias = new Set(db.reservas.filter((r) => r.clienteId === cliente.id && r.estado === 'RESERVADA').map((r) => r.claseId));
  const reservar = async (claseId: string) => {
    const r = await ejecutar('reservar', { claseId, clienteId: cliente.id });
    if (r.ok) { toast.ok('Reserva creada.'); onCerrar(); } else toast.error(r.error);
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Reservar clase">
      <p className="text-sm text-ink-muted mb-3">Se aplican las reglas de la tarifa de {cliente.nombre} (cupo, bono o recuperación).</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Día anterior" onClick={() => setFecha(sumarDias(fecha, -1))} className="h-12 w-12 rounded-2xl border border-ink/10 flex items-center justify-center tap"><ChevronLeft className="h-5 w-5" /></button>
        <Entrada type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} className="text-center" />
        <button type="button" aria-label="Día siguiente" onClick={() => setFecha(sumarDias(fecha, 1))} className="h-12 w-12 rounded-2xl border border-ink/10 flex items-center justify-center tap"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <p className="text-sm font-semibold mt-3 mb-2">{may(fechaLarga(fecha))}</p>
      <ul className="divide-y divide-ink/5 rounded-2xl border border-ink/10">
        {clases.length === 0 && <li className="p-4 text-center text-ink-muted">No hay clases este día.</li>}
        {clases.map((v) => (
          <li key={v.clase.id} className="p-3 flex items-center gap-3">
            <div className="font-bold w-12">{v.clase.horaInicio}</div>
            <div className="flex-1 min-w-0"><div className="font-semibold flex items-center gap-2"><PuntoColor color={v.actividad.color} />{v.actividad.nombre}</div><div className="text-sm text-ink-muted">{v.monitor?.nombre} · {v.libres} libres de {v.clase.plazas}</div></div>
            {mias.has(v.clase.id) ? <Chip tono="verde">Ya apuntado</Chip> : <Boton tamano="sm" variante="suave" disabled={v.libres <= 0} onClick={() => reservar(v.clase.id)}>Reservar</Boton>}
          </li>
        ))}
      </ul>
    </Hoja>
  );
}
