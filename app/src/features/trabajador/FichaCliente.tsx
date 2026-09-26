import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ClipboardList, FileText, HeartPulse, Mail, Phone, RefreshCcw, Stethoscope, Tag } from 'lucide-react';
import type { Categoria, Cliente } from '@/domain/types';
import { CATEGORIA_LABEL } from '@/domain/types';
import { hoyISO, sumarDias } from '@/domain/fechas';
import { nombreCompleto, recuperacionesDeCliente } from '@/data/selectores';
import { AreaTexto, Boton, Chip, Entrada, Hoja, Tarjeta, Vacio, toast } from '@/ui';
import { useTrabajador } from './useTrabajador';
import { historialAsistencia, resumenCliente } from './consultas';
import { Avatar, BloqueRestringido, Dato, Encabezado, Pestanas, fechaMedia, instanteCorto } from './comunes';
import { FormularioCliente, type DatosCliente } from './Clientes';
import { PestanaReservas, PestanaTarifa } from './FichaTarifaReservas';

type Pestana = 'DATOS' | 'CLINICA' | 'TARIFA' | 'RESERVAS' | 'RECUPERACIONES';

export function FichaCliente() {
  const { id } = useParams();
  const { db, puede } = useTrabajador();
  const cliente = db.clientes.find((c) => c.id === id);
  const [pestana, setPestana] = useState<Pestana>('DATOS');
  if (!cliente) return <Vacio icono={AlertTriangle} titulo="Cliente no encontrado" accion={<Link to="/clientes"><Boton variante="secundario">Volver a clientes</Boton></Link>} />;
  const hoy = hoyISO();
  const r = resumenCliente(db, cliente, hoy);
  const h = historialAsistencia(db, cliente.id);

  return (
    <div>
      <Encabezado atras="/clientes" titulo={nombreCompleto(cliente)}>
        <div className="flex items-start gap-4 mt-3">
          <Avatar nombre={cliente.nombre} apellidos={cliente.apellidos} tamano="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex gap-1.5 flex-wrap">
              {!cliente.activo && <Chip tono="rojo">Baja</Chip>}
              {r.tarifa ? <Chip tono="verde"><Tag className="h-3.5 w-3.5" /> {r.tarifa.nombre}</Chip> : <Chip tono="gris">Sin tarifa activa</Chip>}
              {r.contrato && <Chip tono="gris">{r.contrato.modalidad === 'FIJO' ? 'Horario fijo' : 'Turno libre'}</Chip>}
              {r.tarifa?.tipo === 'BONO' && r.contrato && <Chip tono="cocoa">Bono {r.contrato.sesionesRestantes ?? 0}/{r.tarifa.bono?.sesiones}</Chip>}
              {r.recuperaciones > 0 && <Chip tono="azul">{r.recuperaciones} recup.</Chip>}
            </div>
            <div className="flex gap-x-4 gap-y-1 flex-wrap text-sm text-ink-soft mt-2">
              {cliente.telefono && <a href={`tel:${cliente.telefono.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="h-4 w-4" />{cliente.telefono}</a>}
              {cliente.email && <a href={`mailto:${cliente.email}`} className="inline-flex items-center gap-1 hover:underline truncate"><Mail className="h-4 w-4" />{cliente.email}</a>}
            </div>
            <p className="text-sm text-ink-muted mt-1">
              <span className="font-semibold text-brand-700">{h.asistidas}</span> asistidas · <span className="font-semibold text-rose">{h.faltas}</span> faltas · <span className="font-semibold">{h.canceladas}</span> cancelaciones
              {h.canceladas > 0 && <span> ({h.recuperables} recup., {h.noRecuperables} no recup., {h.porCentro} centro)</span>}
            </p>
          </div>
        </div>
      </Encabezado>

      <Pestanas<Pestana>
        activa={pestana} onCambio={setPestana}
        items={[
          { valor: 'DATOS', texto: 'Datos', icono: <FileText className="h-4 w-4" /> },
          { valor: 'CLINICA', texto: 'Clínica', icono: <Stethoscope className="h-4 w-4" /> },
          { valor: 'TARIFA', texto: 'Tarifa', icono: <Tag className="h-4 w-4" /> },
          { valor: 'RESERVAS', texto: 'Reservas', icono: <ClipboardList className="h-4 w-4" /> },
          { valor: 'RECUPERACIONES', texto: 'Recuperaciones', icono: <RefreshCcw className="h-4 w-4" /> },
        ]}
      />
      <div className="pt-4">
        {pestana === 'DATOS' && <PestanaDatos cliente={cliente} />}
        {pestana === 'CLINICA' && (puede('CLINICA_VER') ? <PestanaClinica cliente={cliente} /> : <BloqueRestringido />)}
        {pestana === 'TARIFA' && <PestanaTarifa cliente={cliente} />}
        {pestana === 'RESERVAS' && <PestanaReservas cliente={cliente} />}
        {pestana === 'RECUPERACIONES' && <PestanaRecuperaciones cliente={cliente} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

function PestanaDatos({ cliente }: { cliente: Cliente }) {
  const { puede, ejecutar } = useTrabajador();
  const [editando, setEditando] = useState(false);
  const guardar = async (d: DatosCliente) => {
    const r = await ejecutar('guardarCliente', { cliente: { ...cliente, ...d } });
    if (r.ok) { toast.ok('Datos guardados.'); setEditando(false); } else toast.error(r.error);
  };
  if (editando) {
    return (
      <Tarjeta className="p-4 sm:p-6 max-w-3xl">
        <FormularioCliente inicial={cliente} onGuardar={guardar} edicion onCancelar={() => setEditando(false)} />
      </Tarjeta>
    );
  }
  return (
    <Tarjeta className="p-4 sm:p-6 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        <Dato etiqueta="Nombre">{cliente.nombre}</Dato>
        <Dato etiqueta="Apellidos">{cliente.apellidos}</Dato>
        <Dato etiqueta="DNI / NIE">{cliente.dni}</Dato>
        <Dato etiqueta="Teléfono">{cliente.telefono}</Dato>
        <Dato etiqueta="Correo electrónico">{cliente.email}</Dato>
        <Dato etiqueta="Dirección">{cliente.direccion}</Dato>
        <Dato etiqueta="Fecha de alta">{fechaMedia(cliente.altaEl)}</Dato>
        <Dato etiqueta="Fecha de baja">{cliente.bajaEl ? fechaMedia(cliente.bajaEl) : ''}</Dato>
        <Dato etiqueta="Notificaciones">{cliente.notificacionesPush ? 'Activadas' : 'Desactivadas'}</Dato>
        <Dato etiqueta="Estado">{cliente.activo ? 'Activo' : 'Baja'}</Dato>
      </div>
      {puede('CLIENTES_EDITAR') && <div className="mt-6 flex justify-end"><Boton variante="secundario" onClick={() => setEditando(true)}>Editar datos</Boton></div>}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Clínica (solo CLINICA_VER)
// ---------------------------------------------------------------------------

function PestanaClinica({ cliente }: { cliente: Cliente }) {
  const { puede, ejecutar } = useTrabajador();
  const [editando, setEditando] = useState(false);
  const [c, setC] = useState(cliente.clinica);
  const guardar = async () => {
    const r = await ejecutar('guardarCliente', { cliente: { ...cliente, clinica: { ...c, actualizadaEl: new Date().toISOString() } } });
    if (r.ok) { toast.ok('Información clínica guardada.'); setEditando(false); } else toast.error(r.error);
  };
  const vacia = !cliente.clinica.lesiones && !cliente.clinica.patologias && !cliente.clinica.observaciones;
  return (
    <Tarjeta className="p-4 sm:p-6 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-ink-muted mb-4"><HeartPulse className="h-4 w-4 text-rose" /> Información confidencial. {cliente.clinica.actualizadaEl ? `Actualizada el ${instanteCorto(cliente.clinica.actualizadaEl)}.` : 'Sin registrar.'}</div>
      {editando ? (
        <div className="space-y-4">
          <AreaTexto etiqueta="Lesiones" value={c.lesiones} onChange={(e) => setC({ ...c, lesiones: e.target.value })} />
          <AreaTexto etiqueta="Patologías" value={c.patologias} onChange={(e) => setC({ ...c, patologias: e.target.value })} />
          <AreaTexto etiqueta="Observaciones para el monitor" value={c.observaciones} onChange={(e) => setC({ ...c, observaciones: e.target.value })} />
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Boton variante="secundario" onClick={() => { setC(cliente.clinica); setEditando(false); }}>Cancelar</Boton>
            <Boton onClick={guardar}>Guardar</Boton>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {vacia && <p className="text-ink-muted">No hay información clínica registrada.</p>}
          <Dato etiqueta="Lesiones"><span className="whitespace-pre-wrap">{cliente.clinica.lesiones}</span></Dato>
          <Dato etiqueta="Patologías"><span className="whitespace-pre-wrap">{cliente.clinica.patologias}</span></Dato>
          <Dato etiqueta="Observaciones para el monitor"><span className="whitespace-pre-wrap">{cliente.clinica.observaciones}</span></Dato>
          {puede('CLIENTES_EDITAR') && <div className="flex justify-end pt-2"><Boton variante="secundario" onClick={() => setEditando(true)}>Editar</Boton></div>}
        </div>
      )}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Recuperaciones
// ---------------------------------------------------------------------------

const ESTADO_REC = { DISPONIBLE: { texto: 'Disponible', tono: 'verde' }, USADA: { texto: 'Usada', tono: 'gris' }, CADUCADA: { texto: 'Caducada', tono: 'rojo' } } as const;
const MOTIVO_REC = { CANCELACION_CLIENTE: 'Cancelación del cliente', CANCELACION_CENTRO: 'Cancelación del centro', AUTORIZACION_MANUAL: 'Autorización excepcional' } as const;

function PestanaRecuperaciones({ cliente }: { cliente: Cliente }) {
  const { db, puede } = useTrabajador();
  const [abierta, setAbierta] = useState(false);
  const recs = recuperacionesDeCliente(db, cliente.id);
  const clases = new Map(db.clases.map((c) => [c.id, c]));
  const reservas = new Map(db.reservas.map((r) => [r.id, r]));
  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-ink-muted">{recs.filter((r) => r.estado === 'DISPONIBLE').length} disponibles de {recs.length}</p>
        {puede('RESERVAS_GESTIONAR') && <Boton tamano="sm" variante="suave" onClick={() => setAbierta(true)}><RefreshCcw className="h-4 w-4" /> Autorizar recuperación excepcional</Boton>}
      </div>
      {recs.length === 0 ? (
        <Vacio icono={RefreshCcw} titulo="Sin recuperaciones" texto="Se generan al cancelar con antelación o cuando el centro cancela una clase." />
      ) : (
        <Tarjeta>
          <ul className="divide-y divide-ink/5">
            {recs.map((r) => {
              const usadaEn = r.usadaEnReservaId ? clases.get(reservas.get(r.usadaEnReservaId)?.claseId ?? '') : null;
              const origen = r.reservaOrigenId ? clases.get(reservas.get(r.reservaOrigenId)?.claseId ?? '') : null;
              return (
                <li key={r.id} className="p-4 flex gap-3 flex-wrap items-start">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="font-semibold">{MOTIVO_REC[r.motivo]}</div>
                    <div className="text-sm text-ink-muted">
                      Válida en {r.categoriasPermitidas.map((c) => CATEGORIA_LABEL[c]).join(' y ')} · caduca el {fechaMedia(r.caducaEl)}
                      {origen && <> · origen: clase del {fechaMedia(origen.fecha)} {origen.horaInicio}</>}
                      {usadaEn && <> · usada el {fechaMedia(usadaEn.fecha)} {usadaEn.horaInicio}</>}
                    </div>
                    {r.nota && <div className="text-sm mt-1 italic text-ink-soft">{r.nota}</div>}
                  </div>
                  <Chip tono={ESTADO_REC[r.estado].tono}>{ESTADO_REC[r.estado].texto}</Chip>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}
      {abierta && <HojaAutorizar cliente={cliente} onCerrar={() => setAbierta(false)} />}
    </div>
  );
}

function HojaAutorizar({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const { db, ejecutar } = useTrabajador();
  const hoy = hoyISO();
  const contrato = resumenCliente(db, cliente, hoy).contrato;
  const [origen, setOrigen] = useState<Categoria>('DIRIGIDA');
  const [permitidas, setPermitidas] = useState<Categoria[]>(['DIRIGIDA']);
  const [caduca, setCaduca] = useState(contrato?.fechaFin && contrato.fechaFin >= hoy ? contrato.fechaFin : sumarDias(hoy, db.config.diasCaducidadRecuperacion));
  const [nota, setNota] = useState('');
  const alternar = (c: Categoria) => setPermitidas((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const guardar = async () => {
    if (caduca < hoy) return toast.error('La fecha de caducidad debe ser futura.');
    const r = await ejecutar('autorizarRecuperacion', { clienteId: cliente.id, categoriaOrigen: origen, categoriasPermitidas: permitidas, caducaEl: caduca, nota: nota.trim() });
    if (r.ok) { toast.ok('Recuperación autorizada.'); onCerrar(); } else toast.error(r.error);
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Autorizar recuperación">
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">Se añade una recuperación excepcional a {nombreCompleto(cliente)} que podrá usar para reservar una clase.</p>
        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Categoría de origen</span>
          <div className="grid grid-cols-2 gap-2">
            {(['DIRIGIDA', 'REFORMER'] as Categoria[]).map((c) => (
              <button key={c} type="button" onClick={() => { setOrigen(c); if (!permitidas.includes(c)) setPermitidas([...permitidas, c]); }} aria-pressed={origen === c} className={`h-12 rounded-2xl border font-semibold tap ${origen === c ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-ink/10'}`}>{CATEGORIA_LABEL[c]}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="block text-[15px] font-semibold mb-1.5">Puede usarse en</span>
          <div className="space-y-2">
            {(['DIRIGIDA', 'REFORMER'] as Categoria[]).map((c) => (
              <label key={c} className="flex items-center gap-3 h-12 px-4 rounded-2xl border border-ink/10 bg-white cursor-pointer">
                <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={permitidas.includes(c)} onChange={() => alternar(c)} disabled={c === origen} />
                <span className="font-medium">{CATEGORIA_LABEL[c]}</span>
              </label>
            ))}
          </div>
        </div>
        <Entrada etiqueta="Caduca el" type="date" value={caduca} min={hoy} onChange={(e) => setCaduca(e.target.value)} />
        <AreaTexto etiqueta="Nota (motivo)" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: compensación por clase de prueba" />
        <Boton ancho onClick={guardar}>Autorizar</Boton>
      </div>
    </Hoja>
  );
}
