/**
 * Ajustes → Sorpresas: cumpleaños, "Tu año en Pilates" y cliente del mes, con vistas
 * previas para ver exactamente lo que verán los alumnos.
 */
import { useState } from 'react';
import { Bell, Cake, Eye, Gift, Save, Sparkles, Trophy } from 'lucide-react';
import { hoyISO } from '@/domain/fechas';
import { MENSAJE_CUMPLEANOS_POR_DEFECTO, NOMBRE_MES, type ResumenAnual } from '@/domain/logros';
import { mesAnterior, nombreMes } from '@/domain/clienteDelMes';
import { resumenCentro, type ResumenCentro } from '@/data/logros';
import { AreaTexto, Boton, Hoja, Interruptor, Seleccion, Tarjeta, toast } from '@/ui';
import { HistoriaCentro, HistoriaResumen, TarjetaCumpleanos, TarjetaPremioMes } from '@/features/comun/Logros';
import { useTrabajador } from './useTrabajador';
import { HojaClienteDelMes } from './ClienteDelMes';
import { Seccion } from './comunes';

const EJEMPLO_RESUMEN: ResumenAnual = {
  anio: 0, total: 86, horas: 79, actividadFavoritaId: null, vecesActividadFavorita: 52, actividadesDistintas: 3,
  horaFavorita: '09:30', deMananas: true, mejorRacha: 14, monitorFavoritoId: null, vecesMonitorFavorito: 40, mesTop: 10, clasesMesTop: 11,
};

/** Día y mes (guardado como MM-DD). */
function CampoDiaMes({ etiqueta, valor, onCambio }: { etiqueta: string; valor: string; onCambio: (v: string) => void }) {
  const [m, d] = /^\d{2}-\d{2}$/.test(valor) ? valor.split('-') : ['12', '15'];
  const poner = (mes: string, dia: string) => onCambio(`${mes}-${dia}`);
  return (
    <div>
      <span className="block text-[15px] font-semibold mb-1.5">{etiqueta}</span>
      <div className="flex gap-2">
        <Seleccion aria-label={`${etiqueta}: día`} className="w-24" value={d} onChange={(e) => poner(m, e.target.value)}>
          {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((x) => <option key={x} value={x}>{Number(x)}</option>)}
        </Seleccion>
        <Seleccion aria-label={`${etiqueta}: mes`} value={m} onChange={(e) => poner(e.target.value, d)}>
          {NOMBRE_MES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, '0')}>{n}</option>)}
        </Seleccion>
      </div>
    </div>
  );
}

function textoVentana(desde: string, hasta: string): string {
  const t = (v: string) => `${Number(v.slice(3))} de ${NOMBRE_MES[Number(v.slice(0, 2)) - 1]}`;
  return `del ${t(desde)} al ${t(hasta)}`;
}

export const TITULO_PEDIR_FECHA = '🎂 ¿Cuándo es tu cumpleaños?';
export const CUERPO_PEDIR_FECHA = 'Nos gustaría felicitarte ese día. Si quieres, pon tu fecha de nacimiento en Perfil → Fecha de nacimiento (es opcional y solo la ve el equipo). ¡Gracias!';

