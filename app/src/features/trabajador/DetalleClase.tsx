import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Ban, Bell, Check, Clock, UserMinus, UserPlus, Users, X } from 'lucide-react';
import type { Cliente, Reserva } from '@/domain/types';
import { fechaLarga, horaFin, hoyISO, esPasada, fechaCorta } from '@/domain/fechas';
import { nombreCompleto, vistaClase } from '@/data/selectores';
import { AreaTexto, Boton, Chip, Hoja, Interruptor, Seleccion, Tarjeta, Vacio } from '@/ui';
import { toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { alternativasPara, clasesSueltasDe, resumenCliente } from './consultas';
import { Avatar, BarraOcupacion, BuscadorClientes, ChipEstadoReserva, ChipOrigen, Confirmacion, Encabezado, Plegable, PuntoColor, may } from './comunes';

export function DetalleClase() {
  const { id } = useParams();
  const { db, puede, ejecutar } = useTrabajador();
  const navigate = useNavigate();
  const clase = db.clases.find((c) => c.id === id);
  const [anadir, setAnadir] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [quitar, setQuitar] = useState<Reserva | null>(null);

  if (!clase) return <Vacio icono={AlertTriangle} titulo="Clase no encontrada" accion={<Link to="/"><Boton variante="secundario">Volver al calendario</Boton></Link>} />;
  const vista = vistaClase(db, clase);
  const { actividad, monitor, ocupadas } = vista;
  const hoy = hoyISO();
  const ahora = new Date();
  const cancelada = clase.estado === 'CANCELADA';
  const pasada = esPasada(clase.fecha, clase.horaInicio, ahora);
  const puedeAsistencia = puede('ASISTENCIA_REGISTRAR') && clase.fecha <= hoy && !cancelada;
  const clientes = new Map(db.clientes.map((c) => [c.id, c]));
  const activas = vista.reservas.filter((r) => r.estado === 'RESERVADA').sort((a, b) => nombreCompleto(clientes.get(a.clienteId)).localeCompare(nombreCompleto(clientes.get(b.clienteId)), 'es'));
  const canceladas = vista.reservas.filter((r) => r.estado !== 'RESERVADA');
  const alternativa = clase.claseAlternativaId ? db.clases.find((c) => c.id === clase.claseAlternativaId) : null;
  const cs = clasesSueltasDe(vista);

  const marcar = (r: Reserva, asistencia: 'ASISTE' | 'NO_ASISTE') => {
    const res = ejecutar('registrarAsistencia', { reservaId: r.id, asistencia: r.asistencia === asistencia ? 'PENDIENTE' : asistencia });
    if (!res.ok) toast.error(res.error);
  };
  const confirmarQuitar = () => {
    if (!quitar) return;
    const res = ejecutar('quitarAlumno', { reservaId: quitar.id });
    if (res.ok) toast.ok(`${nombreCompleto(clientes.get(quitar.clienteId))} ya no está en la clase.`); else toast.error(res.error);
    setQuitar(null);
  };

  return (
    <div>
      <Encabezado
        atras="/"
        titulo={<span className="flex items-center gap-2"><PuntoColor color={actividad.color} className="h-4 w-4" />{actividad.nombre}{clase.extraordinaria && <Chip tono="cocoa">Extraordinaria</Chip>}</span>}
        subtitulo={<span>{may(fechaLarga(clase.fecha))} · {clase.horaInicio}–{horaFin(clase.horaInicio, clase.duracionMin)}</span>}
      />

      {cancelada && (
        <div className="mb-4 rounded-2xl bg-rose/10 border border-rose/20 p-4 flex gap-3">
          <Ban className="h-6 w-6 text-rose shrink-0" />
          <div>
            <p className="font-semibold text-rose">Clase cancelada</p>
            <p className="text-ink-soft">{clase.motivoCancelacion || 'Sin motivo indicado.'}</p>
            {alternativa && <p className="text-sm mt-1">Alternativa propuesta: <Link className="font-semibold text-sky underline" to={`/clase/${alternativa.id}`}>{fechaCorta(alternativa.fecha)} a las {alternativa.horaInicio}</Link></p>}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Tarjeta className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-ink-soft"><Users className="h-5 w-5" /><span className="font-semibold text-ink text-lg tabular-nums">{ocupadas}/{clase.plazas}</span> plazas ocupadas</div>
              <div className="flex gap-2 flex-wrap">
                {!cancelada && ocupadas >= clase.plazas && <Chip tono="ambar">Completa</Chip>}
                {cs > 0 && <Chip tono="cocoa">{cs} CS</Chip>}
                {monitor && <Chip tono="gris">{monitor.nombre} {monitor.apellidos}</Chip>}
                <Chip tono="gris"><Clock className="h-3.5 w-3.5" /> {clase.duracionMin} min</Chip>
              </div>
            </div>
            <BarraOcupacion ocupadas={ocupadas} plazas={clase.plazas} className="mt-3 h-2" />
          </Tarjeta>

          <Tarjeta>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-lg font-semibold font-sans">Alumnos ({activas.length})</h2>
              {puedeAsistencia && activas.length > 0 && <span className="text-sm text-ink-muted">{activas.filter((r) => r.asistencia !== 'PENDIENTE').length}/{activas.length} con asistencia</span>}
            </div>
            {activas.length === 0 && <p className="px-4 pb-5 text-ink-muted">Nadie apuntado todavía.</p>}
            <ul className="divide-y divide-ink/5">
              {activas.map((r) => {
                const c = clientes.get(r.clienteId);
                return (
                  <li key={r.id} className="p-3 sm:px-4">
                    <div className="flex items-center gap-3">
                      <Avatar nombre={c?.nombre ?? '?'} apellidos={c?.apellidos} tamano="sm" />
                      <div className="flex-1 min-w-0">
                        <Link to={`/clientes/${r.clienteId}`} className="font-semibold hover:underline block truncate">{nombreCompleto(c)}</Link>
                        <div className="flex gap-1.5 flex-wrap mt-0.5"><ChipOrigen origen={r.origen} />{!c?.activo && <Chip tono="rojo">Baja</Chip>}</div>
                      </div>
                      {puede('RESERVAS_GESTIONAR') && !pasada && !cancelada && (
                        <button type="button" onClick={() => setQuitar(r)} aria-label="Quitar alumno" title="Quitar de la clase" className="h-11 w-11 rounded-full flex items-center justify-center text-ink-muted hover:bg-rose/10 hover:text-rose tap"><UserMinus className="h-5 w-5" /></button>
                      )}
                    </div>
                    {puedeAsistencia && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:ml-12">
                        <BotonAsistencia activo={r.asistencia === 'ASISTE'} tono="verde" onClick={() => marcar(r, 'ASISTE')}><Check className="h-5 w-5" /> Asiste</BotonAsistencia>
                        <BotonAsistencia activo={r.asistencia === 'NO_ASISTE'} tono="rojo" onClick={() => marcar(r, 'NO_ASISTE')}><X className="h-5 w-5" /> No asiste</BotonAsistencia>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Tarjeta>

          {canceladas.length > 0 && (
            <Plegable titulo="Cancelaciones" resumen={`${canceladas.length}`}>
              <ul className="divide-y divide-ink/5">
                {canceladas.map((r) => (
                  <li key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                    <Link to={`/clientes/${r.clienteId}`} className="font-medium hover:underline flex-1 min-w-[10rem]">{nombreCompleto(clientes.get(r.clienteId))}</Link>
                    <ChipOrigen origen={r.origen} />
                    <ChipEstadoReserva estado={r.estado} />
                  </li>
                ))}
              </ul>
            </Plegable>
          )}
        </div>

        <aside className="space-y-2 lg:sticky lg:top-4 self-start">
          {(puede('RESERVAS_GESTIONAR') || puede('CLASES_SUELTAS')) && !cancelada && !pasada && (
            <Boton ancho onClick={() => setAnadir(true)} disabled={ocupadas >= clase.plazas}><UserPlus className="h-5 w-5" /> Añadir alumno</Boton>
          )}
          {puede('AVISOS_ENVIAR') && activas.length > 0 && (
            <Boton ancho variante="secundario" onClick={() => navigate(`/avisos?clase=${clase.id}`)}><Bell className="h-5 w-5" /> Aviso a los alumnos</Boton>
          )}
          {puede('CLASES_CREAR_CANCELAR') && !cancelada && !pasada && (
            <Boton ancho variante="peligro" onClick={() => setCancelar(true)}><Ban className="h-5 w-5" /> Cancelar clase</Boton>
          )}
          {ocupadas >= clase.plazas && !cancelada && !pasada && <p className="text-sm text-ink-muted text-center pt-1">La clase está completa.</p>}
        </aside>
      </div>

      <HojaAnadirAlumno abierta={anadir} onCerrar={() => setAnadir(false)} claseId={clase.id} yaApuntados={activas.map((r) => r.clienteId)} />
      <HojaCancelarClase abierta={cancelar} onCerrar={() => setCancelar(false)} claseId={clase.id} afectados={activas.length} />
      <Confirmacion abierta={quitar != null} onCerrar={() => setQuitar(null)} titulo="Quitar de la clase" textoConfirmar="Quitar alumno" peligro onConfirmar={confirmarQuitar}>
        <p><strong className="text-ink">{nombreCompleto(clientes.get(quitar?.clienteId ?? ''))}</strong> dejará de estar apuntado/a a esta clase.</p>
        <p>No se le penaliza: se le devuelve el derecho (recuperación, sesión de bono o recuperación consumida) para que pueda usarlo en otra clase.</p>
      </Confirmacion>
    </div>
  );
}

function BotonAsistencia({ activo, tono, onClick, children }: { activo: boolean; tono: 'verde' | 'rojo'; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={activo}
      className={cn('h-11 rounded-xl font-semibold flex items-center justify-center gap-1.5 border tap',
        activo && tono === 'verde' && 'bg-brand-500 text-white border-brand-500',
        activo && tono === 'rojo' && 'bg-rose text-white border-rose',
        !activo && 'bg-white border-ink/10 text-ink-soft hover:bg-sand')}
    >
      {children}
    </button>
  );
}

function HojaAnadirAlumno({ abierta, onCerrar, claseId, yaApuntados }: { abierta: boolean; onCerrar: () => void; claseId: string; yaApuntados: string[] }) {
  const { db, puede, ejecutar } = useTrabajador();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hoy = hoyISO();
  const cerrar = () => { setCliente(null); setError(null); onCerrar(); };
  const anadir = (modo: 'TARIFA' | 'CLASE_SUELTA' | 'MANUAL') => {
    if (!cliente) return;
    const r = ejecutar('anadirAlumno', { claseId, clienteId: cliente.id, modo });
    if (r.ok) { toast.ok(`${nombreCompleto(cliente)} añadido/a a la clase.`); cerrar(); } else setError(r.error);
  };
  const resumen = cliente ? resumenCliente(db, cliente, hoy) : null;
  return (
    <Hoja abierta={abierta} onCerrar={cerrar} titulo="Añadir alumno">
      {!cliente && (
        <BuscadorClientes
          clientes={db.clientes.filter((c) => c.activo)} excluirIds={yaApuntados} onElegir={(c) => { setCliente(c); setError(null); }} autoFocus
          renderExtra={(c) => { const t = resumenCliente(db, c, hoy).tarifa; return <span className="text-xs text-ink-muted hidden sm:block max-w-[9rem] truncate">{t?.nombre ?? 'Sin tarifa'}</span>; }}
        />
      )}
      {cliente && resumen && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-sand p-3">
            <Avatar nombre={cliente.nombre} apellidos={cliente.apellidos} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{nombreCompleto(cliente)}</div>
              <div className="text-sm text-ink-muted truncate">{resumen.tarifa ? `${resumen.tarifa.nombre} · ${resumen.contrato?.modalidad === 'FIJO' ? 'horario fijo' : 'turno libre'}` : 'Sin tarifa activa'}{resumen.recuperaciones > 0 && ` · ${resumen.recuperaciones} recup.`}</div>
            </div>
            <Boton variante="fantasma" tamano="sm" onClick={() => { setCliente(null); setError(null); }}>Cambiar</Boton>
          </div>
          {error && (
            <div className="rounded-2xl bg-clay/10 border border-clay/20 p-3 text-sm">
              <p className="font-semibold text-clay">No se puede añadir con su tarifa</p>
              <p className="text-ink-soft">{error}</p>
            </div>
          )}
          <p className="text-sm text-ink-muted">¿Cómo se apunta?</p>
          <div className="grid gap-2">
            {puede('RESERVAS_GESTIONAR') && !error && (
              <OpcionModo titulo="Con su tarifa" texto="Aplica las reglas de su tarifa: cupo semanal, bono o recuperación disponible." onClick={() => anadir('TARIFA')} />
            )}
            {puede('RESERVAS_GESTIONAR') && error && (
              <OpcionModo titulo="Añadir de todos modos (manual)" texto="Se apunta sin descontar de la tarifa. Queda registrado como reserva manual." onClick={() => anadir('MANUAL')} destacada />
            )}
            {puede('CLASES_SUELTAS') && (
              <OpcionModo titulo="Clase suelta (CS)" texto="Sesión individual pagada en recepción, sin tarifa ni recuperación." onClick={() => anadir('CLASE_SUELTA')} />
            )}
            {puede('RESERVAS_GESTIONAR') && !error && (
              <OpcionModo titulo="Manual" texto="Reserva manual sin aplicar reglas ni descontar nada." onClick={() => anadir('MANUAL')} />
            )}
          </div>
        </div>
      )}
    </Hoja>
  );
}

function OpcionModo({ titulo, texto, onClick, destacada }: { titulo: string; texto: string; onClick: () => void; destacada?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('w-full text-left rounded-2xl border p-4 tap', destacada ? 'border-brand-400 bg-brand-50 hover:bg-brand-100' : 'border-ink/10 bg-white hover:border-brand-300')}>
      <span className="block font-semibold">{titulo}</span>
      <span className="block text-sm text-ink-muted">{texto}</span>
    </button>
  );
}

function HojaCancelarClase({ abierta, onCerrar, claseId, afectados }: { abierta: boolean; onCerrar: () => void; claseId: string; afectados: number }) {
  const { db, ejecutar } = useTrabajador();
  const [motivo, setMotivo] = useState('');
  const [alternativa, setAlternativa] = useState('');
  const [avisar, setAvisar] = useState(true);
  const clase = db.clases.find((c) => c.id === claseId);
  if (!clase) return null;
  const alternativas = alternativasPara(db, clase, hoyISO());
  const confirmar = () => {
    const r = ejecutar('cancelarClase', { claseId, motivo: motivo.trim(), claseAlternativaId: alternativa || null, avisar });
    if (r.ok) { toast.ok(`Clase cancelada. ${r.valor.afectados} alumno${r.valor.afectados === 1 ? '' : 's'} afectado${r.valor.afectados === 1 ? '' : 's'}.`); onCerrar(); } else toast.error(r.error);
  };
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Cancelar clase">
      <div className="space-y-4">
        <div className="rounded-2xl bg-clay/10 p-3 text-sm text-ink-soft flex gap-2"><AlertTriangle className="h-5 w-5 text-clay shrink-0" /><span><strong className="text-ink">{afectados} alumno{afectados === 1 ? '' : 's'}</strong> con plaza. Cada uno recibirá una recuperación (o se le devolverá la sesión de bono) sin penalización.</span></div>
        <AreaTexto etiqueta="Motivo" placeholder="Ej.: baja del monitor, avería en la sala…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <Seleccion etiqueta="Clase alternativa (opcional)" ayuda="Misma actividad en los próximos 14 días" value={alternativa} onChange={(e) => setAlternativa(e.target.value)}>
          <option value="">Sin alternativa</option>
          {alternativas.map((v) => <option key={v.clase.id} value={v.clase.id}>{fechaCorta(v.clase.fecha)} · {v.clase.horaInicio} · {v.libres} libres</option>)}
        </Seleccion>
        <Interruptor activo={avisar} onCambio={setAvisar} etiqueta="Avisar a los alumnos afectados" descripcion="Se publica un aviso importante con el motivo y la alternativa." />
        <Boton ancho variante="peligro" onClick={confirmar}>Cancelar la clase</Boton>
      </div>
    </Hoja>
  );
}
