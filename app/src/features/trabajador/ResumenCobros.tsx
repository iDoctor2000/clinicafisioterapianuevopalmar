/**
 * Cobros del mes (solo quien ve las finanzas): totales, quién ha pagado, quién falta, quién no tiene
 * cobro apuntado y quién lo tiene repetido. Para el resto del equipo esta pantalla no existe (ni en el
 * menú ni por dirección). Solo en pantalla: no se descarga nada.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, CircleDollarSign, Copy, UserX } from 'lucide-react';
import type { Cliente, Pago } from '@/domain/types';
import { METODO_PAGO_LABEL } from '@/domain/types';
import { hoyISO } from '@/domain/fechas';
import { euros } from '@/domain/cobros';
import { inicioMes, mesAnterior, nombreMes } from '@/domain/clienteDelMes';
import { resumenCobrosMes } from '@/domain/resumenCobros';
import { nombreCompleto } from '@/data/selectores';
import { Boton, Chip, Tarjeta } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { Encabezado, fechaMedia, may } from './comunes';

function mesSiguiente(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

type Pestana = 'PENDIENTES' | 'PAGADOS' | 'SIN_COBRO' | 'DUPLICADOS';

export function ResumenCobros() {
  const { db } = useTrabajador();
  const hoy = hoyISO();
  const [mes, setMes] = useState(inicioMes(hoy));
  const r = resumenCobrosMes(db, mes, hoy);
  const [pestana, setPestana] = useState<Pestana>('PENDIENTES');
  const cliente = (id: string) => db.clientes.find((c) => c.id === id);
  const titulo = `${may(nombreMes(mes))} ${mes.slice(0, 4)}`;

  const pestanas: { valor: Pestana; texto: string; n: number; alerta?: boolean }[] = [
    { valor: 'PENDIENTES', texto: 'Pendientes', n: r.pendientes.length, alerta: r.pendientes.some((p) => p.vencido) },
    { valor: 'PAGADOS', texto: 'Han pagado', n: r.pagados.length },
    { valor: 'SIN_COBRO', texto: 'Sin cobro', n: r.sinCobro.length, alerta: r.sinCobro.length > 0 },
    { valor: 'DUPLICADOS', texto: 'Repetidos', n: r.duplicados.length, alerta: r.duplicados.length > 0 },
  ];

  return (
    <div className="max-w-4xl">
      <Encabezado titulo="Cobros" subtitulo="Quién ha pagado y quién falta, mes a mes." />

      <div className="flex items-center gap-2 mb-4">
        <Boton variante="secundario" tamano="sm" aria-label="Mes anterior" onClick={() => setMes(mesAnterior(mes))}><ChevronLeft className="h-5 w-5" /></Boton>
        <span className="flex-1 text-center text-lg font-semibold">{titulo}</span>
        <Boton variante="secundario" tamano="sm" aria-label="Mes siguiente" onClick={() => setMes(mesSiguiente(mes))}><ChevronRight className="h-5 w-5" /></Boton>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <Cifra titulo="Cobrado" valor={euros(r.totales.cobrado)} detalle={`${r.pagados.length} ${r.pagados.length === 1 ? 'cobro' : 'cobros'}`} />
        <Cifra titulo="Pendiente" valor={euros(r.totales.pendiente)} detalle={r.totales.vencido > 0 ? `${euros(r.totales.vencido)} ya vencido` : `${r.pendientes.length} por cobrar`} alerta={r.totales.vencido > 0} />
        <Tarjeta className="p-3 col-span-2 sm:col-span-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-1">Cobrado por forma de pago</div>
          {r.totales.porMetodo.length === 0 ? <p className="text-sm text-ink-muted">Nada cobrado todavía.</p> : (
            <ul className="text-sm space-y-0.5">
              {r.totales.porMetodo.map((m) => <li key={m.metodo ?? '-'} className="flex justify-between gap-2"><span>{m.metodo ? METODO_PAGO_LABEL[m.metodo] : 'Sin indicar'} <span className="text-ink-muted">({m.n})</span></span><strong className="tabular-nums">{euros(m.total)}</strong></li>)}
            </ul>
          )}
        </Tarjeta>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-3" role="tablist">
        {pestanas.map((p) => (
          <button key={p.valor} type="button" role="tab" aria-selected={pestana === p.valor} onClick={() => setPestana(p.valor)}
            className={cn('shrink-0 h-10 px-4 rounded-full border text-[15px] font-semibold tap', pestana === p.valor ? 'bg-ink text-sand border-ink' : 'bg-white border-beige-300 text-ink')}>
            {p.texto} <span className={cn('ml-1', p.alerta && pestana !== p.valor && 'text-rose')}>{p.n}</span>
          </button>
        ))}
      </div>

      <Tarjeta>
        {pestana === 'PENDIENTES' && (
          <Lista vacio={`No hay cobros pendientes en ${nombreMes(mes)}.`}>
            {r.pendientes.map((p) => (
              <FilaCobro key={p.id} pago={p} cliente={cliente(p.clienteId)}
                estado={p.vencido ? <Chip tono="rojo">Vencido</Chip> : <Chip tono="gris">Por cobrar</Chip>}
                detalle={p.venceEl ? `Se cobra el ${fechaMedia(p.venceEl)}` : 'Sin fecha'} />
            ))}
          </Lista>
        )}
        {pestana === 'PAGADOS' && (
          <Lista vacio={`Nadie ha pagado todavía en ${nombreMes(mes)}.`}>
            {r.pagados.map((p) => (
              <FilaCobro key={p.id} pago={p} cliente={cliente(p.clienteId)} estado={<Chip tono="beige">Cobrado</Chip>}
                detalle={`${p.pagadoEl ? fechaMedia(p.pagadoEl.slice(0, 10)) : ''}${p.metodo ? ` · ${METODO_PAGO_LABEL[p.metodo]}` : ''}`} />
            ))}
          </Lista>
        )}
        {pestana === 'SIN_COBRO' && (
          <>
            <p className="px-4 pt-4 text-sm text-ink-muted flex gap-2"><UserX className="h-4 w-4 shrink-0 mt-0.5" /> Alumnos con tarifa mensual en {nombreMes(mes)} que no tienen ningún cobro apuntado ese mes, ni pagado ni pendiente. Revisa si pagaron y no se apuntó.</p>
            <Lista vacio={`Todos los alumnos con tarifa mensual tienen su cobro de ${nombreMes(mes)} apuntado.`}>
              {r.sinCobro.map(({ cliente: c, contrato }) => {
                const tarifa = db.tarifas.find((t) => t.id === contrato.tarifaId);
                return (
                  <li key={c.id}>
                    <Link to={`/clientes/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sand tap">
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold truncate">{nombreCompleto(c)}{!c.activo && <span className="text-rose font-normal"> · de baja</span>}</span>
                        <span className="block text-sm text-ink-muted truncate">{tarifa?.nombre ?? '—'} · {fechaMedia(contrato.fechaInicio)} → {fechaMedia(contrato.fechaFin)}</span>
                      </span>
                      {contrato.importeCentimos != null && <span className="font-semibold tabular-nums">{euros(contrato.importeCentimos)}</span>}
                      <ChevronRight className="h-5 w-5 text-ink-muted shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </Lista>
          </>
        )}
        {pestana === 'DUPLICADOS' && (
          <>
            <p className="px-4 pt-4 text-sm text-ink-muted flex gap-2"><Copy className="h-4 w-4 shrink-0 mt-0.5" /> Alumnos con más de un cobro en {nombreMes(mes)}. Puede ser correcto (por ejemplo, su tarifa y un bono), pero si es el mismo importe repetido, borra el que sobra desde su ficha (Tarifa → Cobros → tocar el cobro → Borrar).</p>
            <Lista vacio={`No hay alumnos con cobros repetidos en ${nombreMes(mes)}.`}>
              {r.duplicados.map(({ cliente: c, pagos }) => (
                <li key={c.id} className="px-4 py-3">
                  <Link to={`/clientes/${c.id}`} className="font-semibold hover:underline">{nombreCompleto(c)}</Link>
                  <span className="text-sm text-ink-muted"> · {pagos.length} cobros · {euros(pagos.reduce((s, p) => s + p.importeCentimos, 0))}</span>
                  <ul className="mt-1.5 space-y-1">
                    {pagos.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 text-sm rounded-xl bg-sand px-3 py-2">
                        <span className="flex-1 min-w-0 truncate">{p.concepto || 'Cobro'} <span className="text-ink-muted">· {p.estado === 'PAGADO' ? `cobrado ${p.pagadoEl ? fechaMedia(p.pagadoEl.slice(0, 10)) : ''}` : `pendiente${p.venceEl ? `, ${fechaMedia(p.venceEl)}` : ''}`}</span></span>
                        <strong className="tabular-nums">{euros(p.importeCentimos)}</strong>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </Lista>
          </>
        )}
      </Tarjeta>
    </div>
  );
}

function Cifra({ titulo, valor, detalle, alerta }: { titulo: string; valor: string; detalle: string; alerta?: boolean }) {
  return (
    <Tarjeta className={cn('p-3', alerta && 'border-rose/40')}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{titulo}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{valor}</div>
      <div className={cn('text-sm', alerta ? 'text-rose font-medium' : 'text-ink-muted')}>{alerta && <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}{detalle}</div>
    </Tarjeta>
  );
}

function Lista({ vacio, children }: { vacio: string; children: React.ReactNode[] }) {
  if (children.length === 0) return <p className="p-4 text-ink-muted flex items-center gap-2"><CircleDollarSign className="h-5 w-5" /> {vacio}</p>;
  return <ul className="divide-y divide-ink/5">{children}</ul>;
}

function FilaCobro({ pago, cliente, estado, detalle }: { pago: Pago; cliente: Cliente | undefined; estado: React.ReactNode; detalle: string }) {
  const contenido = (
    <>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold truncate">{cliente ? nombreCompleto(cliente) : 'Alumno'}</span>
        <span className="block text-sm text-ink-muted truncate">{pago.concepto || 'Cobro'} · {detalle}</span>
      </span>
      <span className="font-semibold tabular-nums">{euros(pago.importeCentimos)}</span>
      {estado}
    </>
  );
  return (
    <li>
      {cliente
        ? <Link to={`/clientes/${cliente.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sand tap">{contenido}</Link>
        : <div className="flex items-center gap-3 px-4 py-3">{contenido}</div>}
    </li>
  );
}
