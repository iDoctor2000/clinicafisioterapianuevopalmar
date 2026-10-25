/**
 * Trofeos (personal con ESTADISTICAS_VER): cómo va el ranking del mes en curso, la propuesta
 * de cliente del mes anterior (lista el día 1, se confirma con un toque) y el historial de ganadores.
 * La hoja de elegir/anunciar es la de siempre (ClienteDelMes.tsx); aquí solo se ve de un vistazo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Trophy } from 'lucide-react';
import type { Candidato } from '@/domain/clienteDelMes';
import { CRITERIOS_CLIENTE_DEL_MES, inicioMes, mesAnterior, motivoCandidato, nombreMes, ordenarCandidatos } from '@/domain/clienteDelMes';
import { hoyISO } from '@/domain/fechas';
import { actividadDelMes } from '@/data/logros';
import { nombreCompleto } from '@/data/selectores';
import { Boton, Chip, Tarjeta, Vacio } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { HojaClienteDelMes, opcionesCandidatos } from './ClienteDelMes';
import { AvatarCliente, Encabezado, fechaMedia, may } from './comunes';

/** Ranking de un mes, calculado con la actividad del servidor (o de la demo) y los desempates de la instantánea. */
function useRanking(mes: string) {
  const { db } = useTrabajador();
  const [lista, setLista] = useState<Candidato[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opciones = useMemo(() => opcionesCandidatos(db, mes), [db, mes]);
  useEffect(() => {
    let vivo = true;
    setLista(null); setError(null);
    actividadDelMes(mes)
      .then((act) => { if (vivo) setLista(ordenarCandidatos(act, opciones).filter((c) => db.clientes.some((x) => x.id === c.clienteId))); })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se ha podido calcular.'); });
    return () => { vivo = false; };
  }, [mes, opciones, db.clientes]);
  return { lista, error };
}

export function Trofeos() {
  const { db, esAdmin } = useTrabajador();
  const hoy = hoyISO();
  const mesActual = inicioMes(hoy);
  const mesPrevio = mesAnterior(hoy);
  const enCurso = useRanking(mesActual);
  const previo = useRanking(mesPrevio);
  const premioPrevio = db.premios.find((p) => p.mes === mesPrevio) ?? null;
  const [elegir, setElegir] = useState<string | null>(null);
  const historial = [...db.premios].sort((a, b) => b.mes.localeCompare(a.mes));
  const desactivado = db.config.clienteDelMesActivo === false;

  return (
    <div>
      <Encabezado titulo="Trofeos" subtitulo="Quién va ganando este mes, la propuesta del mes pasado y quién ha ganado cada mes." />
      {desactivado && <p className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[15px]">El cliente del mes está desactivado en Ajustes → Sorpresas. Aquí sigue viéndose el ranking, pero los alumnos no ven el reto ni se anuncian premios.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Propuesta del mes anterior */}
        <Tarjeta className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold font-sans flex items-center gap-2"><Trophy className="h-5 w-5 text-[#B8860B]" /> Cliente del mes de {nombreMes(mesPrevio)}</h2>
          {premioPrevio ? (
            <div className="mt-3 rounded-2xl bg-[#FBF3DF] border border-[#E6CF98] p-4">
              <FilaGanador clienteId={premioPrevio.clienteId} texto={`${premioPrevio.motivo || `${premioPrevio.clases} clases`} · anunciado el ${fechaMedia(premioPrevio.anunciadoEl.slice(0, 10))}`} publico={premioPrevio.publico} />
              {esAdmin && <Boton variante="fantasma" tamano="sm" className="mt-3" onClick={() => setElegir(mesPrevio)}>Cambiar o quitar</Boton>}
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-ink-soft">Todavía no se ha anunciado. La app propone, por este orden:</p>
              <Ranking lista={previo.lista} error={previo.error} maximo={5} vacio={`Nadie hizo clases en ${nombreMes(mesPrevio)}.`} />
              {esAdmin && previo.lista && previo.lista.length > 0 && (
                <Boton className="mt-3" onClick={() => setElegir(mesPrevio)}><Trophy className="h-5 w-5" /> Ver la propuesta y anunciar</Boton>
              )}
              {!esAdmin && <p className="text-sm text-ink-muted mt-2">Lo anuncia el administrador.</p>}
            </div>
          )}
          <details className="mt-4 text-sm text-ink-muted">
            <summary className="cursor-pointer font-semibold text-ink-soft">Cómo se ordena la propuesta</summary>
            <ul className="list-disc pl-5 mt-2 space-y-1">{CRITERIOS_CLIENTE_DEL_MES.map((c) => <li key={c}>{c}</li>)}</ul>
          </details>
        </Tarjeta>

        {/* Ranking en vivo */}
        <Tarjeta className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold font-sans">Cómo va {nombreMes(mesActual)}</h2>
          <p className="text-sm text-ink-muted mt-1">Con las clases hechas hasta hoy (hace falta pasar lista). Se decide el día 1 de {nombreMes(siguienteMes(mesActual))}.</p>
          <Ranking lista={enCurso.lista} error={enCurso.error} maximo={10} vacio="Todavía nadie ha hecho clases este mes." />
        </Tarjeta>
      </div>

      {/* Historial */}
      <Tarjeta className="mt-4">
        <h2 className="px-4 pt-4 pb-2 text-lg font-semibold font-sans">Ganadores</h2>
        {historial.length === 0 ? (
          <Vacio icono={Trophy} titulo="Todavía no hay ganadores" texto="El primer cliente del mes se anuncia el día 1 del mes que viene." />
        ) : (
          <ul className="divide-y divide-ink/5">
            {historial.map((p) => (
              <li key={p.mes} className="px-4 py-3 flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm font-semibold">{may(nombreMes(p.mes))} {p.mes.slice(0, 4)}</span>
                <FilaGanador clienteId={p.clienteId} texto={p.motivo || `${p.clases} clases`} publico={p.publico} compacta />
                {esAdmin && <button type="button" onClick={() => setElegir(p.mes)} className="text-sm text-beige-600 font-semibold tap" aria-label={`Cambiar el premio de ${nombreMes(p.mes, true)}`}><ChevronRight className="h-5 w-5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {esAdmin && elegir && <HojaClienteDelMes abierta onCerrar={() => setElegir(null)} mesInicial={elegir} />}
    </div>
  );
}

function siguienteMes(mes: string): string {
  const a = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

function FilaGanador({ clienteId, texto, publico, compacta }: { clienteId: string; texto: string; publico: boolean | null; compacta?: boolean }) {
  const { db } = useTrabajador();
  const c = db.clientes.find((x) => x.id === clienteId);
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      {c && <AvatarCliente cliente={c} />}
      <span className="flex-1 min-w-0">
        <span className={cn('block font-semibold leading-tight', !compacta && 'text-lg')}>{c ? <Link to={`/clientes/${c.id}`} className="hover:underline">{nombreCompleto(c)}</Link> : 'Alumno dado de baja'}</span>
        <span className="block text-sm text-ink-muted">{texto}</span>
      </span>
      {publico === true && <Chip tono="beige">Visible para los alumnos</Chip>}
      {publico === false && <Chip tono="gris">En privado</Chip>}
      {publico === null && <Chip tono="ambar">Sin responder</Chip>}
    </div>
  );
}

function Ranking({ lista, error, maximo, vacio }: { lista: Candidato[] | null; error: string | null; maximo: number; vacio: string }) {
  const { db } = useTrabajador();
  const [todos, setTodos] = useState(false);
  if (error) return <p className="text-rose mt-3">{error}</p>;
  if (lista === null) return <p className="text-ink-muted mt-3">Calculando…</p>;
  if (lista.length === 0) return <p className="text-ink-muted mt-3">{vacio}</p>;
  const visibles = todos ? lista : lista.slice(0, maximo);
  return (
    <div className="mt-3">
      <ol className="space-y-1.5">
        {visibles.map((c, i) => {
          const cliente = db.clientes.find((x) => x.id === c.clienteId);
          return (
            <li key={c.clienteId} className={cn('flex items-center gap-3 rounded-2xl px-3 py-2', i === 0 && !c.ganoEn ? 'bg-[#FBF3DF] border border-[#E6CF98]' : 'bg-sand')}>
              <span className={cn('h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0', i === 0 && !c.ganoEn ? 'bg-[#F1DFB5] text-[#7A5A1E]' : 'bg-beige-100 text-ink-soft')}>{i + 1}</span>
              {cliente && <AvatarCliente cliente={cliente} />}
              <span className="flex-1 min-w-0">
                <span className="block font-semibold leading-tight truncate">{cliente ? nombreCompleto(cliente) : 'Alumno'}</span>
                <span className="block text-sm text-ink-muted">{motivoCandidato(c)}{c.ganoEn ? ` · ya ganó en ${nombreMes(c.ganoEn)}` : ''}</span>
              </span>
              {c.retoCumplido && <Chip tono="ambar">Reto ✓</Chip>}
            </li>
          );
        })}
      </ol>
      {lista.length > maximo && !todos && <Boton variante="fantasma" tamano="sm" className="mt-2" onClick={() => setTodos(true)}>Ver los {lista.length}</Boton>}
    </div>
  );
}