export function Sorpresas() {
  const { db, ejecutar, puede } = useTrabajador();
  const c = db.config;
  const inicial = {
    mensajeCumpleanos: c.mensajeCumpleanos ?? '',
    resumenAnualActivo: c.resumenAnualActivo ?? true,
    resumenAnualDesde: c.resumenAnualDesde || '12-15',
    resumenAnualHasta: c.resumenAnualHasta || '01-15',
    clienteDelMesActivo: c.clienteDelMesActivo ?? true,
  };
  const [f, setF] = useState(inicial);
  const cambiado = JSON.stringify(f) !== JSON.stringify(inicial);
  const [guardando, setGuardando] = useState(false);
  const [vista, setVista] = useState<null | 'CUMPLE' | 'RESUMEN' | 'PREMIO'>(null);
  const [centro, setCentro] = useState<{ anio: number; datos: ResumenCentro } | null>(null);
  const [cargandoCentro, setCargandoCentro] = useState(false);
  const [hojaPremio, setHojaPremio] = useState(false);
  const [pedirFecha, setPedirFecha] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const hoy = hoyISO();
  const activos = db.clientes.filter((c) => c.activo);
  const conFecha = activos.filter((c) => !!c.fechaNacimiento).length;
  const sinFechaConApp = activos.filter((c) => !c.fechaNacimiento && !!c.userId);
  const pedir = async () => {
    setPidiendo(true);
    const r = await ejecutar('publicarAviso', {
      titulo: TITULO_PEDIR_FECHA, cuerpo: CUERPO_PEDIR_FECHA,
      destino: { tipo: 'CLIENTES', clienteIds: sinFechaConApp.map((c) => c.id) }, importante: false,
    });
    setPidiendo(false);
    setPedirFecha(false);
    if (r.ok) toast.ok(`Aviso enviado a ${sinFechaConApp.length === 1 ? '1 alumno' : `${sinFechaConApp.length} alumnos`}.`); else toast.error(r.error);
  };
  const anioActual = Number(hoy.slice(0, 4));
  // Hasta mediados de enero tiene más sentido el año que acaba de terminar.
  const anioCentro = hoy.slice(5) <= '01-31' ? anioActual - 1 : anioActual;

  const guardar = async () => {
    setGuardando(true);
    const r = await ejecutar('actualizarConfig', { config: { ...f, mensajeCumpleanos: f.mensajeCumpleanos.trim() } });
    setGuardando(false);
    if (r.ok) toast.ok('Sorpresas guardadas.'); else toast.error(r.error);
  };
  const verCentro = async () => {
    setCargandoCentro(true);
    try { setCentro({ anio: anioCentro, datos: await resumenCentro(anioCentro) }); } catch (e) { toast.error(e instanceof Error ? e.message : 'No se ha podido calcular.'); }
    setCargandoCentro(false);
  };
  const premios = db.premios.slice(0, 6);
  const nombre = (id: string) => { const x = db.clientes.find((k) => k.id === id); return x ? `${x.nombre} ${x.apellidos}`.trim() : '—'; };
  const actividadTop = centro?.datos.actividad ? db.actividades.find((a) => a.id === centro.datos.actividad!.id)?.nombre ?? null : null;

  return (
    <Tarjeta className="p-4 sm:p-6">
      <Seccion titulo={<span className="flex items-center gap-2"><Gift className="h-5 w-5 text-ink-muted" /> Sorpresas para los alumnos</span>}>
        <p className="text-sm text-ink-soft mb-5">Detalles que la app regala a los alumnos: medallas por sus clases (siempre activas), felicitación de cumpleaños, su resumen del año y el premio al cliente del mes. Con los botones "Ver" puedes ver cómo les sale.</p>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="font-semibold flex items-center gap-2"><Cake className="h-5 w-5 text-ink-muted" /> Cumpleaños</p>
            <AreaTexto etiqueta="Mensaje de felicitación" ayuda="Vacío = el mensaje de siempre." placeholder={MENSAJE_CUMPLEANOS_POR_DEFECTO} rows={4} maxLength={400}
              value={f.mensajeCumpleanos} onChange={(e) => setF({ ...f, mensajeCumpleanos: e.target.value })} />
            <Boton variante="secundario" tamano="sm" onClick={() => setVista('CUMPLE')}><Eye className="h-4 w-4" /> Ver felicitación</Boton>
            <p className="text-sm text-ink-muted">{conFecha} de {activos.length} alumnos activos tienen puesta la fecha de nacimiento. El equipo ve en el calendario quién cumple hoy y esta semana, y los monitores reciben una notificación por la mañana (si la tienen activada en Más → Avisos en el móvil).</p>
            {sinFechaConApp.length > 0 && puede('AVISOS_ENVIAR') && (
              <Boton variante="secundario" tamano="sm" onClick={() => setPedirFecha(true)}><Bell className="h-4 w-4" /> Pedir la fecha a los {sinFechaConApp.length} que usan la app</Boton>
            )}
          </div>

          <div className="space-y-3">
            <p className="font-semibold flex items-center gap-2"><Sparkles className="h-5 w-5 text-ink-muted" /> "Tu año en Pilates"</p>
            <Interruptor activo={f.resumenAnualActivo} onCambio={(v) => setF({ ...f, resumenAnualActivo: v })} etiqueta="Activo"
              descripcion={f.resumenAnualActivo ? `Los alumnos con 5 clases o más lo ven ${textoVentana(f.resumenAnualDesde, f.resumenAnualHasta)}.` : 'No se muestra.'} />
            {f.resumenAnualActivo && (
              <div className="grid grid-cols-1 gap-3">
                <CampoDiaMes etiqueta="Desde" valor={f.resumenAnualDesde} onCambio={(v) => setF({ ...f, resumenAnualDesde: v })} />
                <CampoDiaMes etiqueta="Hasta" valor={f.resumenAnualHasta} onCambio={(v) => setF({ ...f, resumenAnualHasta: v })} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Boton variante="secundario" tamano="sm" onClick={() => setVista('RESUMEN')}><Eye className="h-4 w-4" /> Ver ejemplo</Boton>
              <Boton variante="secundario" tamano="sm" onClick={() => void verCentro()} cargando={cargandoCentro}><Eye className="h-4 w-4" /> El {anioCentro} del centro</Boton>
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-semibold flex items-center gap-2"><Trophy className="h-5 w-5 text-ink-muted" /> Cliente del mes</p>
            <Interruptor activo={f.clienteDelMesActivo} onCambio={(v) => setF({ ...f, clienteDelMesActivo: v })} etiqueta="Activo"
              descripcion="Reto mensual en la pantalla de inicio de cada alumno y premio al más constante, que elegís vosotros." />
            <div className="flex flex-wrap gap-2">
              <Boton tamano="sm" onClick={() => setHojaPremio(true)}><Trophy className="h-4 w-4" /> Elegir ganador</Boton>
              <Boton variante="secundario" tamano="sm" onClick={() => setVista('PREMIO')}><Eye className="h-4 w-4" /> Ver ejemplo</Boton>
            </div>
            {premios.length > 0 && (
              <ul className="text-sm space-y-1.5">
                {premios.map((p) => (
                  <li key={p.mes} className="flex gap-2"><span aria-hidden>🏆</span><span><strong>{nombreMes(p.mes, true).replace(/^./, (x) => x.toUpperCase())}</strong>: {nombre(p.clienteId)}{p.publico === true ? ' · visible para todos' : p.publico === false ? ' · prefiere que no se vea' : ' · sin contestar'}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-5"><Boton onClick={() => void guardar()} disabled={!cambiado} cargando={guardando}><Save className="h-5 w-5" /> Guardar</Boton></div>
      </Seccion>

      {vista === 'CUMPLE' && <TarjetaCumpleanos nombre="Ana" mensaje={f.mensajeCumpleanos.trim() || MENSAJE_CUMPLEANOS_POR_DEFECTO} onCerrar={() => setVista(null)} />}
      {vista === 'RESUMEN' && (
        <HistoriaResumen ejemplo onCerrar={() => setVista(null)}
          datos={{ nombre: 'Ana', actividad: db.actividades[0]?.nombre ?? 'Pilates Reformer', monitor: db.trabajadores[0]?.nombre.split(' ')[0] ?? null, resumen: { ...EJEMPLO_RESUMEN, anio: anioCentro } }} />
      )}
      {vista === 'PREMIO' && <TarjetaPremioMes ejemplo nombre="Ana" mesTexto={nombreMes(mesAnterior(hoy))} clases={12} preguntar onResponder={() => setVista(null)} onCerrar={() => setVista(null)} />}
      {centro && <HistoriaCentro anio={centro.anio} datos={centro.datos} actividad={actividadTop} onCerrar={() => setCentro(null)} />}
      <HojaClienteDelMes abierta={hojaPremio} onCerrar={() => setHojaPremio(false)} />
      <Hoja abierta={pedirFecha} onCerrar={() => setPedirFecha(false)} titulo="Pedir la fecha de nacimiento">
        <p className="text-ink-soft">Se publica un aviso (sin marcar como importante) para los <strong className="text-ink">{sinFechaConApp.length}</strong> alumnos activos con cuenta en la app que no han puesto su fecha de nacimiento.</p>
        <div className="rounded-2xl bg-sand p-3 mt-3 text-[15px]"><p className="font-semibold">{TITULO_PEDIR_FECHA}</p><p className="text-ink-soft mt-1">{CUERPO_PEDIR_FECHA}</p></div>
        <div className="grid gap-2 mt-4">
          <Boton tamano="lg" ancho cargando={pidiendo} onClick={() => void pedir()}><Bell className="h-5 w-5" /> Enviar el aviso</Boton>
          <Boton tamano="lg" ancho variante="secundario" onClick={() => setPedirFecha(false)}>Cancelar</Boton>
        </div>
      </Hoja>
    </Tarjeta>
  );
}
