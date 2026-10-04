import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, Camera, Download, LogOut, MoreVertical, Share, ShieldCheck, Smartphone } from 'lucide-react';
import { useModo, useStore } from '@/data/store';
import { nombreCompleto } from '@/data/selectores';
import { borrarSuscripcionPush, guardarSuscripcionPush, invocarEnvioPush } from '@/data/supabase/push';
import { cancelarSuscripcion, clavePublicaVapid, estadoPermiso, iosSinInstalar, soportaPush, suscribir, suscripcionActual } from '@/lib/push';
import { CATEGORIA_LABEL } from '@/domain/types';
import { Boton, Chip, Entrada, Hoja, Interruptor, Tarjeta, toast } from '@/ui';
import { useCliente } from './useCliente';
import { actividadIncluida, cap, horarioFijoDe, periodoTexto, textoFranja } from './consultas';
import { Encabezado, PuntoActividad, Seccion } from './comun';
import { AvatarCliente } from '@/features/comun/AvatarCliente';
import { SelectorFoto } from '@/features/comun/SelectorFoto';
import { EnlacePrivacidad } from '@/app/Privacidad';
import { format } from 'date-fns';
import { FichaActividad } from '@/features/comun/FichaActividad';

type EventoInstalacion = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** Capturamos el evento de instalación de la PWA en cuanto el navegador lo emite. */
let promptInstalacion: EventoInstalacion | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstalacion = e as EventoInstalacion;
  });
}

