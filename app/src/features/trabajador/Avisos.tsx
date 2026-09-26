import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Megaphone, Send, X } from 'lucide-react';
import type { DestinoAviso } from '@/domain/types';
import { fechaCorta, hoyISO } from '@/domain/fechas';
import { resolverDestinatarios } from '@/data/comandos';
import { nombreCompleto } from '@/data/selectores';
import { AreaTexto, Boton, Chip, Entrada, Interruptor, Seleccion, Tarjeta, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useTrabajador } from './useTrabajador';
import { clasesProximas, nombreTrabajador } from './consultas';
import { Avatar, BuscadorClientes, Encabezado, instanteCorto } from './comunes';

type Tipo = DestinoAviso['tipo'];
const TIPOS: { valor: Tipo; texto: string }[] = [
  { valor: 'TODOS', texto: 'Todos los clientes' },
  { valor: 'CLASE', texto: 'Alumnos de una clase' },
  { valor: 'ACTIVIDAD', texto: 'Alumnos de una actividad' },
  { valor: 'CLIENTES', texto: 'Clientes concretos' },
];

export function Avisos() {
  const { db, ejecutar } = useTrabajador();
  const [params, setParams] = useSearchParams();
  const claseParam = params.get('clase');
  const hoy = hoyISO();
  const proximas = clasesProximas(db, hoy, 21);
  const claseInicial = claseParam && db.clases.some((c) => c.id === claseParam) ? claseParam : proximas[0]?.clase.id ?? '';

  const [tipo, setTipo] = useState<Tipo>(claseParam ? 'CLASE' : 'TODOS');
  const [claseId, setClaseId] = useState(claseInicial);
  const [actividadId, setActividadId] = useState(db.actividades[0]?.id ?? '');
  const [clienteIds, setClienteIds] = useState<string[]>([]);
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [importante, setImportante] = useState(false);

  const autor = (id: string) => { const t = db.trabajadores.find((x) => x.userId === id || x.id === id); return t ?? { nombre: nombreTrabajador(db, id), apellidos: '', color: undefined }; };
  const destino: DestinoAviso = tipo === 'TODOS' ? { tipo } : tipo === 'CLASE' ? { tipo, claseId } : tipo === 'ACTIVIDAD' ? { tipo, actividadId } : { tipo, clienteIds };
  const destinatarios = resolverDestinatarios(db, destino);
  const claseSel = db.clases.find((c) => c.id === claseId);
  const claseSelFueraDeLista = claseSel && !proximas.some((v) => v.clase.id === claseId);

  const publicar = () => {
    if (!titulo.trim()) return toast.error('Escribe un título.');
    if (!cuerpo.trim()) return toast.error('Escribe el texto del aviso.');
    if (destinatarios.length === 0) return toast.error('No hay destinatarios.');
    const r = ejecutar('publicarAviso', { titulo: titulo.trim(), cuerpo: cuerpo.trim(), destino, importante });
    if (r.ok) { toast.ok(`Aviso publicado a ${destinatarios.length} cliente${destinatarios.length === 1 ? '' : 's'}.`); setTitulo(''); setCuerpo(''); setImportante(false); setClienteIds([]); if (claseParam) setParams({}); } else toast.error(r.error);
  };

  return (
    <div>
      <Encabezado titulo="Avisos" subtitulo="Comunicaciones a los clientes: aparecen en su app y como notificación." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Tarjeta className="p-4 sm:p-6 space-y-4">
          <h2 className="text-lg font-sans font-semibold flex items-center gap-2"><Megaphone className="h-5 w-5 text-brand-600" /> Nuevo aviso</h2>
          <Entrada etiqueta="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Cambio de horario el viernes" maxLength={120} />
          <AreaTexto etiqueta="Texto" value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} placeholder="Escribe el mensaje…" />
          <div>
            <span className="block text-[15px] font-semibold mb-1.5">Destinatarios</span>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map((t) => <button key={t.valor} type="button" aria-pressed={tipo === t.valor} onClick={() => setTipo(t.valor)} className={cn('h-12 rounded-2xl border font-semibold text-sm tap px-2', tipo === t.valor ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-ink/10 hover:border-brand-300')}>{t.texto}</button>)}
            </div>
          </div>
          {tipo === 'CLASE' && (
            <Seleccion etiqueta="Clase" value={claseId} onChange={(e) => setClaseId(e.target.value)}>
              {claseSelFueraDeLista && claseSel && <option value={claseSel.id}>{fechaCorta(claseSel.fecha)} · {claseSel.horaInicio} · {db.actividades.find((a) => a.id === claseSel.actividadId)?.nombre}</option>}
              {proximas.map((v) => <option key={v.clase.id} value={v.clase.id}>{fechaCorta(v.clase.fecha)} · {v.clase.horaInicio} · {v.actividad.nombre} ({v.ocupadas} alumnos)</option>)}
            </Seleccion>
          )}
          {tipo === 'ACTIVIDAD' && (
            <Seleccion etiqueta="Actividad" ayuda="Clientes con alguna reserva activa en esta actividad" value={actividadId} onChange={(e) => setActividadId(e.target.value)}>
              {db.actividades.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </Seleccion>
          )}
          {tipo === 'CLIENTES' && (
            <div className="space-y-2">
              {clienteIds.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {clienteIds.map((id) => { const c = db.clientes.find((x) => x.id === id); return <Chip key={id} tono="verde" className="pr-1">{nombreCompleto(c)}<button type="button" aria-label="Quitar" onClick={() => setClienteIds(clienteIds.filter((x) => x !== id))} className="h-6 w-6 rounded-full hover:bg-brand-200 flex items-center justify-center"><X className="h-3.5 w-3.5" /></button></Chip>; })}
                </div>
              )}
              <BuscadorClientes clientes={db.clientes.filter((c) => c.activo)} excluirIds={clienteIds} onElegir={(c) => setClienteIds([...clienteIds, c.id])} placeholder="Añadir cliente…" />
            </div>
          )}
          <div className="rounded-2xl border border-ink/10 px-4"><Interruptor activo={importante} onCambio={setImportante} etiqueta="Importante" descripcion="Se destaca en la app y se envía notificación aunque estén desactivadas." /></div>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-sand px-4 py-3">
            <span className="text-sm"><strong className="text-lg">{destinatarios.length}</strong> destinatario{destinatarios.length === 1 ? '' : 's'}</span>
            <Boton onClick={publicar} disabled={destinatarios.length === 0}><Send className="h-5 w-5" /> Publicar</Boton>
          </div>
        </Tarjeta>

        <div>
          <h2 className="text-lg font-sans font-semibold mb-2">Historial</h2>
          {db.avisos.length === 0 ? <Vacio icono={Bell} titulo="Sin avisos" texto="Aquí aparecerán los avisos publicados." /> : (
            <ul className="space-y-2">
              {db.avisos.map((a) => (
                <li key={a.id}>
                  <Tarjeta className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar nombre={autor(a.publicadoPor).nombre} apellidos={autor(a.publicadoPor).apellidos} color={autor(a.publicadoPor).color} tamano="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{a.titulo}</span>{a.importante && <Chip tono="rojo">Importante</Chip>}</div>
                        <p className="text-sm text-ink-soft mt-1 whitespace-pre-wrap">{a.cuerpo}</p>
                        <p className="text-xs text-ink-muted mt-2">{instanteCorto(a.publicadoEl)} · {nombreTrabajador(db, a.publicadoPor)} · {descDestino(a.destino, db)} · {a.destinatariosIds.length} destinatario{a.destinatariosIds.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                  </Tarjeta>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function descDestino(d: DestinoAviso, db: ReturnType<typeof useTrabajador>['db']): string {
  switch (d.tipo) {
    case 'TODOS': return 'Todos';
    case 'CLIENTES': return 'Clientes concretos';
    case 'ACTIVIDAD': return `Actividad: ${db.actividades.find((a) => a.id === d.actividadId)?.nombre ?? '?'}`;
    case 'CLASE': { const c = db.clases.find((x) => x.id === d.claseId); return c ? `Clase ${fechaCorta(c.fecha)} ${c.horaInicio}` : 'Clase'; }
  }
}
