/**
 * Más → Avisos en el móvil (equipo, 0026): el trabajador activa las notificaciones en este móvil
 * (cumpleaños de los alumnos por la mañana y lo que venga después) y puede mandarse una prueba.
 * Misma mecánica que el perfil del alumno, pero la suscripción cuelga del trabajador.
 */
import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useModo } from '@/data/store';
import { borrarSuscripcionPush, guardarSuscripcionPushTrabajador, invocarEnvioPush } from '@/data/supabase/push';
import { cancelarSuscripcion, clavePublicaVapid, estadoPermiso, iosSinInstalar, soportaPush, suscribir, suscripcionActual } from '@/lib/push';
import { Boton, Interruptor, Tarjeta, toast } from '@/ui';
import { useTrabajador } from './useTrabajador';

const MENSAJE_PERMISO_DENEGADO = 'El móvil tiene bloqueadas las notificaciones de la app. Actívalas en los ajustes del navegador o del sistema.';
const MENSAJE_SIN_SOPORTE = 'Este navegador no permite notificaciones. En iPhone y iPad, instala la app en la pantalla de inicio.';

export function AvisosMovil() {
  const { sesion } = useTrabajador();
  const modo = useModo();
  const [suscrito, setSuscrito] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    if (modo !== 'SUPABASE') { setSuscrito(false); return; }
    let vivo = true;
    void suscripcionActual().then((s) => { if (vivo) setSuscrito(s !== null); });
    return () => { vivo = false; };
  }, [modo]);

  const cambiar = async (activar: boolean) => {
    if (modo !== 'SUPABASE') { toast.info('En la demo no hay servidor que envíe notificaciones.'); return; }
    if (!activar) {
      setOcupado(true);
      try {
        const endpoint = await cancelarSuscripcion().catch(() => null);
        if (endpoint) await borrarSuscripcionPush(endpoint);
        setSuscrito(false);
        toast.ok('Ya no recibirás avisos en este móvil.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido desactivar.');
      } finally {
        setOcupado(false);
      }
      return;
    }
    if (iosSinInstalar()) { toast.info('En iPhone y iPad, primero instala la app en la pantalla de inicio.'); return; }
    if (!soportaPush()) { toast.error(MENSAJE_SIN_SOPORTE); return; }
    if (estadoPermiso() === 'denied') { toast.error(MENSAJE_PERMISO_DENEGADO); return; }
    if (!clavePublicaVapid()) { toast.error('Las notificaciones aún no están configuradas en el servidor.'); return; }
    setOcupado(true);
    try {
      const s = await suscribir(clavePublicaVapid());
      await guardarSuscripcionPushTrabajador(sesion.trabajadorId, s);
      setSuscrito(true);
      toast.ok('Recibirás en este móvil los cumpleaños de los alumnos cada mañana.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'PERMISO_DENEGADO') toast.error(MENSAJE_PERMISO_DENEGADO);
      else if (msg === 'PERMISO_NO_CONCEDIDO') toast.info('No has dado permiso para los avisos. Puedes activarlos más tarde.');
      else toast.error(msg || 'No se han podido activar las notificaciones en este móvil.');
    } finally {
      setOcupado(false);
    }
  };

  const probar = async () => {
    setProbando(true);
    try {
      const r = await invocarEnvioPush({ prueba: true });
      if (r.enviadas > 0) toast.ok('Enviada. Debería sonar en unos segundos.');
      else if (r.borradas > 0) { setSuscrito(false); toast.error('La suscripción de este móvil ya no es válida. Desactiva y vuelve a activar los avisos.'); }
      else toast.info('No hay ningún móvil suscrito con tu cuenta.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar la prueba.');
    } finally {
      setProbando(false);
    }
  };

  return (
    <Tarjeta className="mb-4 p-4">
      <Interruptor activo={suscrito === true} onCambio={(v) => void cambiar(v)} etiqueta="Avisos en el móvil"
        descripcion={suscrito === null ? 'Comprobando…' : 'Cada mañana, si algún alumno cumple años ese día, para felicitarle en clase. Solo en este móvil.'} />
      {suscrito && modo === 'SUPABASE' && (
        <Boton variante="secundario" tamano="sm" className="mt-3" cargando={probando} disabled={ocupado} onClick={() => void probar()}><BellRing className="h-4 w-4" /> Enviar notificación de prueba</Boton>
      )}
    </Tarjeta>
  );
}