function estaInstalada(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function Perfil() {
  const { db, cliente, contrato, tarifa } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const cerrarSesion = useStore((s) => s.cerrarSesion);
  const modo = useModo();
  /** Solo SUPABASE: este navegador tiene una suscripción push activa (null = aún no comprobado). */
  const [suscrito, setSuscrito] = useState<boolean | null>(null);
  const [ocupadoPush, setOcupadoPush] = useState(false);
  const [form, setForm] = useState({ telefono: cliente.telefono, email: cliente.email, direccion: cliente.direccion });
  const [hoja, setHoja] = useState<'INSTALAR' | 'SALIR' | 'FOTO' | null>(null);
  const cambiado = form.telefono !== cliente.telefono || form.email !== cliente.email || form.direccion !== cliente.direccion;
  const franjas = horarioFijoDe(db, contrato);

  const guardar = async () => {
    const r = await ejecutar('actualizarPreferenciasCliente', { telefono: form.telefono.trim(), email: form.email.trim(), direccion: form.direccion.trim() });
    if (r.ok) toast.ok('Tus datos se han guardado.');
    else toast.error(r.error);
  };

  useEffect(() => {
    if (modo !== 'SUPABASE') return;
    let vivo = true;
    void suscripcionActual().then((s) => { if (vivo) setSuscrito(s !== null); });
    return () => { vivo = false; };
  }, [modo]);

  const guardarPreferenciaPush = async (activar: boolean) => {
    const r = await ejecutar('actualizarPreferenciasCliente', { notificacionesPush: activar });
    if (!r.ok) toast.error(r.error);
    return r.ok;
  };

  /** DEMO: no hay servidor que envíe nada; solo pedimos permiso y guardamos la preferencia. */
  const cambiarPushDemo = async (activar: boolean) => {
    if (activar && typeof Notification !== 'undefined') {
      try {
        const permiso = await Notification.requestPermission();
        if (permiso === 'granted') toast.ok('Recibirás los avisos del centro en este móvil.');
        else if (permiso === 'denied') toast.error(MENSAJE_PERMISO_DENEGADO);
        else toast.info('No has dado permiso para los avisos. Puedes activarlos más tarde.');
      } catch {
        toast.info(MENSAJE_SIN_SOPORTE);
      }
    } else if (activar) {
      toast.info(MENSAJE_SIN_SOPORTE);
    } else {
      toast.ok('Ya no recibirás avisos en el móvil.');
    }
    await guardarPreferenciaPush(activar);
  };

  /** SUPABASE: suscripción Web Push real guardada en `suscripciones_push`. */
  const cambiarPushReal = async (activar: boolean) => {
    if (!activar) {
      setOcupadoPush(true);
      try {
        const endpoint = await cancelarSuscripcion().catch(() => null);
        if (endpoint) await borrarSuscripcionPush(endpoint);
        setSuscrito(false);
        if (await guardarPreferenciaPush(false)) toast.ok('Ya no recibirás avisos en el móvil.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido desactivar.');
      } finally {
        setOcupadoPush(false);
      }
      return;
    }
    if (iosSinInstalar()) {
      toast.info('En iPhone y iPad, primero instala la app en la pantalla de inicio.');
      setHoja('INSTALAR');
      return;
    }
    if (!soportaPush()) { toast.error(MENSAJE_SIN_SOPORTE); return; }
    if (estadoPermiso() === 'denied') { toast.error(MENSAJE_PERMISO_DENEGADO); return; }
    if (!clavePublicaVapid()) { toast.error('Las notificaciones aún no están configuradas. Avísanos en recepción.'); return; }
    setOcupadoPush(true);
    try {
      const s = await suscribir(clavePublicaVapid());
      await guardarSuscripcionPush(cliente.id, s);
      setSuscrito(true);
      if (await guardarPreferenciaPush(true)) toast.ok('Recibirás los avisos del centro en este móvil.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'PERMISO_DENEGADO') toast.error(MENSAJE_PERMISO_DENEGADO);
      else if (msg === 'PERMISO_NO_CONCEDIDO') toast.info('No has dado permiso para los avisos. Puedes activarlos más tarde.');
      else toast.error(msg || 'No se han podido activar las notificaciones en este móvil.');
    } finally {
      setOcupadoPush(false);
    }
  };

  const cambiarPush = (activar: boolean) => {
    if (ocupadoPush) return;
    return modo === 'SUPABASE' ? cambiarPushReal(activar) : cambiarPushDemo(activar);
  };

  const enviarPrueba = async () => {
    setOcupadoPush(true);
    try {
      const r = await invocarEnvioPush({ prueba: true });
      if (r.enviadas > 0) toast.ok('Notificación de prueba enviada. Debería llegar en unos segundos.');
      else if (r.borradas > 0) { setSuscrito(false); toast.error('La suscripción de este móvil ya no es válida. Desactiva y vuelve a activar las notificaciones.'); }
      else toast.info('No hay ningún móvil suscrito para recibir la prueba.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar la prueba.');
    } finally {
      setOcupadoPush(false);
    }
  };

  const instalar = async () => {
    if (promptInstalacion) {
      try {
        await promptInstalacion.prompt();
        const { outcome } = await promptInstalacion.userChoice;
        if (outcome === 'accepted') toast.ok('La app se está instalando en tu móvil.');
        promptInstalacion = null;
        return;
      } catch { /* si falla el prompt nativo, mostramos las instrucciones */ }
    }
    setHoja('INSTALAR');
  };

  return (
    <div>
      <Encabezado titulo="Perfil" subtitulo={nombreCompleto(cliente)}>
        <button type="button" onClick={() => setHoja('FOTO')} aria-label={cliente.fotoUrl ? 'Cambiar mi foto' : 'Poner mi foto'} className="relative shrink-0 rounded-full tap mb-1">
          <AvatarCliente cliente={cliente} tamano="lg" />
          <span className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-full bg-white text-beige-600 shadow-card ring-1 ring-ink/10 flex items-center justify-center"><Camera className="h-4 w-4" /></span>
        </button>
      </Encabezado>

      <Seccion titulo="Mis datos">
        <Tarjeta className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Dato etiqueta="Nombre">{nombreCompleto(cliente)}</Dato></div>
            <Dato etiqueta="DNI">{cliente.dni}</Dato>
          </div>
          <Entrada etiqueta="Teléfono" type="tel" inputMode="tel" autoComplete="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
          <Entrada etiqueta="Correo electrónico" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Entrada etiqueta="Dirección" autoComplete="street-address" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          <Boton ancho disabled={!cambiado} onClick={guardar}>Guardar cambios</Boton>
          <Boton ancho variante="suave" onClick={() => setHoja('FOTO')}><Camera className="h-5 w-5" /> {cliente.fotoUrl ? 'Cambiar mi foto' : 'Poner mi foto'}</Boton>
          <p className="text-sm text-ink-muted">Para cambiar tu nombre o DNI, avísanos en recepción.</p>
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Avisos en el móvil">
        <Tarjeta className="px-5 py-1">
          <Interruptor activo={cliente.notificacionesPush} onCambio={cambiarPush} etiqueta="Recibir notificaciones en el móvil" descripcion="Te avisaremos si se cancela una clase o hay novedades." />
          {modo === 'SUPABASE' && <EstadoPush activo={cliente.notificacionesPush} suscrito={suscrito} ocupado={ocupadoPush} onPrueba={enviarPrueba} />}
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Mi tarifa">
        {tarifa && contrato ? (
          <Tarjeta className="p-5">
            <p className="text-lg font-semibold leading-snug">{tarifa.nombre}</p>
            <p className="text-ink-soft mt-1">{tarifa.descripcion}</p>
            <dl className="mt-3 space-y-2">
              <Fila etiqueta="Periodo">{cap(periodoTexto(contrato))}</Fila>
              <Fila etiqueta="Modalidad">{contrato.modalidad === 'FIJO' ? 'Horario fijo' : 'Turno libre'}</Fila>
              {tarifa.tipo === 'BONO' && tarifa.bono && <Fila etiqueta="Sesiones">{contrato.sesionesRestantes ?? 0} de {tarifa.bono.sesiones} disponibles</Fila>}
              {tarifa.tipo === 'RECURRENTE' && tarifa.cupos.map((c) => (
                <Fila key={c.categoria} etiqueta={CATEGORIA_LABEL[c.categoria]}>{c.sesionesSemana} {c.sesionesSemana === 1 ? 'clase' : 'clases'} por semana</Fila>
              ))}
            </dl>
            {franjas.length > 0 && (
              <div className="mt-4">
                <p className="font-semibold mb-1">Tu horario</p>
                <ul className="space-y-1 text-ink-soft">
                  {franjas.map((f) => <li key={f.plantilla.id} className="flex items-center gap-2"><PuntoActividad color={f.actividad.color} />{textoFranja(f)}{f.monitor ? ` (${f.monitor.nombre})` : ''}</li>)}
                </ul>
              </div>
            )}
            {tarifa.recuperacion.permitida && (
              <p className="text-sm text-ink-muted mt-4">Si cancelas con más de {db.config.minutosAntelacionCancelacion} minutos de antelación, podrás recuperar la clase{db.config.recuperacionCaducaConContrato ? ' hasta que termine tu tarifa' : ` en los ${db.config.diasCaducidadRecuperacion} días siguientes`}.</p>
            )}
          </Tarjeta>
        ) : (
          <Tarjeta className="p-5 text-ink-soft">No tienes una tarifa activa. Pregunta en recepción.</Tarjeta>
        )}
      </Seccion>

      <Seccion titulo="Actividades">
        <Tarjeta className="divide-y divide-ink/5">
          {db.actividades.filter((a) => a.activa).map((a) => {
            const incluida = actividadIncluida(tarifa, contrato, a);
            return (
              <FichaActividad key={a.id} actividad={a} incluida={incluida} />
            );
          })}
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Tarifas del centro">
        <Tarjeta className="divide-y divide-ink/5">
          {db.tarifas.filter((t) => t.activa).sort((a, b) => a.orden - b.orden).map((t) => (
            <div key={t.id} className="p-4">
              <p className="font-semibold text-lg flex items-center gap-2 flex-wrap">{t.nombre}{tarifa?.id === t.id && <Chip tono="beige">Tu tarifa</Chip>}</p>
              <p className="text-ink-soft text-[15px]">{t.descripcion}</p>
              <p className="text-sm font-semibold text-beige-600 mt-1">{t.precioCentimos == null ? 'Precio: consultar en recepción' : `Precio: ${(t.precioCentimos / 100).toFixed(2).replace('.', ',')} €`}</p>
            </div>
          ))}
        </Tarjeta>
      </Seccion>

      <Seccion titulo="La app en tu móvil">
        <Tarjeta className="p-5">
          {estaInstalada() ? (
            <p className="flex items-center gap-2 text-beige-600 font-semibold"><Smartphone className="h-5 w-5" /> Ya tienes la app instalada en este dispositivo.</p>
          ) : (
            <>
              <p className="text-ink-soft mb-3">Ponla en la pantalla de inicio para abrirla como cualquier otra app, sin buscarla en el navegador.</p>
              <Boton variante="suave" ancho onClick={instalar}><Download className="h-5 w-5" /> Instalar la app en tu móvil</Boton>
            </>
          )}
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Sesión">
        <Boton variante="secundario" ancho onClick={() => setHoja('SALIR')}><LogOut className="h-5 w-5" /> Cerrar sesión</Boton>
      </Seccion>

      <section className="mb-6 text-sm text-ink-muted leading-relaxed">
        <p className="flex items-center gap-1.5 font-semibold text-ink-soft mb-1"><ShieldCheck className="h-4 w-4" /> Protección de datos</p>
        <p>
          Tus datos los trata Nuevo Palmar Pilates para gestionar tus clases y tu seguridad. Lee la <EnlacePrivacidad>política de privacidad</EnlacePrivacidad> para saber qué datos usamos, con qué fin y cómo ejercer tus derechos.
        </p>
        {cliente.consentimientoEl && (
          <p className="mt-1">Aceptaste la política el {fechaConsentimiento(cliente.consentimientoEl)}{cliente.consentimientoVersion === 'papel' ? ' (firmada en recepción)' : ''}.</p>
        )}
      </section>

      <Hoja abierta={hoja === 'INSTALAR'} onCerrar={() => setHoja(null)} titulo="Instalar la app">
        <p className="text-ink-soft">Sigue estos pasos según tu móvil. Solo hay que hacerlo una vez.</p>
        <div className="mt-4 space-y-4">
          <Tarjeta className="p-4 bg-sand border-0 shadow-none">
            <p className="font-semibold text-lg mb-2">iPhone o iPad (Safari)</p>
            <ol className="space-y-2 list-decimal pl-5">
              <li>Toca el botón <span className="inline-flex items-center gap-1 font-semibold"><Share className="h-4 w-4" /> Compartir</span> en la parte de abajo de la pantalla.</li>
              <li>Baja y elige <span className="font-semibold">"Añadir a pantalla de inicio"</span>.</li>
              <li>Toca <span className="font-semibold">"Añadir"</span>. ¡Listo!</li>
            </ol>
          </Tarjeta>
          <Tarjeta className="p-4 bg-sand border-0 shadow-none">
            <p className="font-semibold text-lg mb-2">Android (Chrome)</p>
            <ol className="space-y-2 list-decimal pl-5">
              <li>Toca el menú <span className="inline-flex items-center gap-1 font-semibold"><MoreVertical className="h-4 w-4" /> (tres puntos)</span> arriba a la derecha.</li>
              <li>Elige <span className="font-semibold">"Instalar aplicación"</span> o <span className="font-semibold">"Añadir a pantalla de inicio"</span>.</li>
              <li>Confirma con <span className="font-semibold">"Instalar"</span>. ¡Listo!</li>
            </ol>
          </Tarjeta>
        </div>
        <Boton ancho tamano="lg" className="mt-5" onClick={() => setHoja(null)}>Entendido</Boton>
      </Hoja>

      <SelectorFoto abierta={hoja === 'FOTO'} onCerrar={() => setHoja(null)} cliente={cliente} propio />

      <Hoja abierta={hoja === 'SALIR'} onCerrar={() => setHoja(null)} titulo="Cerrar sesión">
        <p className="text-ink-soft">Tendrás que volver a identificarte para entrar. ¿Quieres cerrar la sesión?</p>
        <div className="mt-5 grid gap-2">
          <Boton tamano="lg" ancho onClick={() => { setHoja(null); cerrarSesion(); }}>Sí, cerrar sesión</Boton>
          <Boton variante="secundario" tamano="lg" ancho onClick={() => setHoja(null)}>No, seguir aquí</Boton>
        </div>
      </Hoja>
    </div>
  );
}

function fechaConsentimiento(iso: string): string {
  try { return format(new Date(iso), 'dd/MM/yyyy'); } catch { return iso; }
}

const MENSAJE_SIN_SOPORTE = 'Este navegador no permite notificaciones. Prueba con Chrome (Android) o instala la app en la pantalla de inicio (iPhone).';
const MENSAJE_PERMISO_DENEGADO =
  'El navegador tiene bloqueadas las notificaciones de esta app. Para permitirlas: toca el candado o el menú del navegador → Permisos (o Ajustes del sitio) → Notificaciones → Permitir, y vuelve a activar el interruptor.';

/** Estado de la suscripción de este navegador y botón de prueba (solo con suscripción activa). */
function EstadoPush({ activo, suscrito, ocupado, onPrueba }: { activo: boolean; suscrito: boolean | null; ocupado: boolean; onPrueba: () => void }) {
  if (!activo) {
    if (iosSinInstalar()) return <Nota>En iPhone y iPad, las notificaciones solo funcionan con la app instalada en la pantalla de inicio (Compartir → Añadir a pantalla de inicio).</Nota>;
    if (!soportaPush()) return <Nota>{MENSAJE_SIN_SOPORTE}</Nota>;
    if (estadoPermiso() === 'denied') return <Nota>{MENSAJE_PERMISO_DENEGADO}</Nota>;
    return null;
  }
  if (suscrito === false) return <Nota>Este móvil no está suscrito: desactiva y vuelve a activar el interruptor para recibir avisos aquí.</Nota>;
  if (!suscrito) return null;
  return (
    <div className="pb-4 pt-1">
      <Boton variante="suave" ancho cargando={ocupado} onClick={onPrueba}><BellRing className="h-5 w-5" /> Enviar notificación de prueba</Boton>
    </div>
  );
}

function Nota({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-muted pb-3 leading-relaxed">{children}</p>;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-sand px-4 py-3 min-w-0">
      <p className="text-sm text-ink-muted">{etiqueta}</p>
      <p className="font-semibold truncate">{children}</p>
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="inline text-ink-muted">{etiqueta}: </dt>
      <dd className="inline font-semibold">{children}</dd>
    </div>
  );
}
