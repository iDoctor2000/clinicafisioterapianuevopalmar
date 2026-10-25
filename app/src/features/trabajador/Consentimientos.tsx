/**
 * Consentimiento de privacidad visto desde el personal:
 *   - estado de cada alumno (aceptado en la app, firmado en papel, pendiente) y recuentos;
 *   - "Ver lo que aceptó": el texto exacto de la versión que aceptó (docs/privacidad/versiones)
 *     o, si firmó en papel, la hoja de recepción y la foto del papel firmado (0025);
 *   - registrar un consentimiento en papel, con foto opcional de la hoja;
 *   - recordatorio a los pendientes que ya usan la app.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, Camera, FileText, Image as ImagenIcono, PenLine, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { Cliente, RegistroAuditoria } from '@/domain/types';
import { CONSENTIMIENTO_PAPEL, VERSION_POLITICA_PRIVACIDAD } from '@/domain/privacidad';
import { useModo } from '@/data/store';
import type { Db } from '@/data/db';
import { nombreCompleto } from '@/data/selectores';
import { subirAdjuntoConsentimiento, urlAdjuntoConsentimiento } from '@/data/supabase/consentimientos';
import { blobADataUrl, ErrorImagen, reducirAncho } from '@/lib/imagen';
import { bloquesDeVersion, lineasConsentimientoDe, lineasPapelDe, Lineas, VistaBloques } from '@/app/Privacidad';
import { Boton, Chip, Hoja, Tarjeta, toast } from '@/ui';
import { useTrabajador } from './useTrabajador';
import { Seccion, fechaMedia, instanteCorto } from './comunes';

export type EstadoConsentimiento = 'APP' | 'PAPEL' | 'PENDIENTE';

export function estadoConsentimiento(c: Pick<Cliente, 'consentimientoEl' | 'consentimientoVersion'>): EstadoConsentimiento {
  if (!c.consentimientoEl) return 'PENDIENTE';
  return c.consentimientoVersion === CONSENTIMIENTO_PAPEL ? 'PAPEL' : 'APP';
}

export const ESTADO_CONSENTIMIENTO_LABEL: Record<EstadoConsentimiento, string> = { APP: 'Aceptado en la app', PAPEL: 'Firmado en papel', PENDIENTE: 'Pendiente' };

/** Recuentos para el panel: solo alumnos activos (los de baja no tienen que firmar nada). */
export function resumenConsentimientos(db: Pick<Db, 'clientes'>): { app: number; papel: number; papelConFoto: number; pendientes: number; pendientesConApp: number } {
  const activos = db.clientes.filter((c) => c.activo);
  const estado = (e: EstadoConsentimiento) => activos.filter((c) => estadoConsentimiento(c) === e);
  return {
    app: estado('APP').length,
    papel: estado('PAPEL').length,
    papelConFoto: estado('PAPEL').filter((c) => !!c.consentimientoAdjunto).length,
    pendientes: estado('PENDIENTE').length,
    pendientesConApp: estado('PENDIENTE').filter((c) => !!c.userId).length,
  };
}

/** Quién registró el consentimiento (última anotación de auditoría del cliente), si la auditoría está disponible. */
function registradoPor(auditoria: RegistroAuditoria[], clienteId: string): RegistroAuditoria | null {
  return auditoria
    .filter((a) => a.entidad === 'cliente' && a.entidadId === clienteId && (a.accion === 'CONSENTIMIENTO' || a.accion === 'CONSENTIMIENTO_PAPEL'))
    .sort((a, b) => b.instante.localeCompare(a.instante))[0] ?? null;
}

/** URL para `<img>` de la foto del papel (data URL en demo; firmada en Supabase). */
function useUrlAdjunto(ruta: string | null | undefined): string | null {
  const modo = useModo();
  const [url, setUrl] = useState<{ ruta: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!ruta) return;
    if (modo === 'DEMO' || /^(data:|blob:|https?:)/i.test(ruta)) { setUrl({ ruta, url: ruta }); return; }
    let vivo = true;
    void urlAdjuntoConsentimiento(ruta).then((u) => { if (vivo) setUrl({ ruta, url: u }); });
    return () => { vivo = false; };
  }, [modo, ruta]);
  if (!ruta) return null;
  return url && url.ruta === ruta ? url.url : null;
}

