/**
 * Cobros de un cliente: datos de pago del contrato (oferta, importe, forma de pago), plan de
 * cuotas y registro de cobros. Lo usan la contratación (nueva y editar) y la pestaña Tarifa.
 */
import { useState } from 'react';
import { Check, CircleDollarSign, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Cliente, Contrato, MetodoPago, Oferta, Pago } from '@/domain/types';
import { METODOS_PAGO, METODO_PAGO_LABEL, OFERTA_LABEL } from '@/domain/types';
import { hoyISO } from '@/domain/fechas';
import { aCentimos, aTextoEuros, euros, pagoVencido, type CuotaPlan } from '@/domain/cobros';
import { Boton, Chip, Entrada, Hoja, Interruptor, Seleccion, Tarjeta, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { Confirmacion, Segmentado, fechaMedia } from './comunes';

// ---------------------------------------------------------------------------
// Campos de pago del contrato
// ---------------------------------------------------------------------------

export interface DatosPago {
  oferta: Oferta;
  /** Texto del campo de importe (euros, admite coma). */
  importe: string;
  metodo: MetodoPago | '';
}

export function CamposPago({ datos, onCambio, mensual }: { datos: DatosPago; onCambio: (d: DatosPago) => void; mensual: boolean }) {
  return (
    <div className="space-y-3">
      <div>
        <span className="block text-[15px] font-semibold mb-1.5">Oferta</span>
        <Segmentado className="w-full" valor={datos.oferta} onCambio={(oferta) => onCambio({ ...datos, oferta })}
          opciones={[{ valor: 'NINGUNA', texto: 'Ninguna' }, { valor: 'TRIMESTRAL', texto: 'Trimestral' }, { valor: 'FAMILIAR', texto: 'Familiar' }]} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Entrada etiqueta={mensual ? 'Importe al mes (€)' : 'Importe (€)'} inputMode="decimal" placeholder="Sin indicar" value={datos.importe}
          onChange={(e) => onCambio({ ...datos, importe: e.target.value })} />
        <Seleccion etiqueta="Forma de pago" value={datos.metodo} onChange={(e) => onCambio({ ...datos, metodo: e.target.value as MetodoPago | '' })}>
          <option value="">Sin indicar</option>
          {METODOS_PAGO.map((m) => <option key={m} value={m}>{METODO_PAGO_LABEL[m]}</option>)}
        </Seleccion>
      </div>
    </div>
  );
}

/** "Oferta trimestral · 65 €/mes · Bizum" */
export function textoPago(c: Pick<Contrato, 'oferta' | 'importeCentimos' | 'metodoPago'>, mensual: boolean): string {
  const partes = [OFERTA_LABEL[c.oferta ?? 'NINGUNA']];
  if (c.importeCentimos != null) partes.push(`${euros(c.importeCentimos)}${mensual ? '/mes' : ''}`);
  if (c.metodoPago) partes.push(METODO_PAGO_LABEL[c.metodoPago]);
  return partes.join(' · ');
}

// ---------------------------------------------------------------------------
// Plan de cobros (al crear el contrato)
// ---------------------------------------------------------------------------

export function PlanCobros({ plan, importes, onImporte, primeroCobrado, onPrimeroCobrado }: {
  plan: CuotaPlan[];
  importes: string[];
  onImporte: (i: number, texto: string) => void;
  primeroCobrado: boolean;
  onPrimeroCobrado: (v: boolean) => void;
}) {
  const total = plan.reduce((s, _, i) => s + (aCentimos(importes[i] ?? '') ?? 0), 0);
  return (
    <div>
      <span className="block text-[15px] font-semibold mb-1.5">Plan de cobros <span className="text-ink-muted font-normal">· total {euros(total)}</span></span>
      <ul className="rounded-2xl border border-ink/10 divide-y divide-ink/5">
        {plan.map((q, i) => (
          <li key={q.venceEl + i} className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1 min-w-0"><span className="font-medium block truncate">{q.concepto}</span><span className="text-sm text-ink-muted">Se cobra el {fechaMedia(q.venceEl)}</span></span>
            <input aria-label={`Importe de ${q.concepto}`} inputMode="decimal" value={importes[i] ?? ''} onChange={(e) => onImporte(i, e.target.value)}
              className="w-24 h-11 rounded-xl border border-ink/15 bg-white px-3 text-right font-semibold" />
            <span className="text-ink-muted">€</span>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl border border-ink/10 px-4 mt-2">
        <Interruptor activo={primeroCobrado} onCambio={onPrimeroCobrado} etiqueta="El primer pago se cobra ahora" descripcion="Queda marcado como cobrado hoy, con la forma de pago elegida." />
      </div>
      <p className="text-sm text-ink-muted mt-2">Puedes cambiar cada importe. Los cobros se apuntan después en la ficha, pestaña Tarifa.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registro de cobros (pestaña Tarifa)
// ---------------------------------------------------------------------------

export function TarjetaCobros({ cliente, contrato }: { cliente: Cliente; contrato: Contrato | null }) {
  const { db, puede, ejecutar } = useTrabajador();
  const hoy = hoyISO();
  const [editando, setEditando] = useState<Pago | 'nuevo' | null>(null);
  const pagos = db.pagos
    .filter((p) => p.clienteId === cliente.id && p.estado !== 'CANCELADO')
    .sort((a, b) => (a.venceEl ?? a.creadoEl).localeCompare(b.venceEl ?? b.creadoEl));
  const editable = puede('CLIENTES_EDITAR');
  const cobrado = pagos.filter((p) => p.estado === 'PAGADO').reduce((s, p) => s + p.importeCentimos, 0);
  const pendiente = pagos.filter((p) => p.estado === 'PENDIENTE').reduce((s, p) => s + p.importeCentimos, 0);
  const vencidos = pagos.filter((p) => pagoVencido(p, hoy));

  const cobrar = async (p: Pago) => {
    const metodo = p.metodo ?? contrato?.metodoPago ?? null;
    if (!metodo) { setEditando({ ...p, estado: 'PAGADO' }); return; }
    const r = await ejecutar('guardarPago', { pago: { ...p, estado: 'PAGADO', metodo, pagadoEl: null } });
    if (r.ok) toast.ok(`${p.concepto}: cobrado (${METODO_PAGO_LABEL[metodo]}).`); else toast.error(r.error);
  };
  const deshacer = async (p: Pago) => {
    const r = await ejecutar('guardarPago', { pago: { ...p, estado: 'PENDIENTE', pagadoEl: null } });
    if (r.ok) toast.info(`${p.concepto}: vuelve a pendiente.`); else toast.error(r.error);
  };

  if (pagos.length === 0 && !editable) return null;
  return (
    <Tarjeta>
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold flex-1">Cobros</h3>
        {vencidos.length > 0 && <Chip tono="rojo">{vencidos.length} pendiente{vencidos.length === 1 ? '' : 's'} de cobro</Chip>}
        {editable && <Boton tamano="sm" variante="secundario" onClick={() => setEditando('nuevo')}><Plus className="h-4 w-4" /> Añadir cobro</Boton>}
      </div>
      {pagos.length > 0 && (
        <p className="px-4 pb-2 text-sm text-ink-muted">Cobrado <strong className="text-ink">{euros(cobrado)}</strong> · Pendiente <strong className={pendiente > 0 ? 'text-rose' : 'text-ink'}>{euros(pendiente)}</strong></p>
      )}
      {pagos.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-muted">Todavía no hay cobros apuntados.</p>
      ) : (
        <ul className="divide-y divide-ink/5">
          {pagos.map((p) => {
            const vencido = pagoVencido(p, hoy);
            return (
              <li key={p.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <button type="button" disabled={!editable} onClick={() => setEditando(p)} className={cn('flex-1 min-w-[10rem] text-left', editable && 'tap')}>
                  <span className="font-medium block">{p.concepto || 'Cobro'}</span>
                  <span className="block text-sm text-ink-muted">
                    {p.estado === 'PAGADO'
                      ? `Cobrado ${p.pagadoEl ? fechaMedia(p.pagadoEl.slice(0, 10)) : ''}${p.metodo ? ` · ${METODO_PAGO_LABEL[p.metodo]}` : ''}`
                      : p.venceEl ? `Se cobra el ${fechaMedia(p.venceEl)}` : 'Sin fecha'}
                  </span>
                </button>
                <span className="font-semibold tabular-nums">{euros(p.importeCentimos)}</span>
                {p.estado === 'PAGADO' ? <Chip tono="beige"><Check className="h-3.5 w-3.5" /> Cobrado</Chip> : vencido ? <Chip tono="rojo">Pendiente</Chip> : <Chip tono="gris">Por cobrar</Chip>}
                {editable && (p.estado === 'PAGADO'
                  ? <Boton tamano="sm" variante="fantasma" aria-label={`Deshacer el cobro de ${p.concepto}`} onClick={() => void deshacer(p)}><RotateCcw className="h-4 w-4" /></Boton>
                  : <Boton tamano="sm" onClick={() => void cobrar(p)}><CircleDollarSign className="h-4 w-4" /> Cobrar</Boton>)}
              </li>
            );
          })}
        </ul>
      )}
      {editando && (
        <HojaCobro
          pago={editando === 'nuevo' ? null : editando} cliente={cliente} contrato={contrato}
          onCerrar={() => setEditando(null)}
        />
      )}
    </Tarjeta>
  );
}

function HojaCobro({ pago, cliente, contrato, onCerrar }: { pago: Pago | null; cliente: Cliente; contrato: Contrato | null; onCerrar: () => void }) {
  const { ejecutar } = useTrabajador();
  const hoy = hoyISO();
  const [concepto, setConcepto] = useState(pago?.concepto ?? '');
  const [importe, setImporte] = useState(aTextoEuros(pago?.importeCentimos ?? contrato?.importeCentimos ?? null));
  const [vence, setVence] = useState(pago?.venceEl ?? hoy);
  const [cobrado, setCobrado] = useState(pago ? pago.estado === 'PAGADO' : true);
  const [metodo, setMetodo] = useState<MetodoPago | ''>(pago?.metodo ?? contrato?.metodoPago ?? '');
  const [fechaCobro, setFechaCobro] = useState(pago?.pagadoEl?.slice(0, 10) ?? hoy);
  const [borrar, setBorrar] = useState(false);

  const guardar = async () => {
    const centimos = aCentimos(importe);
    if (centimos == null) return toast.error('Escribe el importe en euros (por ejemplo 45 o 45,50).');
    if (!concepto.trim()) return toast.error('Escribe un concepto (por ejemplo, "Mes 2").');
    if (cobrado && !metodo) return toast.error('Elige la forma de pago.');
    const r = await ejecutar('guardarPago', {
      pago: {
        id: pago?.id, clienteId: cliente.id, contratoId: pago ? pago.contratoId : contrato?.id ?? null, concepto, importeCentimos: centimos,
        venceEl: vence || null, estado: cobrado ? 'PAGADO' : 'PENDIENTE', metodo: metodo || null,
        pagadoEl: cobrado ? `${fechaCobro}T12:00:00.000Z` : null,
      },
    });
    if (r.ok) { toast.ok(cobrado ? 'Cobro apuntado.' : 'Cobro guardado como pendiente.'); onCerrar(); } else toast.error(r.error);
  };
  const confirmarBorrar = async () => {
    if (!pago) return;
    const r = await ejecutar('borrarPago', { id: pago.id });
    if (r.ok) { toast.ok('Cobro borrado.'); onCerrar(); } else toast.error(r.error);
  };

  return (
    <>
    <Hoja abierta onCerrar={onCerrar} titulo={pago ? 'Cobro' : 'Añadir cobro'}>
      <div className="space-y-4">
        <Entrada etiqueta="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Mes 2 · noviembre 2026" />
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Importe (€)" inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="45" />
          <Entrada etiqueta="Se cobra el" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </div>
        <div className="rounded-2xl border border-ink/10 px-4">
          <Interruptor activo={cobrado} onCambio={setCobrado} etiqueta="Cobrado" descripcion={cobrado ? 'Ya está pagado.' : 'Pendiente: si pasa la fecha sin cobrarse, la ficha avisa de "Pago pendiente".'} />
        </div>
        {cobrado && (
          <div className="grid grid-cols-2 gap-3">
            <Seleccion etiqueta="Forma de pago" value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoPago | '')}>
              <option value="">Elige…</option>
              {METODOS_PAGO.map((m) => <option key={m} value={m}>{METODO_PAGO_LABEL[m]}</option>)}
            </Seleccion>
            <Entrada etiqueta="Fecha de cobro" type="date" value={fechaCobro} onChange={(e) => setFechaCobro(e.target.value)} />
          </div>
        )}
        <Boton ancho onClick={() => void guardar()}>Guardar</Boton>
        {pago && <Boton ancho variante="peligro" onClick={() => setBorrar(true)}><Trash2 className="h-5 w-5" /> Borrar este cobro</Boton>}
      </div>
    </Hoja>
      <Confirmacion abierta={borrar} onCerrar={() => setBorrar(false)} titulo="Borrar cobro" textoConfirmar="Borrar" peligro onConfirmar={() => void confirmarBorrar()}>
        <p>Se borra <strong className="text-ink">{pago?.concepto}</strong> ({euros(pago?.importeCentimos)}). Si solo te equivocaste al marcarlo como cobrado, mejor usa la flecha de deshacer.</p>
      </Confirmacion>
    </>
  );
}
