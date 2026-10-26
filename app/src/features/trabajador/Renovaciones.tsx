/**
 * Renovar de golpe los contratos mensuales que terminan (0028): aviso en el calendario y hoja con la
 * lista (todos marcados; se desmarca a quien no sigue). Renovar alarga el mismo contrato hasta la
 * fecha elegida, le apunta a sus clases fijas y crea el cobro de cada mes nuevo.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { hoyISO } from '@/domain/fechas';
import { cobrosDeRenovacion, contratosParaRenovar, finDelMesSiguiente } from '@/domain/renovaciones';
import { euros } from '@/domain/cobros';
import { nombreCompleto } from '@/data/selectores';
import { Boton, Entrada, Hoja, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { fechaMedia } from './comunes';

/** Quién puede renovar: editar fichas y ámbito de todo el centro. */
function usePuedeRenovar(): boolean {
  const { puede, limitado } = useTrabajador();
  return puede('CLIENTES_EDITAR') && !limitado;
}

/** "77 contratos terminan el 31 de octubre · Renovar" (solo si hay alguno). */
export function BannerRenovaciones() {
  const { db } = useTrabajador();
  const puedeRenovar = usePuedeRenovar();
  const [abierta, setAbierta] = useState(false);
  const hoy = hoyISO();
  const lista = contratosParaRenovar(db, hoy, finDelMesSiguiente(hoy), 7);
  if (!puedeRenovar || lista.length === 0) return null;
  const fines = [...new Set(lista.map((c) => c.fechaFin))].sort();
  const cuando = fines.length === 1 ? `el ${fechaMedia(fines[0])}` : `entre el ${fechaMedia(fines[0])} y el ${fechaMedia(fines[fines.length - 1])}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
        <RefreshCw className="h-5 w-5 text-ink-muted shrink-0" />
        <span className="flex-1 min-w-[12rem] text-ink-soft"><strong className="text-ink">{lista.length} {lista.length === 1 ? 'contrato termina' : 'contratos terminan'}</strong> {cuando}. Si no se renuevan, los de horario fijo se quedan sin sus clases.</span>
        <Boton tamano="sm" onClick={() => setAbierta(true)}>Renovar</Boton>
      </div>
      {abierta && <HojaRenovarContratos onCerrar={() => setAbierta(false)} />}
    </>
  );
}

/** Botón para la lista de clientes. */
export function BotonRenovaciones() {
  const { db } = useTrabajador();
  const puedeRenovar = usePuedeRenovar();
  const [abierta, setAbierta] = useState(false);
  const hoy = hoyISO();
  const n = contratosParaRenovar(db, hoy, finDelMesSiguiente(hoy)).length;
  if (!puedeRenovar || n === 0) return null;
  return (
    <>
      <Boton tamano="sm" variante="secundario" onClick={() => setAbierta(true)}><RefreshCw className="h-4 w-4" /> Renovar contratos ({n})</Boton>
      {abierta && <HojaRenovarContratos onCerrar={() => setAbierta(false)} />}
    </>
  );
}

export function HojaRenovarContratos({ onCerrar }: { onCerrar: () => void }) {
  const { db, ejecutar, veFinanzas } = useTrabajador();
  const hoy = hoyISO();
  const [hasta, setHasta] = useState(finDelMesSiguiente(hoy));
  const lista = useMemo(() => {
    const cliente = (id: string) => db.clientes.find((c) => c.id === id);
    return contratosParaRenovar(db, hoy, hasta)
      .map((c) => ({ contrato: c, cliente: cliente(c.clienteId), tarifa: db.tarifas.find((t) => t.id === c.tarifaId) }))
      .sort((a, b) => (a.cliente ? nombreCompleto(a.cliente) : '').localeCompare(b.cliente ? nombreCompleto(b.cliente) : '', 'es'));
  }, [db, hoy, hasta]);
  // Marcados: todos (los alumnos de baja ya no salen en la lista).
  const [desmarcados, setDesmarcados] = useState<Set<string>>(() => new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [renovando, setRenovando] = useState(false);
  const marcados = lista.filter((x) => !desmarcados.has(x.contrato.id));
  const cobros = marcados.reduce((s, x) => s + cobrosDeRenovacion(x.contrato, hasta, db.pagos).length, 0);
  const alternar = (id: string) => setDesmarcados((d) => { const n = new Set(d); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const hastaValida = hasta > hoy;

  const renovar = async () => {
    setRenovando(true);
    const r = await ejecutar('renovarContratos', { contratoIds: marcados.map((x) => x.contrato.id), hasta });
    setRenovando(false);
    setConfirmar(false);
    if (!r.ok) return toast.error(r.error);
    const v = r.valor;
    toast.ok(`${v.renovados === 1 ? 'Renovado 1 contrato' : `Renovados ${v.renovados} contratos`} hasta el ${fechaMedia(hasta)}.${veFinanzas && v.cobros > 0 ? ` Se han creado ${v.cobros} cobros pendientes.` : ''}${v.saltados > 0 ? ` ${v.saltados} no se han podido renovar (revisa su ficha).` : ''}`);
    onCerrar();
  };

  return (
    <Hoja abierta onCerrar={renovando ? () => undefined : onCerrar} titulo="Renovar contratos" className="sm:max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">Se alarga el contrato de cada alumno marcado hasta la fecha elegida, con su misma tarifa y sus mismas clases fijas, y se le apunta a sus clases. Desmarca a quien no sigue. Los bonos y las clases sueltas no salen aquí: se renuevan desde la ficha.</p>
        <Entrada etiqueta="Renovar hasta" type="date" min={hoy} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        {lista.length === 0 ? (
          <p className="text-ink-muted">No hay contratos mensuales que terminen antes del {fechaMedia(hasta)} en los próximos días.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[15px] font-semibold">{marcados.length} de {lista.length} marcados</span>
              <span className="flex gap-1">
                <Boton variante="fantasma" tamano="sm" onClick={() => setDesmarcados(new Set())}>Todos</Boton>
                <Boton variante="fantasma" tamano="sm" onClick={() => setDesmarcados(new Set(lista.map((x) => x.contrato.id)))}>Ninguno</Boton>
              </span>
            </div>
            <ul className="rounded-2xl border border-ink/10 divide-y divide-ink/5 max-h-[50vh] overflow-y-auto">
              {lista.map(({ contrato, cliente, tarifa }) => {
                const marcado = !desmarcados.has(contrato.id);
                return (
                  <li key={contrato.id}>
                    <label className={cn('flex items-center gap-3 px-3 py-2.5 cursor-pointer', !marcado && 'opacity-60')}>
                      <input type="checkbox" className="h-5 w-5 accent-brand-500 shrink-0" checked={marcado} onChange={() => alternar(contrato.id)} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold truncate">{cliente ? nombreCompleto(cliente) : 'Alumno'}{cliente && !cliente.activo && <span className="text-rose font-normal"> · de baja</span>}</span>
                        <span className="block text-sm text-ink-muted truncate">{tarifa?.nombre ?? '—'} · {contrato.modalidad === 'FIJO' ? 'horario fijo' : 'turno libre'} · termina el {fechaMedia(contrato.fechaFin)}{veFinanzas && contrato.importeCentimos != null ? ` · ${euros(contrato.importeCentimos)}/mes` : ''}</span>
                      </span>
                      {cliente && <Link to={`/clientes/${cliente.id}`} className="text-sm text-beige-600 font-semibold shrink-0" onClick={onCerrar}>Ficha</Link>}
                    </label>
                  </li>
                );
              })}
            </ul>
            <Boton tamano="lg" ancho disabled={marcados.length === 0 || !hastaValida} onClick={() => setConfirmar(true)}><RefreshCw className="h-5 w-5" /> Renovar {marcados.length} {marcados.length === 1 ? 'contrato' : 'contratos'}</Boton>
          </>
        )}
      </div>
      <Hoja abierta={confirmar} onCerrar={renovando ? () => undefined : () => setConfirmar(false)} titulo="¿Renovar?">
        <p className="text-ink-soft">Se alargan <strong className="text-ink">{marcados.length} {marcados.length === 1 ? 'contrato' : 'contratos'}</strong> hasta el <strong className="text-ink">{fechaMedia(hasta)}</strong> y se apunta a cada alumno de horario fijo a sus clases de ese periodo.{veFinanzas ? ` Se crean ${cobros} cobros pendientes con el importe de cada contrato (los que no tienen importe, o ya tienen un cobro ese mes, no).` : ''}</p>
        <p className="text-sm text-ink-muted mt-2">Si alguno no tenía que renovarse, se corrige después en su ficha (Editar contratación o Finalizar contrato).</p>
        <div className="grid gap-2 mt-4">
          <Boton tamano="lg" ancho cargando={renovando} onClick={() => void renovar()}><RefreshCw className="h-5 w-5" /> Sí, renovar</Boton>
          <Boton tamano="lg" ancho variante="secundario" disabled={renovando} onClick={() => setConfirmar(false)}>Cancelar</Boton>
        </div>
      </Hoja>
    </Hoja>
  );
}
