/**
 * Suscripciones Web Push en Supabase (tabla `suscripciones_push`, RLS: cada cliente
 * gestiona las suyas) y llamada a la Edge Function `enviar-push`.
 */
import type { SuscripcionPush } from '@/lib/push';
import { mensajeError, servidor } from './cliente';

/** Guarda (o actualiza, por endpoint) la suscripción de este navegador para el cliente. */
export async function guardarSuscripcionPush(clienteId: string, s: SuscripcionPush): Promise<void> {
  const { error } = await servidor()
    .from('suscripciones_push')
    .upsert(
      { cliente_id: clienteId, endpoint: s.endpoint, clave_p256dh: s.p256dh, clave_auth: s.auth, user_agent: navigator.userAgent.slice(0, 500) },
      { onConflict: 'endpoint' },
    );
  if (error) throw new Error(mensajeError(error));
}

/** Borra la suscripción de este navegador (por endpoint). No falla si ya no existe. */
export async function borrarSuscripcionPush(endpoint: string): Promise<void> {
  const { error } = await servidor().from('suscripciones_push').delete().eq('endpoint', endpoint);
  if (error) throw new Error(mensajeError(error));
}

export interface ResultadoEnvioPush {
  enviadas: number;
  fallidas: number;
  borradas: number;
}

/**
 * Invoca la Edge Function `enviar-push`. Con `{ prueba: true }` envía solo al cliente
 * autenticado; con `{ avisoId }` a los destinatarios del aviso (requiere permiso de trabajador).
 */
export async function invocarEnvioPush(body: { avisoId: string } | { prueba: true }): Promise<ResultadoEnvioPush> {
  const { data, error } = await servidor().functions.invoke<ResultadoEnvioPush>('enviar-push', { body });
  if (error) throw new Error(await mensajeErrorFuncion(error));
  return { enviadas: Number(data?.enviadas ?? 0), fallidas: Number(data?.fallidas ?? 0), borradas: Number(data?.borradas ?? 0) };
}

/** Los errores HTTP de `functions.invoke` traen la respuesta en `context`: leemos el `error` del JSON si lo hay. */
async function mensajeErrorFuncion(e: unknown): Promise<string> {
  const ctx = (e as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const json = (await ctx.clone().json()) as { error?: unknown };
      if (json && typeof json.error === 'string') return json.error;
    } catch { /* sin cuerpo JSON */ }
    if (ctx.status === 404) return 'La función de notificaciones no está desplegada en Supabase.';
  }
  return mensajeError(e);
}