// ---------------------------------------------------------------------------
// Chip de estado (lista y ficha)
// ---------------------------------------------------------------------------

export function ChipConsentimiento({ cliente, onClick }: { cliente: Cliente; onClick?: () => void }) {
  const estado = estadoConsentimiento(cliente);
  const chip = estado === 'PENDIENTE'
    ? <Chip tono="ambar"><AlertTriangle className="h-3.5 w-3.5" /> Consentimiento pendiente</Chip>
    : <Chip tono="beige"><ShieldCheck className="h-3.5 w-3.5" /> Consentimiento {estado === 'PAPEL' ? 'en papel' : 'aceptado'} el {instanteCorto(cliente.consentimientoEl!)}</Chip>;
  if (!onClick) return chip;
  return <button type="button" onClick={onClick} className="tap rounded-full" aria-label="Ver el consentimiento">{chip}</button>;
}

// ---------------------------------------------------------------------------
// Hoja: lo que aceptó (texto de su versión, foto del papel)
// ---------------------------------------------------------------------------

export function HojaConsentimiento({ cliente, abierta, onCerrar, onRegistrarPapel }: { cliente: Cliente; abierta: boolean; onCerrar: () => void; onRegistrarPapel?: () => void }) {
  const { db, puede, ejecutar } = useTrabajador();
  const modo = useModo();
  const estado = estadoConsentimiento(cliente);
  const version = estado === 'APP' ? cliente.consentimientoVersion ?? VERSION_POLITICA_PRIVACIDAD : VERSION_POLITICA_PRIVACIDAD;
  const bloques = bloquesDeVersion(version);
  const registro = registradoPor(db.auditoria, cliente.id);
  const urlFoto = useUrlAdjunto(cliente.consentimientoAdjunto);
  const [completa, setCompleta] = useState(false);
  const [foto, setFoto] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const editable = puede('CLIENTES_EDITAR');

  const quitarFoto = async () => {
    setQuitando(true);
    const r = await ejecutar('adjuntarConsentimiento', { clienteId: cliente.id, adjunto: null });
    setQuitando(false);
    if (r.ok) toast.ok('Foto del papel quitada.'); else toast.error(r.error);
  };

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Protección de datos" className="sm:max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <ChipConsentimiento cliente={cliente} />
          {estado === 'APP' && <Chip tono="gris">Política del {fechaMedia(version)}</Chip>}
          {estado === 'PAPEL' && (cliente.consentimientoAdjunto ? <Chip tono="gris"><ImagenIcono className="h-3.5 w-3.5" /> Con foto del papel</Chip> : <Chip tono="gris">Sin foto del papel</Chip>)}
        </div>
        <p className="text-sm text-ink-soft">
          <strong className="text-ink">{nombreCompleto(cliente)}</strong>
          {estado === 'PENDIENTE' && ' todavía no ha aceptado la política de privacidad. La app se la pide al entrar; si la firma en recepción, regístrala aquí.'}
          {estado === 'APP' && ` aceptó en la app el ${instanteCorto(cliente.consentimientoEl!)} este texto (versión de la política del ${fechaMedia(version)}):`}
          {estado === 'PAPEL' && ` firmó en recepción la hoja de consentimiento${registro ? `, registrada en la app por ${registro.actorNombre} el ${instanteCorto(registro.instante)}` : ` (registrado el ${instanteCorto(cliente.consentimientoEl!)})`}.`}
        </p>

        {estado !== 'PENDIENTE' && (
          bloques ? (
            <div className="rounded-2xl bg-sand p-4 text-[15px] leading-relaxed text-ink-soft">
              <Lineas lineas={estado === 'PAPEL' ? lineasPapelDe(bloques) : lineasConsentimientoDe(bloques)} />
              {estado === 'PAPEL' && <p className="text-xs text-ink-muted mt-2">Hoja de recepción según la política vigente. Lo que firmó exactamente está en el papel (o en su foto).</p>}
            </div>
          ) : (
            <p className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px]">No tenemos guardado el texto de la versión {version}. Añádelo en docs/privacidad/versiones.</p>
          )
        )}

        {estado === 'PAPEL' && (
          <div className="space-y-2">
            {cliente.consentimientoAdjunto && (
              urlFoto
                ? <a href={urlFoto} target="_blank" rel="noreferrer" className="block"><img src={urlFoto} alt="Hoja de consentimiento firmada" className="w-full max-h-[28rem] object-contain rounded-2xl border border-ink/10 bg-white" /></a>
                : <div className="h-40 rounded-2xl bg-sand animate-pulse" aria-label="Cargando la foto" />
            )}
            {editable && (
              <div className="flex gap-2 flex-wrap">
                <Boton variante="secundario" tamano="sm" onClick={() => setFoto(true)}><Camera className="h-4 w-4" /> {cliente.consentimientoAdjunto ? 'Cambiar la foto del papel' : 'Añadir foto del papel firmado'}</Boton>
                {cliente.consentimientoAdjunto && <Boton variante="fantasma" tamano="sm" cargando={quitando} onClick={() => void quitarFoto()}><Trash2 className="h-4 w-4" /> Quitar la foto</Boton>}
              </div>
            )}
          </div>
        )}

        {estado === 'PENDIENTE' && editable && onRegistrarPapel && (
          <Boton variante="suave" onClick={onRegistrarPapel}><PenLine className="h-5 w-5" /> Registrar consentimiento firmado en papel</Boton>
        )}

        {bloques && estado !== 'PENDIENTE' && (
          <div>
            <button type="button" onClick={() => setCompleta((v) => !v)} className="text-beige-600 font-semibold text-[15px] underline-offset-4 hover:underline tap py-1">
              <FileText className="inline h-4 w-4 mr-1 -mt-0.5" />{completa ? 'Ocultar la política completa' : `Ver la política completa (versión del ${fechaMedia(version)})`}
            </button>
            {completa && <article className="mt-2 rounded-2xl border border-ink/10 bg-white p-4 max-h-[60vh] overflow-y-auto"><VistaBloques bloques={bloques} /></article>}
          </div>
        )}
        {modo === 'DEMO' && estado === 'PAPEL' && <p className="text-xs text-ink-muted">En la demo la foto se guarda en el navegador; en producción, en un almacén privado del servidor.</p>}
      </div>
      {foto && <HojaFotoPapel cliente={cliente} onCerrar={() => setFoto(false)} />}
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Elegir y preparar la foto del papel (cámara o galería → JPEG ≤ 1600 px)
// ---------------------------------------------------------------------------

