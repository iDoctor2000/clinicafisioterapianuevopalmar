import { useState, type ReactNode } from 'react';
import { BadgeCheck, Download, LogOut, MoreVertical, Share, ShieldCheck, Smartphone } from 'lucide-react';
import { useStore } from '@/data/store';
import { nombreCompleto } from '@/data/selectores';
import { CATEGORIA_LABEL } from '@/domain/types';
import { Boton, Chip, Entrada, Hoja, Interruptor, Tarjeta, toast } from '@/ui';
import { useCliente } from './useCliente';
import { actividadIncluida, cap, horarioFijoDe, periodoTexto, textoFranja } from './consultas';
import { Encabezado, PuntoActividad, Seccion } from './comun';

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
  const [form, setForm] = useState({ telefono: cliente.telefono, email: cliente.email, direccion: cliente.direccion });
  const [hoja, setHoja] = useState<'INSTALAR' | 'SALIR' | null>(null);
  const cambiado = form.telefono !== cliente.telefono || form.email !== cliente.email || form.direccion !== cliente.direccion;
  const franjas = horarioFijoDe(db, contrato);

  const guardar = async () => {
    const r = await ejecutar('actualizarPreferenciasCliente', { telefono: form.telefono.trim(), email: form.email.trim(), direccion: form.direccion.trim() });
    if (r.ok) toast.ok('Tus datos se han guardado.');
    else toast.error(r.error);
  };

  const cambiarPush = async (activar: boolean) => {
    if (activar && typeof Notification !== 'undefined') {
      try {
        const permiso = await Notification.requestPermission();
        if (permiso === 'granted') toast.ok('Recibirás los avisos del centro en este móvil.');
        else if (permiso === 'denied') toast.error('El navegador tiene bloqueados los avisos. Puedes permitirlos en los ajustes del móvil.');
        else toast.info('No has dado permiso para los avisos. Puedes activarlos más tarde.');
      } catch {
        toast.info('Este navegador no permite avisos en el móvil.');
      }
    } else if (activar) {
      toast.info('Este navegador no permite avisos en el móvil.');
    } else {
      toast.ok('Ya no recibirás avisos en el móvil.');
    }
    const r = await ejecutar('actualizarPreferenciasCliente', { notificacionesPush: activar });
    if (!r.ok) toast.error(r.error);
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
      <Encabezado titulo="Perfil" subtitulo={nombreCompleto(cliente)} />

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
          <p className="text-sm text-ink-muted">Para cambiar tu nombre o DNI, avísanos en recepción.</p>
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Avisos en el móvil">
        <Tarjeta className="px-5 py-1">
          <Interruptor activo={cliente.notificacionesPush} onCambio={cambiarPush} etiqueta="Recibir notificaciones en el móvil" descripcion="Te avisaremos si se cancela una clase o hay novedades." />
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
              <div key={a.id} className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <PuntoActividad color={a.color} />
                  <span className="font-semibold text-lg">{a.nombre}</span>
                  {incluida && <Chip tono="verde"><BadgeCheck className="h-3.5 w-3.5" /> Incluida en tu tarifa</Chip>}
                </div>
                <p className="text-ink-soft text-[15px] mt-1">{a.descripcion}</p>
              </div>
            );
          })}
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Tarifas del centro">
        <Tarjeta className="divide-y divide-ink/5">
          {db.tarifas.filter((t) => t.activa).sort((a, b) => a.orden - b.orden).map((t) => (
            <div key={t.id} className="p-4">
              <p className="font-semibold text-lg flex items-center gap-2 flex-wrap">{t.nombre}{tarifa?.id === t.id && <Chip tono="verde">Tu tarifa</Chip>}</p>
              <p className="text-ink-soft text-[15px]">{t.descripcion}</p>
              <p className="text-sm font-semibold text-brand-700 mt-1">{t.precioCentimos == null ? 'Precio: consultar en recepción' : `Precio: ${(t.precioCentimos / 100).toFixed(2).replace('.', ',')} €`}</p>
            </div>
          ))}
        </Tarjeta>
      </Seccion>

      <Seccion titulo="La app en tu móvil">
        <Tarjeta className="p-5">
          {estaInstalada() ? (
            <p className="flex items-center gap-2 text-brand-700 font-semibold"><Smartphone className="h-5 w-5" /> Ya tienes la app instalada en este dispositivo.</p>
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
        <p className="flex items-center gap-1.5 font-semibold text-ink-soft mb-1"><ShieldCheck className="h-4 w-4" /> Aviso legal y protección de datos</p>
        <p>Tus datos los trata Clínica de Fisioterapia Nuevo Palmar (El Palmar, Murcia) únicamente para gestionar tus reservas, tu tarifa y los avisos del centro, conforme al Reglamento (UE) 2016/679 y la LOPDGDD. No se ceden a terceros. Puedes ejercer tus derechos de acceso, rectificación y supresión en recepción o escribiendo al centro.</p>
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
