/**
 * Sorpresas del alumno al abrir la app, por orden: felicitación de cumpleaños, medallas
 * nuevas y "Tu año en Pilates" (en su ventana de fechas). Cada una sale una sola vez en
 * este dispositivo (se recuerda en localStorage). También: "Mis logros" del Perfil, la
 * pregunta del cumpleaños y la tarjeta para volver a ver el resumen desde Inicio.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cake, ChevronRight, Sparkles, Trophy, X } from 'lucide-react';
import type { Db } from '@/data/db';
import type { Cliente, PremioMes, Tarifa } from '@/domain/types';
import { nombreMes, premioVigente, retoDelMes } from '@/domain/clienteDelMes';
import { hoyISO } from '@/domain/fechas';
import {
  MEDALLAS, MENSAJE_CUMPLEANOS_POR_DEFECTO, MINIMO_CLASES_RESUMEN, anioResumenVisible, calcularMedallas, esCumpleanos, resumenAnual,
  type ClaseHecha, type IdMedalla, type Medalla,
} from '@/domain/logros';
import { useHistorialCliente } from '@/data/logros';
import { useStore } from '@/data/store';
import { Boton, Entrada, Tarjeta, toast } from '@/ui';
import { CelebracionMedallas, HistoriaResumen, Medallero, TarjetaCumpleanos, TarjetaPremioMes, type DatosResumenAlumno } from '@/features/comun/Logros';
import { useCliente } from './useCliente';

// ---------------------------------------------------------------------------
// Memoria local (por dispositivo y cliente)
// ---------------------------------------------------------------------------

function leer(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function escribir(clave: string, valor: string) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}
const claves = (clienteId: string) => ({
  medallas: `np-medallas-vistas:${clienteId}`,
  cumple: `np-cumple-visto:${clienteId}`,
  resumen: `np-resumen-visto:${clienteId}`,
  pregunta: `np-pregunta-cumple:${clienteId}`,
  premio: `np-premio-visto:${clienteId}`,
});

export function cupoSemanal(tarifa: Tarifa | null): number {
  if (tarifa?.tipo !== 'RECURRENTE') return 2;
  return Math.max(1, tarifa.cupos.reduce((s, c) => s + c.sesionesSemana, 0));
}

export function datosResumen(db: Db, cliente: Cliente, clases: ClaseHecha[], anio: number): DatosResumenAlumno {
  const resumen = resumenAnual(clases, anio);
  const monitor = db.trabajadores.find((t) => t.id === resumen.monitorFavoritoId);
  return {
    nombre: cliente.nombre,
    resumen,
    actividad: db.actividades.find((a) => a.id === resumen.actividadFavoritaId)?.nombre ?? null,
    monitor: monitor ? monitor.nombre.split(' ')[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Sorpresas al abrir la app
// ---------------------------------------------------------------------------

type Paso = { tipo: 'PREMIO'; premio: PremioMes } | { tipo: 'CUMPLE' } | { tipo: 'MEDALLAS'; medallas: Medalla[]; estreno: boolean } | { tipo: 'RESUMEN'; anio: number };

export function Celebraciones() {
  const { db, cliente, tarifa } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const clases = useHistorialCliente(cliente.id);
  const [cola, setCola] = useState<Paso[]>([]);
  const preparado = useRef(false);
  const hoy = hoyISO();
  const k = claves(cliente.id);

  useEffect(() => {
    if (preparado.current || clases === null) return;
    preparado.current = true;
    const pasos: Paso[] = [];
    const premio = db.config.clienteDelMesActivo === false ? null : premioVigente(db.premios, hoy);
    if (premio && premio.clienteId === cliente.id && leer(k.premio) !== premio.mes) pasos.push({ tipo: 'PREMIO', premio });
    if (esCumpleanos(cliente.fechaNacimiento, hoy) && leer(k.cumple) !== hoy) pasos.push({ tipo: 'CUMPLE' });

    const conseguidas = calcularMedallas(clases, { cupoSemanal: cupoSemanal(tarifa), hoy }).filter((e) => e.conseguida).map((e) => e.medalla);
    const vistasTexto = leer(k.medallas);
    if (vistasTexto === null) {
      // Primera vez con medallas en este móvil: se celebran todas las que ya tiene.
      if (conseguidas.length > 0) pasos.push({ tipo: 'MEDALLAS', medallas: conseguidas, estreno: true });
      else escribir(k.medallas, '[]');
    } else {
      let vistas: IdMedalla[] = [];
      try { vistas = JSON.parse(vistasTexto) as IdMedalla[]; } catch { /* lista dañada: se rehace */ }
      const nuevas = conseguidas.filter((m) => !vistas.includes(m.id));
      if (nuevas.length > 0) pasos.push({ tipo: 'MEDALLAS', medallas: nuevas, estreno: false });
    }

    const anio = anioResumenVisible(hoy, { activo: db.config.resumenAnualActivo, desde: db.config.resumenAnualDesde, hasta: db.config.resumenAnualHasta });
    if (anio && leer(k.resumen) !== String(anio) && resumenAnual(clases, anio).total >= MINIMO_CLASES_RESUMEN) pasos.push({ tipo: 'RESUMEN', anio });
    setCola(pasos);
  }, [clases, cliente.fechaNacimiento, cliente.id, db.config, db.premios, hoy, k.cumple, k.medallas, k.premio, k.resumen, tarifa]);

  const paso = cola[0];
  if (!paso || clases === null) return null;
  const siguiente = () => {
    if (paso.tipo === 'CUMPLE') escribir(k.cumple, hoy);
    if (paso.tipo === 'PREMIO') escribir(k.premio, paso.premio.mes);
    if (paso.tipo === 'MEDALLAS') {
      const conseguidas = calcularMedallas(clases, { cupoSemanal: cupoSemanal(tarifa), hoy }).filter((e) => e.conseguida).map((e) => e.medalla.id);
      escribir(k.medallas, JSON.stringify(conseguidas));
    }
    if (paso.tipo === 'RESUMEN') escribir(k.resumen, String(paso.anio));
    setCola(cola.slice(1));
  };
  if (paso.tipo === 'PREMIO') {
    return (
      <TarjetaPremioMes nombre={cliente.nombre} mesTexto={nombreMes(paso.premio.mes)} clases={paso.premio.clases} preguntar={paso.premio.publico === null}
        onResponder={async (publico) => {
          const r = await ejecutar('responderClienteDelMes', { mes: paso.premio.mes, publico });
          if (!r.ok) return toast.error(r.error);
          toast.ok(publico ? '¡Hecho! Los demás alumnos lo verán en la app 🎉' : 'Entendido: solo lo sabremos en el centro.');
          siguiente();
        }}
        onCerrar={siguiente} />
    );
  }
  if (paso.tipo === 'CUMPLE') return <TarjetaCumpleanos nombre={cliente.nombre} mensaje={db.config.mensajeCumpleanos?.trim() || MENSAJE_CUMPLEANOS_POR_DEFECTO} onCerrar={siguiente} />;
  if (paso.tipo === 'MEDALLAS') return <CelebracionMedallas medallas={paso.medallas} estreno={paso.estreno} onCerrar={siguiente} />;
  return <HistoriaResumen datos={datosResumen(db, cliente, clases, paso.anio)} onCerrar={siguiente} />;
}