const ANCHO_PAPEL = 1600;

function useFotoPapel() {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);
  const elegir = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProcesando(true);
    try {
      const b = await reducirAncho(file, ANCHO_PAPEL, 0.82);
      setBlob(b);
      setVista(URL.createObjectURL(b));
    } catch (e) {
      setError(e instanceof ErrorImagen ? e.message : 'No se ha podido procesar la imagen. Prueba con otra.');
    } finally {
      setProcesando(false);
      if (camara.current) camara.current.value = '';
      if (galeria.current) galeria.current.value = '';
    }
  };
  const quitar = () => { setBlob(null); if (vista) URL.revokeObjectURL(vista); setVista(null); };
  const entradas = (
    <>
      {/* `capture="environment"`: cámara trasera, para fotografiar el papel. */}
      <input ref={camara} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void elegir(e.target.files?.[0])} />
      <input ref={galeria} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void elegir(e.target.files?.[0])} />
    </>
  );
  const botones = (
    <div className="grid grid-cols-2 gap-2">
      <Boton variante="secundario" disabled={procesando} onClick={() => camara.current?.click()}><Camera className="h-5 w-5" /> Hacer foto</Boton>
      <Boton variante="secundario" disabled={procesando} onClick={() => galeria.current?.click()}><ImagenIcono className="h-5 w-5" /> De la galería</Boton>
    </div>
  );
  const previa = vista && (
    <div className="relative">
      <img src={vista} alt="Foto elegida" className="w-full max-h-72 object-contain rounded-2xl border border-ink/10 bg-white" />
      <Boton tamano="sm" variante="fantasma" className="absolute top-2 right-2 bg-white/90" onClick={quitar}><Trash2 className="h-4 w-4" /> Quitar</Boton>
    </div>
  );
  return { blob, procesando, error, entradas, botones, previa, quitar };
}

