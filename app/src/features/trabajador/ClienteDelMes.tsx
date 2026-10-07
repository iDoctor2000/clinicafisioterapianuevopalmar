/**
 * Cliente del mes (personal): propuesta de ganador, anuncio con aviso al móvil del
 * alumno, aviso en el calendario para todo el equipo y trofeo al pasar lista.
 */
import { useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { Db } from '@/data/db';
import type { Id, ISODate, PremioMes } from '@/domain/types';
import { hoyISO } from '@/domain/fechas';
import {
  avisoGanador, finMes, mesAnterior, motivoCandidato, nombreMes, ordenarCandidatos, premioVigente, type Candidato,
} from '@/domain/clienteDelMes';
import { contratoActivoDe, tarifaDe } from '@/data/selectores';
import { actividadDelMes } from '@/data/logros';
import { AreaTexto, Boton, Chip, Entrada, Hoja, Interruptor, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { Confirmacion, may } from './comunes';

/** Clases por semana de la tarifa que tenía el cliente al final de ese mes (2 si no es semanal). */
export function cupoSemanalEn(db: Db, clienteId: Id, fecha: ISODate): number {
  const tarifa = tarifaDe(db, contratoActivoDe(db, clienteId, fecha));
  if (tarifa?.tipo !== 'RECURRENTE') return 2;
  return Math.max(1, tarifa.cupos.reduce((s, c) => s + c.sesionesSemana, 0));
}

function nombreCompleto(db: Db, id: Id): string {
  const c = db.clientes.find((x) => x.id === id);
  return c ? `${c.nombre} ${c.apellidos}`.trim() : 'Cliente';
}

function textoPublico(p: PremioMes): string {
  if (p.publico === true) return 'Ha aceptado que lo vean los demás alumnos.';
  if (p.publico === false) return 'Prefiere que no lo vean los demás alumnos.';
  return 'Aún no ha dicho si quiere que lo vean los demás alumnos.';
}

// ---------------------------------------------------------------------------
// Hoja: elegir y anunciar
// ---------------------------------------------------------------------------

export function HojaClienteDelMes({ abierta, onCerrar, mesInicial }: { abierta: boolean; onCerrar: () => void; mesInicial?: ISODate }) {
  const { db, ejecutar } = useTrabajador();
  const hoy = hoyISO();
  const meses = useMemo(() => {
    const r: ISODate[] = [];
    let m = mesAnterior(hoy);
    for (let i = 0; i < 6; i++) { r.push(m); m = mesAnterior(m); }
    return r;
  }, [hoy]);
  const [mes, setMes] = useState<ISODate>(mesInicial ?? meses[0]);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<Id | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [avisar, setAvisar] = useState(true);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [quitar, setQuitar] = useState(false);
  const premio = db.premios.find((p) => p.mes === mes) ?? null;

  useEffect(() => {
    if (!abierta) return;
    let vivo = true;
    setCandidatos(null); setError(null); setVerTodos(false);
    actividadDelMes(mes)
      .then((act) => {
        if (!vivo) return;
        const lista = ordenarCandidatos(act, { mes, cupoDe: (id) => cupoSemanalEn(db, id, finMes(mes)), premios: db.premios.filter((p) => p.mes !== mes) })
          .filter((c) => db.clientes.some((x) => x.id === c.clienteId));
        setCandidatos(lista);
        setElegido(premio?.clienteId ?? lista[0]?.clienteId ?? null);
      })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se ha podido calcular.'); });
    return () => { vivo = false; };
    // db.premios cambia al anunciar: no se recalcula la lista por eso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierta, mes]);

  const candidato = candidatos?.find((c) => c.clienteId === elegido) ?? null;
  const cliente = db.clientes.find((c) => c.id === elegido) ?? null;
  useEffect(() => {
    if (!cliente || !candidato) return;
    const t = avisoGanador(cliente.nombre, mes, candidato.clases);
    setTitulo(t.titulo); setCuerpo(t.cuerpo);
  }, [cliente, candidato, mes]);

  const anunciar = async () => {
    if (!cliente || !candidato) return toast.error('Elige a un alumno de la lista.');
    if (avisar && !titulo.trim()) return toast.error('El aviso necesita un título.');
    setGuardando(true);
    const r = await ejecutar('anunciarClienteDelMes', {
      mes, clienteId: cliente.id, clases: candidato.clases, motivo: motivoCandidato(candidato),
      aviso: avisar ? { titulo: titulo.trim(), cuerpo: cuerpo.trim() } : null,
    });
    setGuardando(false);
    if (!r.ok) return toast.error(r.error);
    toast.ok(avisar
      ? `¡Anunciado! ${cliente.nombre} recibirá el aviso en su móvil y una sorpresa al abrir la app.`
      : `¡Anunciado! ${cliente.nombre} verá la sorpresa al abrir la app.`);
    onCerrar();
  };

  const lista = candidatos ? (verTodos ? candidatos : candidatos.slice(0, 8)) : [];
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Cliente del mes">
      <div className="space-y-5">
        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Mes</span>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {meses.map((m) => (
              <button key={m} type="button" onClick={() => setMes(m)}
                className={cn('shrink-0 h-10 px-4 rounded-full border text-[15px] tap', m === mes ? 'bg-ink text-sand border-ink' : 'bg-white border-beige-300 text-ink')}>
                {may(nombreMes(m))}{m.slice(0, 4) !== hoy.slice(0, 4) ? ` ${m.slice(0, 4)}` : ''}
                {db.premios.some((p) => p.mes === m) && ' 🏆'}
              </button>
            ))}
          </div>
        </div>

        {premio && (
          <div className="rounded-2xl bg-beige-50 border border-beige-200 p-4">
            <p className="font-semibold">🏆 Ganador de {nombreMes(mes, true)}: {nombreCompleto(db, premio.clienteId)}</p>
            <p className="text-sm text-ink-soft mt-1">{premio.motivo}{premio.motivo ? '. ' : ''}{textoPublico(premio)}</p>
            <p className="text-sm text-ink-muted mt-2">Si eliges a otra persona y pulsas "Anunciar", se cambia el ganador de este mes.</p>
            <Boton tamano="sm" variante="peligro" className="mt-3" onClick={() => setQuitar(true)}>Quitar el premio</Boton>
          </div>
        )}

        <div>
          <p className="text-[15px] font-semibold">Los más constantes de {nombreMes(mes, true)}</p>
          <p className="text-sm text-ink-muted mb-3">Primero quien cumplió el reto (las clases de su tarifa × 4), luego quien vino más semanas distintas y quien más clases hizo. Quien ganó en los últimos 3 meses va al final. La decisión es vuestra.</p>
          {error && <p className="text-rose">{error}</p>}
          {!error && candidatos === null && <p className="text-ink-muted">Calculando…</p>}
          {candidatos?.length === 0 && <p className="text-ink-muted">Nadie ha hecho clases ese mes.</p>}
          <ul className="space-y-2" role="radiogroup" aria-label="Candidatos">
            {lista.map((c, i) => (
              <li key={c.clienteId}>
                <button type="button" role="radio" aria-checked={elegido === c.clienteId} onClick={() => setElegido(c.clienteId)}
                  className={cn('w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left tap', elegido === c.clienteId ? 'border-ink bg-beige-50' : 'border-beige-200 bg-white')}>
                  <span className={cn('h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0', i === 0 && !c.ganoEn ? 'bg-[#F1DFB5] text-[#7A5A1E]' : 'bg-beige-100 text-ink-soft')}>{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold leading-tight">{nombreCompleto(db, c.clienteId)}</span>
                    <span className="block text-sm text-ink-muted">{motivoCandidato(c)}{c.ganoEn ? ` · ya ganó en ${nombreMes(c.ganoEn)}` : ''}</span>
                  </span>
                  {c.retoCumplido && <Chip tono="ambar">Reto ✓</Chip>}
                </button>
              </li>
            ))}
          </ul>
          {candidatos && candidatos.length > 8 && !verTodos && <Boton variante="fantasma" tamano="sm" className="mt-2" onClick={() => setVerTodos(true)}>Ver los {candidatos.length}</Boton>}
        </div>

        {cliente && candidato && (
          <div className="space-y-3">
            <Interruptor activo={avisar} onCambio={setAvisar} etiqueta="Enviarle un aviso al móvil" descripcion="Le llega como notificación (si las tiene activadas) y queda en sus Avisos." />
            {avisar && (
              <>
                <Entrada etiqueta="Título del aviso" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} />
                <AreaTexto etiqueta="Mensaje" value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} rows={4} />
              </>
            )}
            <p className="text-sm text-ink-muted">Además, al abrir la app verá una celebración con confeti y podrá decidir si los demás alumnos lo ven. El equipo lo verá en el calendario durante todo el mes.</p>
            <Boton ancho onClick={() => void anunciar()} cargando={guardando}><Trophy className="h-5 w-5" /> Anunciar a {cliente.nombre}</Boton>
          </div>
        )}
      </div>
      <Confirmacion abierta={quitar} onCerrar={() => setQuitar(false)} titulo="¿Quitar el premio?" peligro textoConfirmar="Quitar"
        onConfirmar={async () => {
          setQuitar(false);
          const r = await ejecutar('quitarClienteDelMes', { mes });
          if (r.ok) toast.ok('Premio quitado.'); else toast.error(r.error);
        }}>
        Se quita el premio de {nombreMes(mes, true)}. El aviso que ya recibió no se borra (puedes borrarlo en Avisos).
      </Confirmacion>
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Aviso en el calendario (todo el equipo) y propuesta al administrador
// ---------------------------------------------------------------------------

/** Últimos días del mes en que se recuerda al administrador que elija. */
const DIAS_RECORDATORIO = 15;

export function BannerClienteDelMes() {
  const { db, esAdmin } = useTrabajador();
  const [abierta, setAbierta] = useState(false);
  const hoy = hoyISO();
  if (db.config.clienteDelMesActivo === false) return null;
  const premio = premioVigente(db.premios, hoy);
  const mes = mesAnterior(hoy);
  if (premio) {
    const c = db.clientes.find((x) => x.id === premio.clienteId);
    return (
      <>
        <button type="button" onClick={esAdmin ? () => setAbierta(true) : undefined} disabled={!esAdmin}
          className="mb-4 w-full flex items-center gap-3 rounded-2xl bg-[#FBF3DF] border border-[#E6CF98] px-4 py-3 text-left disabled:cursor-default">
          <span className="text-2xl" aria-hidden>🏆</span>
          <span className="text-ink-soft">Cliente del mes de {nombreMes(mes)}: <strong className="text-ink">{c ? `${c.nombre} ${c.apellidos.split(' ')[0] ?? ''}`.trim() : '—'}</strong>{premio.clases ? ` (${premio.clases} clases)` : ''}. ¡Dadle la enhorabuena en clase!</span>
        </button>
        {esAdmin && <HojaClienteDelMes abierta={abierta} onCerrar={() => setAbierta(false)} mesInicial={mes} />}
      </>
    );
  }
  if (!esAdmin || Number(hoy.slice(8, 10)) > DIAS_RECORDATORIO) return null;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-[#FBF3DF] border border-[#E6CF98] px-4 py-3">
        <span className="text-2xl" aria-hidden>🏆</span>
        <span className="flex-1 min-w-[12rem] text-ink-soft">Toca elegir al <strong className="text-ink">cliente del mes de {nombreMes(mes)}</strong>. La app ya tiene una propuesta.</span>
        <Boton tamano="sm" onClick={() => setAbierta(true)}>Ver propuesta</Boton>
      </div>
      <HojaClienteDelMes abierta={abierta} onCerrar={() => setAbierta(false)} mesInicial={mes} />
    </>
  );
}

/** Ganador vigente (para el trofeo al pasar lista). */
export function useGanadorVigente(): Id | null {
  const { db } = useTrabajador();
  if (db.config.clienteDelMesActivo === false) return null;
  return premioVigente(db.premios, hoyISO())?.clienteId ?? null;
}

/** Meses en los que ganó un cliente ("septiembre de 2026, junio de 2026"). */
export function premiosDe(db: Db, clienteId: Id): string {
  return db.premios.filter((p) => p.clienteId === clienteId).map((p) => nombreMes(p.mes, true)).join(', ');
}