// ---------------------------------------------------------------------------
// Perfil: "Mis logros"
// ---------------------------------------------------------------------------

export function MisLogros() {
  const { db, cliente, tarifa } = useCliente();
  const premios = db.premios.filter((p) => p.clienteId === cliente.id);
  const clases = useHistorialCliente(cliente.id);
  const hoy = hoyISO();
  const estados = useMemo(() => (clases ? calcularMedallas(clases, { cupoSemanal: cupoSemanal(tarifa), hoy }) : null), [clases, tarifa, hoy]);
  if (!estados) return <Tarjeta className="p-5 text-ink-muted">Cargando tus medallas…</Tarjeta>;
  const n = estados.filter((e) => e.conseguida).length;
  return (
    <Tarjeta className="p-5">
      <p className="text-ink-soft mb-5">
        {n === 0 ? 'Tu primera medalla llega con tu primera clase. ¡Te esperamos!' : <>Llevas <strong className="text-ink">{clases!.length} {clases!.length === 1 ? 'clase' : 'clases'}</strong> y <strong className="text-ink">{n} de {MEDALLAS.length} medallas</strong>.</>}
      </p>
      <Medallero estados={estados} />
      {premios.length > 0 && (
        <ul className="mt-6 space-y-2">
          {premios.map((p) => (
            <li key={p.mes} className="flex items-center gap-3 rounded-2xl bg-[#FBF3DF] border border-[#E6CF98] px-4 py-3">
              <Trophy className="h-6 w-6 text-[#7A5A1E] shrink-0" />
              <span><strong>Cliente del mes</strong> · {nombreMes(p.mes, true)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Inicio: "Tu año en Pilates" (para volver a verlo) y la pregunta del cumpleaños
// ---------------------------------------------------------------------------

export function TarjetaResumenInicio() {
  const { db, cliente } = useCliente();
  const clases = useHistorialCliente(cliente.id);
  const [abierto, setAbierto] = useState(false);
  const anio = anioResumenVisible(hoyISO(), { activo: db.config.resumenAnualActivo, desde: db.config.resumenAnualDesde, hasta: db.config.resumenAnualHasta });
  if (!anio || !clases || resumenAnual(clases, anio).total < MINIMO_CLASES_RESUMEN) return null;
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="w-full mb-4 tarjeta-marca p-4 flex items-center gap-4 text-left tap">
        <span className="h-12 w-12 rounded-2xl bg-ink text-sand flex items-center justify-center shrink-0"><Sparkles className="h-6 w-6" /></span>
        <span className="flex-1 min-w-0"><span className="block font-serif text-xl leading-tight">Tu {anio} en Pilates</span><span className="block text-sm text-ink-soft">Tu año, en seis pantallas. ¡Y para compartir!</span></span>
        <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
      </button>
      {abierto && <HistoriaResumen datos={datosResumen(db, cliente, clases, anio)} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

export function PreguntaCumpleanos() {
  const { cliente } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const k = claves(cliente.id);
  const [oculta, setOculta] = useState(() => leer(k.pregunta) === '1');
  const [fecha, setFecha] = useState('');
  const [guardando, setGuardando] = useState(false);
  if (cliente.fechaNacimiento || oculta) return null;
  const cerrar = () => { escribir(k.pregunta, '1'); setOculta(true); };
  const guardar = async () => {
    if (!fecha) return toast.error('Elige tu fecha de nacimiento.');
    setGuardando(true);
    const r = await ejecutar('actualizarPreferenciasCliente', { fechaNacimiento: fecha });
    setGuardando(false);
    if (r.ok) { toast.ok('¡Apuntado! Ese día tendrás una sorpresa 🎁'); cerrar(); } else toast.error(r.error);
  };
  return (
    <Tarjeta className="p-4 mb-4 relative">
      <button type="button" onClick={cerrar} aria-label="Ahora no" className="absolute top-2 right-2 h-9 w-9 rounded-full flex items-center justify-center text-ink-muted hover:bg-sand tap"><X className="h-5 w-5" /></button>
      <div className="flex items-start gap-3 pr-8">
        <span className="h-11 w-11 rounded-full bg-beige-100 text-cocoa flex items-center justify-center shrink-0"><Cake className="h-6 w-6" /></span>
        <div>
          <p className="font-semibold text-[17px] leading-tight">¿Cuándo es tu cumple?</p>
          <p className="text-sm text-ink-soft mt-0.5">Tenemos una sorpresa para ti ese día 🎁 Es opcional y solo lo usamos para felicitarte.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 items-end">
        <div className="flex-1"><Entrada aria-label="Fecha de nacimiento" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} /></div>
        <Boton onClick={() => void guardar()} cargando={guardando}>Guardar</Boton>
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Inicio: "Reto del mes" y "Cliente del mes"
// ---------------------------------------------------------------------------

export function TarjetaRetoMes() {
  const { db, cliente, contrato, tarifa } = useCliente();
  const clases = useHistorialCliente(cliente.id);
  if (db.config.clienteDelMesActivo === false || !clases || !contrato) return null;
  const reto = retoDelMes(clases, hoyISO(), cupoSemanal(tarifa));
  const pct = Math.min(100, Math.round((reto.hechas / reto.objetivo) * 100));
  const falta = reto.objetivo - reto.hechas;
  return (
    <Tarjeta className="p-4 mb-4">
      <div className="flex items-start gap-3">
        <span className="h-11 w-11 rounded-full bg-[#FBF3DF] text-[#7A5A1E] flex items-center justify-center shrink-0"><Trophy className="h-6 w-6" /></span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[17px] leading-tight">Reto de {nombreMes(reto.mes)}</p>
          <p className="text-sm text-ink-soft mt-0.5">
            {reto.cumplido
              ? '¡Reto conseguido! Ya optas a cliente del mes 🏆'
              : `Haz ${reto.objetivo} clases este mes y opta a cliente del mes. Te ${falta === 1 ? 'queda 1' : `quedan ${falta}`}.`}
          </p>
        </div>
        <span className="font-serif text-2xl leading-none shrink-0">{reto.hechas}<span className="text-base text-ink-muted">/{reto.objetivo}</span></span>
      </div>
      <div className="mt-3 h-2.5 rounded-full bg-beige-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={reto.objetivo} aria-valuenow={reto.hechas} aria-label="Progreso del reto">
        <div className={reto.cumplido ? 'h-full rounded-full bg-[#C9A55A]' : 'h-full rounded-full bg-brand-500'} style={{ width: `${pct}%` }} />
      </div>
    </Tarjeta>
  );
}

/** Ganador del mes: al propio ganador (y puede decidir si se ve) o a todos si lo aceptó. */
export function TarjetaClienteDelMes() {
  const { db, cliente } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const [guardando, setGuardando] = useState(false);
  if (db.config.clienteDelMesActivo === false) return null;
  const premio = premioVigente(db.premios, hoyISO());
  if (!premio) return null;
  const mio = premio.clienteId === cliente.id;
  if (!mio && !(premio.publico && premio.nombrePublico)) return null;
  const responder = async (publico: boolean) => {
    setGuardando(true);
    const r = await ejecutar('responderClienteDelMes', { mes: premio.mes, publico });
    setGuardando(false);
    if (r.ok) toast.ok(publico ? '¡Hecho! Los demás alumnos lo verán en la app 🎉' : 'Entendido: solo lo sabremos en el centro.'); else toast.error(r.error);
  };
  return (
    <div className="mb-4 rounded-[1.5rem] bg-[#FBF3DF] border border-[#E6CF98] p-4">
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>🏆</span>
        <p className="text-ink-soft">
          {mio
            ? <>¡El premio al <strong className="text-ink">cliente del mes de {nombreMes(premio.mes)}</strong> es tuyo! Enhorabuena.</>
            : <>Cliente del mes de {nombreMes(premio.mes)}: <strong className="text-ink">{premio.nombrePublico}</strong>. ¡Enhorabuena!</>}
        </p>
      </div>
      {mio && premio.publico === null && (
        <div className="mt-3">
          <p className="text-sm text-ink-soft">¿Quieres que los demás alumnos lo vean? Solo tu nombre y la inicial del apellido.</p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Boton tamano="sm" onClick={() => void responder(true)} disabled={guardando}>Sí, que se vea</Boton>
            <Boton tamano="sm" variante="secundario" onClick={() => void responder(false)} disabled={guardando}>Prefiero que no</Boton>
          </div>
        </div>
      )}
    </div>
  );
}
