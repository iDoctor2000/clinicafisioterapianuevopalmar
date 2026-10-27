import { useState } from 'react';
import { CalendarClock, Info, Plus, Trash2 } from 'lucide-react';
import { duracionActividad, type DiaSemana, type PlantillaClase } from '@/domain/types';
import { DIAS_SEMANA_CORTO, DIAS_SEMANA_LABEL, fechaCorta, hoyISO, horaFin } from '@/domain/fechas';
import { clasesQueSeCancelarian } from '@/data/comandos';
import { Boton, Chip, Entrada, Hoja, Interruptor, Seleccion, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { efectoEliminarPlantilla, fijosDePlantilla, monitores, ocupacionFijaDePlantilla, plantillasPorDia, plantillasVigentes } from './consultas';
import { Confirmacion, Encabezado, PuntoColor, Segmentado } from './comunes';

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
        titulo="Horarios" subtitulo={`${plantillasVigentes(db).filter((p) => p.activa).length} franjas activas a la semana${limitado ? ' · solo tus franjas (solo lectura)' : ''}`}
        acciones={puedeEditar && <Boton tamano="sm" onClick={() => abrir('NUEVA')}><Plus className="h-5 w-5" /> Nueva franja</Boton>}
      />
      <div className="mb-4 flex items-start gap-2 rounded-2xl bg-beige-100 text-ink px-4 py-3 text-sm"><Info className="h-5 w-5 shrink-0" /><span>Las clases de las próximas 10 semanas se generan automáticamente a partir de este horario. Los cambios se aplican también a las clases ya creadas: si quitas una franja, sus clases con alumnos se cancelan avisándoles.</span></div>

      {plantillasVigentes(db).length === 0 && <Vacio icono={CalendarClock} titulo="Sin horario" texto="Crea la primera franja semanal." />}

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
    plantilla ?? { actividadId: acts[0]?.id ?? '', diaSemana: diaInicial, horaInicio: '10:00', duracionMin: duracionActividad(acts[0]), monitorId: mons[0]?.id ?? '', plazas: 8, activa: true, vigenciaDesde: null, vigenciaHasta: null },
  );
  const [confirmar, setConfirmar] = useState(false);
  const [eliminar, setEliminar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Eliminar la franja (0021): bloqueado si alguien la tiene como clase fija; si no, se cancelan sus clases con alumnos y se borran las vacías.
  const fijos = plantilla ? fijosDePlantilla(db, plantilla.id) : [];
  const efecto = plantilla ? efectoEliminarPlantilla(db, plantilla.id, new Date()) : { conAlumnos: [], vacias: [], alumnos: 0 };
  const eliminarFranja = async () => {
    if (!plantilla || guardando) return;
    setGuardando(true);
    const r = await ejecutar('eliminarPlantilla', { plantillaId: plantilla.id });
    setGuardando(false);
    setEliminar(false);
    if (r.ok) {
      toast.ok(r.valor.canceladas > 0
        ? `Franja eliminada. ${r.valor.canceladas === 1 ? 'Se ha cancelado 1 clase' : `Se han cancelado ${r.valor.canceladas} clases`} con alumnos (${r.valor.afectados === 1 ? '1 alumno avisado' : `${r.valor.afectados} alumnos avisados`}, con recuperación)${r.valor.borradas > 0 ? ` y se han borrado ${r.valor.borradas} clases vacías` : ''}.`
        : `Franja eliminada${r.valor.borradas > 0 ? `; se han borrado sus ${r.valor.borradas} clases futuras (estaban vacías)` : ''}.`);
      onCerrar();
    } else toast.error(r.error);
  };
  // Clases futuras con alumnos que se cancelarían al guardar (franja desactivada o fuera de vigencia).
  const aCancelar = plantilla ? clasesQueSeCancelarian(db, { ...f, id: plantilla.id }, new Date()) : { clases: [], alumnos: 0 };
  // Cambiar desde qué día vale una franja que ya se está dando: casi siempre lo que se quiere es un horario nuevo a partir de esa fecha.
  const empiezaMasTarde = !!plantilla && !!f.vigenciaDesde && f.vigenciaDesde > hoyISO() && f.vigenciaDesde !== plantilla.vigenciaDesde;
  // Otra franja de la misma actividad, el mismo día y a la misma hora, a la vez: saldrían dos clases iguales.
  const repetida = db.plantillas.find((x) => x.id !== plantilla?.id && x.activa && !x.eliminadaEl && f.activa
    && x.diaSemana === f.diaSemana && x.horaInicio.slice(0, 5) === f.horaInicio.slice(0, 5) && x.actividadId === f.actividadId
    && (!x.vigenciaHasta || !f.vigenciaDesde || x.vigenciaHasta >= f.vigenciaDesde) && (!f.vigenciaHasta || !x.vigenciaDesde || f.vigenciaHasta >= x.vigenciaDesde));
  const guardar = async (confirmado = false) => {
    if (!f.actividadId || !f.monitorId || !f.horaInicio) return toast.error('Completa actividad, hora y monitor.');
    if (!confirmado && aCancelar.clases.length > 0) return setConfirmar(true);
    if (guardando) return;
    setGuardando(true);
    const r = await ejecutar('guardarPlantilla', { plantilla: { ...f, id: plantilla?.id, duracionMin: Number(f.duracionMin), plazas: Number(f.plazas) } });
    setGuardando(false);
    setConfirmar(false);
    if (r.ok) {
      if (!plantilla) toast.ok('Franja creada. Se han generado sus clases.');
      else if (r.valor.reactivadas > 0) toast.ok(`Franja actualizada. ${r.valor.reactivadas === 1 ? 'Se ha reactivado 1 clase' : `Se han reactivado ${r.valor.reactivadas} clases`} que estaban canceladas: sus alumnos vuelven a tener plaza y se les ha avisado.`);
      else if (r.valor.canceladas > 0) toast.ok(`Franja actualizada. ${r.valor.canceladas === 1 ? 'Se ha cancelado 1 clase' : `Se han cancelado ${r.valor.canceladas} clases`} con alumnos; ${r.valor.afectados === 1 ? 'el alumno ha recibido' : `los ${r.valor.afectados} alumnos han recibido`} aviso y recuperación.`);
      else if (r.valor.conservadas > 0) toast.info(`Franja actualizada en el calendario. ${r.valor.conservadas === 1 ? 'Una clase con alumnos apuntados mantiene' : `${r.valor.conservadas} clases con alumnos apuntados mantienen`} su día y hora para no descolocarles; la actividad, el monitor y las plazas sí se han cambiado.`);
      else toast.ok('Franja actualizada. Sus clases futuras ya tienen el nuevo horario.');
      onCerrar();
    } else toast.error(r.error);
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={plantilla ? 'Editar franja' : 'Nueva franja'}>
      <div className="space-y-4">
        <Seleccion etiqueta="Actividad" value={f.actividadId} onChange={(e) => setF({ ...f, actividadId: e.target.value, duracionMin: plantilla ? f.duracionMin : duracionActividad(acts.find((a) => a.id === e.target.value)) })}>
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
          <Entrada etiqueta="Minutos" ayuda={`Por defecto ${duracionActividad(acts.find((a) => a.id === f.actividadId))} min`} type="number" min={15} step={5} value={f.duracionMin} onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} />
          <Entrada etiqueta="Plazas" type="number" min={1} value={f.plazas} onChange={(e) => setF({ ...f, plazas: Number(e.target.value) })} />
        </div>
        <Seleccion etiqueta="Monitor/a" value={f.monitorId} onChange={(e) => setF({ ...f, monitorId: e.target.value })}>
          {mons.map((m) => <option key={m.id} value={m.id}>{m.nombre} {m.apellidos}</option>)}
        </Seleccion>
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Vigente desde" ayuda="Opcional" type="date" value={f.vigenciaDesde ?? ''} onChange={(e) => setF({ ...f, vigenciaDesde: e.target.value || null })} />
          <Entrada etiqueta="Vigente hasta" ayuda="Opcional" type="date" value={f.vigenciaHasta ?? ''} onChange={(e) => setF({ ...f, vigenciaHasta: e.target.value || null })} />
        </div>
        {empiezaMasTarde && (
          <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-ink-soft">
            <strong className="text-ink">Ojo:</strong> esta franja ya se está dando. Con «Vigente desde» el {fechaCorta(f.vigenciaDesde!)}, sus clases de antes de esa fecha dejan de impartirse. Si lo que quieres es <strong className="text-ink">un horario nuevo a partir del {fechaCorta(f.vigenciaDesde!)}</strong>, deja esta franja con «Vigente hasta» el día anterior y crea otra franja nueva «Vigente desde» esa fecha.
          </p>
        )}
        {repetida && (
          <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-ink-soft">
            <strong className="text-ink">Ya hay una franja igual:</strong> {db.actividades.find((a) => a.id === repetida.actividadId)?.nombre} el {DIAS_SEMANA_LABEL[repetida.diaSemana].toLowerCase()} a las {repetida.horaInicio.slice(0, 5)}. Si guardas, habrá dos clases a la misma hora. Para cambiar la que ya existe, ábrela desde Horarios en vez de crear otra.
          </p>
        )}
        <div className="rounded-2xl border border-ink/10 px-4"><Interruptor activo={f.activa} onCambio={(v) => setF({ ...f, activa: v })} etiqueta="Franja activa" descripcion={plantilla ? "Desactivarla no la borra: sigue en Horarios (en gris) y se puede volver a activar. Mientras esté desactivada no se crean clases nuevas, y las que ya tienen alumnos se cancelan avisándoles (con recuperación). Para quitarla del todo, usa «Eliminar franja del horario», aquí abajo." : "Si la desactivas, no se crean sus clases. No se borra: puedes volver a activarla cuando quieras."} /></div>
        <Boton ancho onClick={() => void guardar()} cargando={guardando}>{plantilla ? 'Guardar cambios' : 'Crear franja'}</Boton>
        {plantilla && (
          <Boton ancho variante="fantasma" className="text-rose" onClick={() => setEliminar(true)}><Trash2 className="h-5 w-5" /> Eliminar franja del horario</Boton>
        )}
      </div>
      <Confirmacion abierta={eliminar} onCerrar={() => setEliminar(false)} titulo="Eliminar franja" textoConfirmar="Eliminar franja" peligro deshabilitado={fijos.length > 0} onConfirmar={() => void eliminarFranja()}>
        {fijos.length > 0 ? (
          <>
            <p><strong className="text-ink">No se puede eliminar todavía.</strong> {fijos.length === 1 ? 'Esta alumna/o la tiene' : `Estos ${fijos.length} alumnos la tienen`} como clase fija en su tarifa:</p>
            <p className="font-semibold text-ink">{fijos.map((c) => `${c.nombre} ${c.apellidos}`).join(', ')}</p>
            <p>Cambia antes su horario fijo (en su ficha, pestaña Tarifa) o espera a que termine su contrato. Mientras tanto puedes desactivar la franja con el interruptor de arriba.</p>
          </>
        ) : (
          <>
            <p>La franja de <strong className="text-ink">{DIAS_SEMANA_LABEL[f.diaSemana]} a las {f.horaInicio}</strong> desaparecerá del horario y no se generarán más clases.</p>
            {efecto.conAlumnos.length > 0 && <p><strong className="text-ink">{efecto.conAlumnos.length === 1 ? '1 clase' : `${efecto.conAlumnos.length} clases`}</strong> con alumnos apuntados ({efecto.alumnos === 1 ? '1 alumno' : `${efecto.alumnos} alumnos`}) se cancelarán: cada alumno recibirá un aviso y una recuperación.</p>}
            {efecto.vacias.length > 0 && <p>{efecto.vacias.length === 1 ? '1 clase futura vacía se borrará' : `${efecto.vacias.length} clases futuras vacías se borrarán`} del calendario.</p>}
            <p>Las clases ya impartidas se conservan en el historial de cada alumno.</p>
          </>
        )}
      </Confirmacion>
      <Confirmacion abierta={confirmar} onCerrar={() => setConfirmar(false)} titulo="Se cancelarán clases" textoConfirmar="Guardar y cancelar clases" peligro onConfirmar={() => void guardar(true)}>
        <p>Con estos cambios, <strong className="text-ink">{aCancelar.clases.length === 1 ? '1 clase' : `${aCancelar.clases.length} clases`}</strong> con alumnos apuntados dejan de impartirse ({aCancelar.alumnos === 1 ? '1 alumno' : `${aCancelar.alumnos} alumnos`}):</p>
        <p className="font-semibold text-ink">{aCancelar.clases.slice(0, 6).map((c) => `${fechaCorta(c.fecha)} ${c.horaInicio.slice(0, 5)}`).join(' · ')}{aCancelar.clases.length > 6 ? ` y ${aCancelar.clases.length - 6} más` : ''}</p>
        <p>Se cancelarán y cada alumno recibirá un aviso y una recuperación.</p>
        {empiezaMasTarde && <p><strong className="text-ink">Si lo que quieres es el horario a partir del {fechaCorta(f.vigenciaDesde!)}, no sigas:</strong> pulsa Cancelar y crea una franja nueva para esa fecha.</p>}
        <p className="text-sm">Si te equivocas, se deshace: vuelve a dejar la franja como estaba (o abre la clase y pulsa «Reactivar clase») y sus alumnos recuperan la plaza.</p>
      </Confirmacion>
    </Hoja>
  );
}
