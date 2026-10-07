/**
 * Recarga de la instantánea cuando cambian los datos en el servidor:
 *  - Supabase Realtime (postgres_changes) sobre las tablas que cambian a diario,
 *    con un "debounce" de 500 ms para agrupar ráfagas de cambios.
 *  - Respaldo: al volver la pestaña a primer plano y cada 5 minutos.
 * Requiere que las tablas estén en la publicación `supabase_realtime`.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { servidor } from './cliente';

export const TABLAS_TIEMPO_REAL = ['reservas', 'clases', 'avisos', 'recuperaciones', 'contratos', 'pagos', 'portada_imagenes', 'premios_mes'] as const;
const DEBOUNCE_MS = 500;
const INTERVALO_MS = 5 * 60 * 1000;

/** Activa la escucha; devuelve la función para detenerla. */
export function activarTiempoReal(recargar: () => void): () => void {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  const programar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      recargar();
    }, DEBOUNCE_MS);
  };

  let canal: RealtimeChannel | null = null;
  try {
    canal = servidor().channel('db');
    for (const table of TABLAS_TIEMPO_REAL) canal.on('postgres_changes', { event: '*', schema: 'public', table }, programar);
    canal.subscribe((estado, err) => {
      if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') console.warn('[supabase] Tiempo real no disponible:', err?.message ?? estado);
    });
  } catch (e) {
    console.warn('[supabase] No se ha podido activar el tiempo real:', e);
  }

  const alVolver = () => {
    if (document.visibilityState === 'visible') programar();
  };
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('online', programar);
  const intervalo = setInterval(programar, INTERVALO_MS);

  return () => {
    if (temporizador) clearTimeout(temporizador);
    document.removeEventListener('visibilitychange', alVolver);
    window.removeEventListener('online', programar);
    clearInterval(intervalo);
    if (canal) void servidor().removeChannel(canal);
  };
}