/** Sube (Supabase) o convierte a data URL (demo) y devuelve lo que se guarda en la ficha. */
async function guardarFotoPapel(modo: 'DEMO' | 'SUPABASE', clienteId: string, blob: Blob): Promise<string> {
  return modo === 'SUPABASE' ? subirAdjuntoConsentimiento(clienteId, blob) : blobADataUrl(blob);
}

function HojaFotoPapel({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const { ejecutar } = useTrabajador();
  const modo = useModo();
  const f = useFotoPapel();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    if (!f.blob) return;
    setGuardando(true);
    setError(null);
    try {
      const adjunto = await guardarFotoPapel(modo, cliente.id, f.blob);
      const r = await ejecutar('adjuntarConsentimiento', { clienteId: cliente.id, adjunto });
      if (!r.ok) { setError(r.error); return; }
      toast.ok('Foto del papel guardada.');
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar la foto.');
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Hoja abierta onCerrar={guardando ? () => undefined : onCerrar} titulo="Foto del papel firmado">
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">Haz una foto a la hoja firmada por <strong className="text-ink">{nombreCompleto(cliente)}</strong>. Se guarda junto a su ficha y solo la ve el personal.</p>
        {f.entradas}
        {f.previa ?? f.botones}
        {(f.error || error) && <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px]">{f.error ?? error}</p>}
        <Boton tamano="lg" ancho disabled={!f.blob || f.procesando} cargando={guardando} onClick={() => void guardar()}>Guardar la foto</Boton>
      </div>
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Hoja: registrar un consentimiento firmado en papel (con foto opcional)
// ---------------------------------------------------------------------------

export function HojaRegistrarPapel({ cliente, abierta, onCerrar }: { cliente: Cliente; abierta: boolean; onCerrar: () => void }) {
  const { ejecutar } = useTrabajador();
  const modo = useModo();
  const f = useFotoPapel();
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registrar = async () => {
    setRegistrando(true);
    setError(null);
    try {
      const adjunto = f.blob ? await guardarFotoPapel(modo, cliente.id, f.blob) : null;
      const r = await ejecutar('registrarConsentimientoPapel', { clienteId: cliente.id, adjunto });
      if (!r.ok) { setError(r.error); return; }
      toast.ok(adjunto ? 'Consentimiento registrado, con la foto del papel.' : 'Consentimiento registrado.');
      f.quitar();
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido registrar el consentimiento.');
    } finally {
      setRegistrando(false);
    }
  };
  return (
    <Hoja abierta={abierta} onCerrar={registrando ? () => undefined : onCerrar} titulo="Consentimiento en papel">
      <div className="space-y-3">
        <p className="text-ink-soft">Confirma que <strong className="text-ink">{nombreCompleto(cliente)}</strong> ha firmado en recepción la hoja de consentimiento de la política de privacidad (incluye los datos de salud y, en su caso, la imagen). Se guardará la fecha de hoy y quedará registrado quién lo anota.</p>
        <p className="text-sm text-ink-muted">El texto para imprimir está al final de la <Link to="/privacidad" className="text-beige-600 font-semibold underline underline-offset-4">política de privacidad</Link>.</p>
        <div className="rounded-2xl border border-ink/10 p-3 space-y-2">
          <p className="text-[15px] font-semibold flex items-center gap-2"><Camera className="h-5 w-5 text-ink-muted" /> Foto del papel firmado <span className="text-ink-muted font-normal text-sm">(opcional, recomendable)</span></p>
          {f.entradas}
          {f.previa ?? f.botones}
          {f.error && <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px]">{f.error}</p>}
        </div>
        {error && <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px]">{error}</p>}
        <div className="grid gap-2 pt-1">
          <Boton tamano="lg" ancho cargando={registrando} disabled={f.procesando} onClick={() => void registrar()}><PenLine className="h-5 w-5" /> Sí, registrar el consentimiento</Boton>
          <Boton tamano="lg" ancho variante="secundario" disabled={registrando} onClick={onCerrar}>Cancelar</Boton>
        </div>
      </div>
    </Hoja>
  );
}

// ---------------------------------------------------------------------------
// Panel de administración: recuentos, listado y recordatorio
// ---------------------------------------------------------------------------

export const TITULO_RECORDATORIO_CONSENTIMIENTO = 'Tu consentimiento de privacidad';
export const CUERPO_RECORDATORIO_CONSENTIMIENTO =
  'Para seguir usando la app necesitamos que aceptes la política de privacidad. Te la mostramos al abrir la app: solo tienes que leerla y marcar la casilla. Si prefieres firmarla en papel, pásate por recepción. ¡Gracias!';

export function ProteccionDatos() {
  const { db, puede, ejecutar } = useTrabajador();
  const r = resumenConsentimientos(db);
  const [enviando, setEnviando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const pendientesConApp = db.clientes.filter((c) => c.activo && estadoConsentimiento(c) === 'PENDIENTE' && !!c.userId);

  const recordar = async () => {
    setEnviando(true);
    const res = await ejecutar('publicarAviso', {
      titulo: TITULO_RECORDATORIO_CONSENTIMIENTO, cuerpo: CUERPO_RECORDATORIO_CONSENTIMIENTO,
      destino: { tipo: 'CLIENTES', clienteIds: pendientesConApp.map((c) => c.id) }, importante: true,
    });
    setEnviando(false);
    setConfirmar(false);
    if (res.ok) toast.ok(`Recordatorio enviado a ${pendientesConApp.length === 1 ? '1 alumno' : `${pendientesConApp.length} alumnos`}.`); else toast.error(res.error);
  };

  return (
    <Seccion titulo={<span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-ink-muted" /> Protección de datos</span>}>
      <Tarjeta className="p-4 sm:p-6">
        <div className="grid sm:grid-cols-3 gap-3">
          <Cifra valor={r.app} texto="aceptado en la app" />
          <Cifra valor={r.papel} texto={`firmado en papel${r.papel > 0 ? ` · ${r.papelConFoto} con foto` : ''}`} />
          <Cifra valor={r.pendientes} texto="pendientes" alerta={r.pendientes > 0} />
        </div>
        <p className="text-sm text-ink-muted mt-3">Solo alumnos activos. Quien lo tiene pendiente ve la política al abrir la app y no puede seguir sin aceptarla; si no usa la app, que firme la hoja en recepción.</p>
        <div className="mt-4 flex gap-2 flex-wrap">
          <Link to="/clientes?consentimiento=PENDIENTES"><Boton variante="secundario" tamano="sm"><Users className="h-4 w-4" /> Ver pendientes ({r.pendientes})</Boton></Link>
          <Link to="/clientes?consentimiento=FIRMADOS"><Boton variante="fantasma" tamano="sm"><FileText className="h-4 w-4" /> Ver firmados ({r.app + r.papel})</Boton></Link>
          {puede('AVISOS_ENVIAR') && r.pendientesConApp > 0 && (
            <Boton tamano="sm" onClick={() => setConfirmar(true)}><Bell className="h-4 w-4" /> Recordar a los {r.pendientesConApp} que usan la app</Boton>
          )}
        </div>
        <Hoja abierta={confirmar} onCerrar={() => setConfirmar(false)} titulo="Recordatorio de consentimiento">
          <p className="text-ink-soft">Se publica un aviso importante (y notificación al móvil a quien la tenga activada) para los <strong className="text-ink">{pendientesConApp.length}</strong> alumnos activos con cuenta en la app y consentimiento pendiente.</p>
          <div className="rounded-2xl bg-sand p-3 mt-3 text-[15px]"><p className="font-semibold">{TITULO_RECORDATORIO_CONSENTIMIENTO}</p><p className="text-ink-soft mt-1">{CUERPO_RECORDATORIO_CONSENTIMIENTO}</p></div>
          <div className="grid gap-2 mt-4">
            <Boton tamano="lg" ancho cargando={enviando} onClick={() => void recordar()}><Bell className="h-5 w-5" /> Enviar el recordatorio</Boton>
            <Boton tamano="lg" ancho variante="secundario" onClick={() => setConfirmar(false)}>Cancelar</Boton>
          </div>
        </Hoja>
      </Tarjeta>
    </Seccion>
  );
}

function Cifra({ valor, texto, alerta }: { valor: number; texto: string; alerta?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${alerta ? 'bg-amber-50 border border-amber-200' : 'bg-sand'}`}>
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="text-sm text-ink-muted">{texto}</div>
    </div>
  );
}
