import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Ban, Bell, Check, Clock, EyeOff, Hourglass, Lock, RotateCcw, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { MENSAJE_CLASE_AJENA } from '@/domain/ambito';
import { HITOS_CLASES, esCumpleanos } from '@/domain/logros';
import { conteoClases } from '@/data/logros';
import type { Cliente, Reserva } from '@/domain/types';
import { fechaLarga, horaFin, hoyISO, esPasada, fechaCorta } from '@/domain/fechas';
import { nombreCompleto, vistaClase } from '@/data/selectores';
import { AreaTexto, Boton, Chip, Hoja, Interruptor, Seleccion, Tarjeta, Vacio } from '@/ui';
import { toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { alternativasPara, clasesSueltasDe, listaEsperaDeClase, resumenCliente, type EsperaDeClase } from './consultas';
import { HORAS_CIERRE_LISTA_ESPERA, listaEsperaCerrada } from '@/domain/rules';
import { AvatarCliente, BarraOcupacion, BuscadorClientes, ChipEstadoReserva, ChipOrigen, Confirmacion, Encabezado, Plegable, may } from './comunes';
import { useGanadorVigente } from './ClienteDelMes';
import { IconoActividad } from '@/features/comun/IconoActividad';

export function DetalleClase() {
  const { id } = useParams();
  const { db, dbCompleta, puede, ejecutar, gestionaClase } = useTrabajador();
  const navigate = useNavigate();
  const clase = db.clases.find((c) => c.id === id);
  const claseAjena = !clase ? dbCompleta.clases.find((c) => c.id === id) : undefined;
  const [anadir, setAnadir] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [quitar, setQuitar] = useState<Reserva | null>(null);
  const [quitarEspera, setQuitarEspera] = useState<EsperaDeClase | null>(null);
  const [reactivar, setReactivar] = useState(false);
  const [eliminar, setEliminar] = useState(false);
  // Antes de cualquier salida anticipada (regla de los hooks): solo para las clases de hoy.
  const esDeHoy = clase?.fecha === hoyISO();
  const ganador = useGanadorVigente();
  const hitos = useHitos(esDeHoy ? db.reservas.filter((r) => r.claseId === clase?.id && r.estado === 'RESERVADA').map((r) => r.clienteId) : [], clase?.fecha ?? '');

  if (claseAjena && !gestionaClase(claseAjena)) return <Vacio icono={Lock} titulo={MENSAJE_CLASE_AJENA} texto="Tu ámbito es «Solo sus clases»: únicamente puedes ver y gestionar las clases que impartes." accion={<Link to="/"><Boton variante="secundario">Volver al calendario</Boton></Link>} />;
  if (!clase) return <Vacio icono={AlertTriangle} titulo="Clase no encontrada" accion={<Link to="/"><Boton variante="secundario">Volver al calendario</Boton></Link>} />;
  const vista = vistaClase(db, clase);
  const { actividad, monitor, ocupadas, retenidas } = vista;
  const hoy = hoyISO();
  const ahora = new Date();
  const cancelada = clase.estado === 'CANCELADA';
  const pasada = esPasada(clase.fecha, clase.horaInicio, ahora);
  const puedeAsistencia = puede('ASISTENCIA_REGISTRAR') && clase.fecha <= hoy && !cancelada;
  const clientes = new Map(db.clientes.map((c) => [c.id, c]));
  const activas = vista.reservas.filter((r) => r.estado === 'RESERVADA').sort((a, b) => nombreCompleto(clientes.get(a.clienteId)).localeCompare(nombreCompleto(clientes.get(b.clienteId)), 'es'));
  // Quien ha vuelto a apuntarse (o se le ha vuelto a apuntar) ya no sale como cancelación (0032).
  const canceladas = vista.reservas.filter((r) => r.estado !== 'RESERVADA' && !vista.reservas.some((x) => x.clienteId === r.clienteId && x.estado === 'RESERVADA'));
  const alternativa = clase.claseAlternativaId ? db.clases.find((c) => c.id === clase.claseAlternativaId) : null;
  const cs = clasesSueltasDe(vista);
  const espera = listaEsperaDeClase(db, clase.id);
  const esperaCerrada = listaEsperaCerrada(clase, ahora);

  const confirmarReactivar = async () => {
    const res = await ejecutar('reactivarClase', { claseId: clase.id });
    setReactivar(false);
    if (!res.ok) return toast.error(res.error);
    const { vuelven, sinPlaza } = res.valor;
    toast.ok(`Clase reactivada.${vuelven > 0 ? ` ${vuelven === 1 ? '1 alumno vuelve' : `${vuelven} alumnos vuelven`} a tener su plaza${pasada ? '' : ' y se les ha avisado'}.` : ''}${sinPlaza > 0 ? ` ${sinPlaza === 1 ? '1 alumno no' : `${sinPlaza} alumnos no`}: ya había gastado lo que se le devolvió; apúntalo a mano si hace falta.` : ''}`);
  };
  // Alumnos que perdieron la plaza al cancelarse (los que la recuperan al reactivar).
  const perdieronPlaza = cancelada ? vista.reservas.filter((r) => r.estado === 'CANCELADA_CENTRO' && clase.canceladaEl != null && r.canceladaEl === clase.canceladaEl).length : 0;
  // 0038/0041: una clase sin nadie apuntado (programada o cancelada) se puede eliminar del todo.
  const sinNadie = activas.length === 0 && !(clase.estado === 'PROGRAMADA' && vista.reservas.some((r) => r.asistencia === 'ASISTE'));
  const confirmarEliminar = async () => {
    const res = await ejecutar('eliminarClase', { claseId: clase.id });
    setEliminar(false);
    if (!res.ok) return toast.error(res.error);
    toast.ok('Clase eliminada.');
    navigate('/');
  };

  const marcar = async (r: Reserva, asistencia: 'ASISTE' | 'NO_ASISTE') => {
    const res = await ejecutar('registrarAsistencia', { reservaId: r.id, asistencia: r.asistencia === asistencia ? 'PENDIENTE' : asistencia });
    if (!res.ok) toast.error(res.error);
  };
  const confirmarQuitar = async () => {
    if (!quitar) return;
    const res = await ejecutar('quitarAlumno', { reservaId: quitar.id });
    if (res.ok) toast.ok(`${nombreCompleto(clientes.get(quitar.clienteId))} ya no está en la clase.`); else toast.error(res.error);
    setQuitar(null);
  };
  const confirmarQuitarEspera = async () => {
    if (!quitarEspera) return;
    const res = await ejecutar('quitarDeListaEspera', { id: quitarEspera.entrada.id });
    if (res.ok) toast.ok(`${nombreCompleto(quitarEspera.cliente)} ya no está en la lista de espera.`); else toast.error(res.error);
    setQuitarEspera(null);
  };

  return (
    <div>
      <Encabezado
        atras="/"
        titulo={<span className="flex items-center gap-3"><IconoActividad actividad={actividad} tamano="md" />{actividad.nombre}{clase.extraordinaria && <Chip tono="cocoa">Extraordinaria</Chip>}</span>}
        subtitulo={<span>{may(fechaLarga(clase.fecha))} · {clase.horaInicio}–{horaFin(clase.horaInicio, clase.duracionMin)}</span>}
      />

      {cancelada && (
        <div className="mb-4 rounded-2xl bg-rose/10 border border-rose/20 p-4 flex gap-3">
          <Ban className="h-6 w-6 text-rose shrink-0" />
          <div>
            <p className="font-semibold text-rose">Clase cancelada</p>
            <p className="text-ink-soft">{clase.motivoCancelacion || 'Sin motivo indicado.'}</p>
            {alternativa && <p className="text-sm mt-1">Alternativa propuesta: <Link className="font-semibold text-sky underline" to={`/clase/${alternativa.id}`}>{fechaCorta(alternativa.fecha)} a las {alternativa.horaInicio}</Link></p>}
            {puede('CLASES_CREAR_CANCELAR') && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Boton variante="secundario" tamano="sm" onClick={() => setReactivar(true)}><RotateCcw className="h-4 w-4" /> Reactivar clase</Boton>
                {sinNadie && <Boton variante="fantasma" tamano="sm" className="text-rose" onClick={() => setEliminar(true)}><Trash2 className="h-4 w-4" /> Eliminar clase</Boton>}
              </div>
            )}
          </div>
        </div>
      )}
      {clase.publicada === false && !cancelada && (
        <div className="mb-4 rounded-2xl bg-sky/10 border border-sky/30 p-4 flex gap-3">
          <EyeOff className="h-6 w-6 text-sky shrink-0" />
          <div>
            <p className="font-semibold text-ink">Sin publicar</p>
            <p className="text-ink-soft">Los alumnos no ven esta clase (salvo los que ya tengan plaza). Se verá cuando alguien que gestione el horario pulse «Publicar cambios» en el calendario.</p>
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
                {retenidas > 0 && <Chip tono="azul" title="Plazas que liberó el equipo: los alumnos no las ven hasta «Publicar cambios»"><EyeOff className="h-3.5 w-3.5" /> {retenidas === 1 ? '1 plaza retenida' : `${retenidas} plazas retenidas`}</Chip>}
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
                      <AvatarCliente cliente={c} tamano="md" />
                      <div className="flex-1 min-w-0">
                        <Link to={`/clientes/${r.clienteId}`} className="font-semibold hover:underline block truncate">{nombreCompleto(c)}</Link>
                        <div className="flex gap-1.5 flex-wrap mt-0.5">
                          <ChipOrigen origen={r.origen} />{!c?.activo && <Chip tono="rojo">Baja</Chip>}
                          {clase.fecha === hoy && esCumpleanos(c?.fechaNacimiento, hoy) && <Chip tono="ambar">🎂 Cumple hoy</Chip>}
                          {hitos.get(r.clienteId) && <Chip tono="beige">🎉 Su clase {hitos.get(r.clienteId)}</Chip>}
                          {ganador === r.clienteId && <Chip tono="ambar">🏆 Cliente del mes</Chip>}
                        </div>
                      </div>
                      {puede('RESERVAS_GESTIONAR') && !pasada && !cancelada && (
                        <button type="button" onClick={() => setQuitar(r)} aria-label="Quitar alumno" title="Quitar de la clase" className="h-11 w-11 rounded-full flex items-center justify-center text-ink-muted hover:bg-rose/10 hover:text-rose tap"><UserMinus className="h-5 w-5" /></button>
                      )}
                    </div>
                    {puedeAsistencia && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:ml-14">
                        <BotonAsistencia activo={r.asistencia === 'ASISTE'} tono="beige" onClick={() => marcar(r, 'ASISTE')}><Check className="h-5 w-5" /> Asiste</BotonAsistencia>
                        <BotonAsistencia activo={r.asistencia === 'NO_ASISTE'} tono="rojo" onClick={() => marcar(r, 'NO_ASISTE')}><X className="h-5 w-5" /> No asiste</BotonAsistencia>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Tarjeta>

          {!cancelada && !pasada && (espera.length > 0 || ocupadas >= clase.plazas) && (
            <Tarjeta>
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h2 className="text-lg font-semibold font-sans flex items-center gap-2"><Hourglass className="h-5 w-5 text-sky" /> Lista de espera ({espera.length})</h2>
              </div>
              {espera.length === 0 && <p className="px-4 pb-5 text-ink-muted">Nadie en lista de espera. Si la clase está completa, los alumnos pueden apuntarse desde su app.</p>}
              <ul className="divide-y divide-ink/5">
                {espera.map((e) => (
                  <li key={e.entrada.id} className="p-3 sm:px-4 flex items-center gap-3">
                    <span className="h-9 w-9 shrink-0 rounded-full bg-sky/10 text-sky font-bold flex items-center justify-center">{e.posicion}</span>
                    <div className="flex-1 min-w-0">
                      <Link to={`/clientes/${e.entrada.clienteId}`} className="font-semibold hover:underline block truncate">{nombreCompleto(e.cliente)}</Link>
                      <p className="text-sm text-ink-muted">
                        {e.cambio ? `A cambio de su clase de ${e.cambio.actividad?.nombre ?? ''} del ${fechaCorta(e.cambio.clase.fecha)} a las ${e.cambio.clase.horaInicio}` : 'Reservaría con su tarifa'} · desde el {fechaCorta(e.entrada.creadaEl.slice(0, 10))}
                      </p>
                    </div>
                    {puede('RESERVAS_GESTIONAR') && (
                      <button type="button" onClick={() => setQuitarEspera(e)} aria-label="Quitar de la lista de espera" title="Quitar de la lista de espera" className="h-11 w-11 rounded-full flex items-center justify-center text-ink-muted hover:bg-rose/10 hover:text-rose tap"><UserMinus className="h-5 w-5" /></button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="px-4 pb-4 pt-1 text-sm text-ink-muted">
                {esperaCerrada
                  ? `Faltan menos de ${HORAS_CIERRE_LISTA_ESPERA} horas: la lista ya no actúa sola. Si se libera una plaza, apunta tú al alumno con «Añadir alumno».`
                  : `Si alguien deja su plaza, entra el primero de la lista automáticamente y recibe un aviso. La lista funciona hasta ${HORAS_CIERRE_LISTA_ESPERA} horas antes de la clase.`}
              </p>
            </Tarjeta>
          )}

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
          {puede('CLASES_CREAR_CANCELAR') && !cancelada && !pasada && (sinNadie
            ? <Boton ancho variante="peligro" onClick={() => setEliminar(true)}><Trash2 className="h-5 w-5" /> Eliminar clase</Boton>
            : <Boton ancho variante="peligro" onClick={() => setCancelar(true)}><Ban className="h-5 w-5" /> Cancelar clase</Boton>)}
          {ocupadas >= clase.plazas && !cancelada && !pasada && <p className="text-sm text-ink-muted text-center pt-1">La clase está completa.</p>}
        </aside>
      </div>

      <HojaAnadirAlumno abierta={anadir} onCerrar={() => setAnadir(false)} claseId={clase.id} yaApuntados={activas.map((r) => r.clienteId)} />
      <HojaCancelarClase abierta={cancelar} onCerrar={() => setCancelar(false)} claseId={clase.id} afectados={activas.length} />
      <Confirmacion abierta={eliminar} onCerrar={() => setEliminar(false)} titulo="Eliminar clase" textoConfirmar="Eliminar clase" peligro onConfirmar={() => void confirmarEliminar()}>
        <p>La clase de <strong className="text-ink">{actividad.nombre}</strong> del {fechaCorta(clase.fecha)} a las {clase.horaInicio} desaparece del calendario. No hay nadie apuntado, así que no hay a quién avisar.</p>
        {canceladas.length > 0 && <p>{canceladas.length === 1 ? 'Hay 1 cancelación apuntada' : `Hay ${canceladas.length} cancelaciones apuntadas`} en esta clase: desaparecen con ella, pero la recuperación que se dio por cancelar se conserva.</p>}
      </Confirmacion>
      <Confirmacion abierta={reactivar} onCerrar={() => setReactivar(false)} titulo="Reactivar clase" textoConfirmar="Reactivar clase" onConfirmar={() => void confirmarReactivar()}>
        <p>La clase vuelve a estar programada{perdieronPlaza > 0 ? <> y <strong className="text-ink">{perdieronPlaza === 1 ? 'el alumno que estaba apuntado recupera' : `los ${perdieronPlaza} alumnos que estaban apuntados recuperan`}</strong> su plaza</> : ''}.</p>
        {perdieronPlaza > 0 && <p>La recuperación que se les dio por la cancelación se retira (si no la han usado){pasada ? '.' : ', desaparece el aviso de «Clase cancelada» y reciben otro diciendo que la clase se mantiene.'}</p>}
        {!pasada && <p>Los alumnos de horario fijo de esta franja que no estaban se apuntan solos si hay sitio.</p>}
      </Confirmacion>
      <Confirmacion abierta={quitar != null} onCerrar={() => setQuitar(null)} titulo="Quitar de la clase" textoConfirmar="Quitar alumno" peligro onConfirmar={confirmarQuitar}>
        <p><strong className="text-ink">{nombreCompleto(clientes.get(quitar?.clienteId ?? ''))}</strong> dejará de estar apuntado/a a esta clase.</p>
        <p>No se le penaliza: se le devuelve el derecho (recuperación, sesión de bono o recuperación consumida) para que pueda usarlo en otra clase.</p>
        {espera.length > 0 && !esperaCerrada && <p>La plaza que queda libre será para <strong className="text-ink">{nombreCompleto(espera[0].cliente)}</strong>, que es quien va primero en la lista de espera.</p>}
      </Confirmacion>
      <Confirmacion abierta={quitarEspera != null} onCerrar={() => setQuitarEspera(null)} titulo="Quitar de la lista de espera" textoConfirmar="Quitar de la lista" peligro onConfirmar={confirmarQuitarEspera}>
        <p><strong className="text-ink">{nombreCompleto(quitarEspera?.cliente)}</strong> dejará de esperar plaza en esta clase. No se le avisa.</p>
      </Confirmacion>
    </div>
  );
}

function BotonAsistencia({ activo, tono, onClick, children }: { activo: boolean; tono: 'beige' | 'rojo'; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={activo}
      className={cn('h-11 rounded-xl font-semibold flex items-center justify-center gap-1.5 border tap',
        activo && tono === 'beige' && 'bg-brand-500 text-sand border-brand-500',
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
  const anadir = async (modo: 'TARIFA' | 'CLASE_SUELTA' | 'MANUAL') => {
    if (!cliente) return;
    const r = await ejecutar('anadirAlumno', { claseId, clienteId: cliente.id, modo });
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
            <AvatarCliente cliente={cliente} />
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
    <button type="button" onClick={onClick} className={cn('w-full text-left rounded-2xl border p-4 tap', destacada ? 'border-beige-500 bg-beige-50 hover:bg-beige-100' : 'border-ink/10 bg-white hover:border-beige-300')}>
      <span className="block font-semibold">{titulo}</span>
      <span className="block text-sm text-ink-muted">{texto}</span>
    </button>
  );
}

function HojaCancelarClase({ abierta, onCerrar, claseId, afectados }: { abierta: boolean; onCerrar: () => void; claseId: string; afectados: number }) {
  const { db, ejecutar } = useTrabajador();
  const navigate = useNavigate();
  const [motivo, setMotivo] = useState('');
  const [alternativa, setAlternativa] = useState('');
  const [avisar, setAvisar] = useState(true);
  const clase = db.clases.find((c) => c.id === claseId);
  if (!clase) return null;
  const alternativas = alternativasPara(db, clase, hoyISO());
  const cierre = db.config.diasCierre.find((d) => d.fecha === clase.fecha);
  // 0038/0041: si no hay nadie apuntado, cancelarla la borra del calendario.
  const vacia = !db.reservas.some((r) => r.claseId === claseId && r.estado === 'RESERVADA');
  const confirmar = async () => {
    const r = await ejecutar('cancelarClase', { claseId, motivo: motivo.trim(), claseAlternativaId: alternativa || null, avisar });
    if (!r.ok) return toast.error(r.error);
    if (r.valor.borrada) { toast.ok('Clase eliminada del calendario (no había nadie apuntado).'); onCerrar(); navigate('/'); return; }
    toast.ok(`Clase cancelada. ${r.valor.afectados} alumno${r.valor.afectados === 1 ? '' : 's'} afectado${r.valor.afectados === 1 ? '' : 's'}.`);
    onCerrar();
  };
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Cancelar clase">
      <div className="space-y-4">
        {vacia ? (
          <div className="rounded-2xl bg-beige-100 p-3 text-sm text-ink-soft flex gap-2"><AlertTriangle className="h-5 w-5 text-ink-muted shrink-0" /><span><strong className="text-ink">No hay nadie apuntado.</strong> La clase se eliminará del calendario directamente: no hay a quién avisar ni nada que conservar.</span></div>
        ) : (
          <div className="rounded-2xl bg-clay/10 p-3 text-sm text-ink-soft flex gap-2"><AlertTriangle className="h-5 w-5 text-clay shrink-0" /><span><strong className="text-ink">{afectados} alumno{afectados === 1 ? '' : 's'}</strong> con plaza. {cierre ? <>Es día de cierre ({cierre.motivo}): <strong className="text-ink">los festivos no se recuperan</strong>, solo se devuelve lo gastado en esta clase (sesión de bono o recuperación usada).</> : 'Cada uno recibirá una recuperación (o se le devolverá la sesión de bono) sin penalización.'}</span></div>
        )}
        <AreaTexto etiqueta="Motivo" placeholder="Ej.: baja del monitor, avería en la sala…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <Seleccion etiqueta="Clase alternativa (opcional)" ayuda="Misma actividad en los próximos 14 días" value={alternativa} onChange={(e) => setAlternativa(e.target.value)}>
          <option value="">Sin alternativa</option>
          {alternativas.map((v) => <option key={v.clase.id} value={v.clase.id}>{fechaCorta(v.clase.fecha)} · {v.clase.horaInicio} · {v.libres} libres</option>)}
        </Seleccion>
        {!vacia && <Interruptor activo={avisar} onCambio={setAvisar} etiqueta="Avisar a los alumnos afectados" descripcion="Se publica un aviso importante con el motivo y la alternativa." />}
        <Boton ancho variante="peligro" onClick={confirmar}>{vacia ? 'Eliminar la clase' : 'Cancelar la clase'}</Boton>
      </div>
    </Hoja>
  );
}

/** Alumnos de la clase de hoy que llegan a una cifra redonda (10, 25, 50, 100…): "🎉 Su clase 100". */
function useHitos(clienteIds: string[], fecha: string): Map<string, number> {
  const [hitos, setHitos] = useState<Map<string, number>>(new Map());
  const clave = clienteIds.join(',');
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
