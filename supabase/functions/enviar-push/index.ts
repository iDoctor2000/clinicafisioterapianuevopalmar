/**
 * Edge Function `enviar-push`: envía notificaciones Web Push (VAPID) a los clientes.
 *
 *   POST { avisoId: "<uuid>" }  → a los destinatarios del aviso que tengan `notificaciones_push = true`.
 *                                 Solo trabajadores con AVISOS_ENVIAR o CLASES_CREAR_CANCELAR (ADMIN siempre).
 *   POST { prueba: true }       → solo al cliente autenticado (todas sus suscripciones).
 *
 * Cabecera `Authorization: Bearer <JWT del usuario>` (la pone `supabase.functions.invoke`).
 * Responde `{ enviadas, fallidas, borradas }`. Las suscripciones que el servicio push
 * rechaza con 404/410 (caducadas o canceladas) se borran de `suscripciones_push`.
 *
 * Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
 * SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase automáticamente.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PERMISOS_ENVIO = ['AVISOS_ENVIAR', 'CLASES_CREAR_CANCELAR'];
const MAX_CUERPO = 150;
const RUTA_AVISOS = '#/avisos';

interface FilaSuscripcion {
  id: string;
  cliente_id: string;
  endpoint: string;
  clave_p256dh: string;
  clave_auth: string;
}

interface Carga {
  titulo: string;
  cuerpo: string;
  url: string;
  etiqueta?: string;
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function env(nombre: string): string {
  const v = Deno.env.get(nombre)?.trim();
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

/** Primeras ~150 letras del cuerpo del aviso, cortando por palabra. */
function resumen(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= MAX_CUERPO) return limpio;
  const corte = limpio.slice(0, MAX_CUERPO);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > MAX_CUERPO * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

/** Envía la carga a cada suscripción; devuelve los ids de las suscripciones caducadas (404/410). */
async function enviarATodas(suscripciones: FilaSuscripcion[], carga: Carga): Promise<{ enviadas: number; fallidas: number; caducadas: string[] }> {
  const cuerpo = JSON.stringify(carga);
  const resultados = await Promise.allSettled(
    suscripciones.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.clave_p256dh, auth: s.clave_auth } },
        cuerpo,
        { TTL: 60 * 60 * 24, urgency: 'high' },
      ),
    ),
  );
  let enviadas = 0;
  let fallidas = 0;
  const caducadas: string[] = [];
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      enviadas++;
      return;
    }
    const status = (r.reason as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) caducadas.push(suscripciones[i].id);
    else {
      fallidas++;
      console.warn('[enviar-push] Fallo al enviar:', status, (r.reason as Error)?.message ?? r.reason);
    }
  });
  return { enviadas, fallidas, caducadas };
}

async function borrarCaducadas(admin: SupabaseClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await admin.from('suscripciones_push').delete().in('id', ids);
  if (error) {
    console.warn('[enviar-push] No se han podido borrar suscripciones caducadas:', error.message);
    return 0;
  }
  return ids.length;
}

async function cargarSuscripciones(admin: SupabaseClient, clienteIds: string[]): Promise<FilaSuscripcion[]> {
  if (clienteIds.length === 0) return [];
  const { data, error } = await admin
    .from('suscripciones_push')
    .select('id, cliente_id, endpoint, clave_p256dh, clave_auth')
    .in('cliente_id', clienteIds);
  if (error) throw new Error(`No se han podido leer las suscripciones: ${error.message}`);
  return (data ?? []) as FilaSuscripcion[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Hace falta iniciar sesión.' }, 401);

  let peticion: { avisoId?: unknown; prueba?: unknown };
  try {
    peticion = (await req.json()) as typeof peticion;
  } catch {
    return json({ error: 'Cuerpo de la petición no válido.' }, 400);
  }

  let vapidPublica: string, vapidPrivada: string, vapidSubject: string, supabaseUrl: string, anonKey: string, serviceKey: string;
  try {
    vapidPublica = env('VAPID_PUBLIC_KEY');
    vapidPrivada = env('VAPID_PRIVATE_KEY');
    vapidSubject = env('VAPID_SUBJECT');
    supabaseUrl = env('SUPABASE_URL');
    anonKey = env('SUPABASE_ANON_KEY');
    serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  } catch (e) {
    console.error('[enviar-push]', (e as Error).message);
    return json({ error: 'Las notificaciones push no están configuradas en el servidor.' }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublica, vapidPrivada);

  // Cliente "como el usuario" (anon key + su JWT: pasa por RLS) para identificarlo y comprobar permisos.
  const comoUsuario = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: errorUser } = await comoUsuario.auth.getUser();
  if (errorUser || !user) return json({ error: 'Sesión no válida. Vuelve a entrar.' }, 401);

  // Cliente con la service role key: lee avisos, destinatarios y suscripciones de todos (no pasa por RLS).
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // ── Prueba: solo al cliente autenticado ───────────────────────────────────
    if (peticion.prueba === true) {
      const { data: cliente, error } = await admin.from('clientes').select('id, nombre').eq('user_id', user.id).eq('activo', true).maybeSingle();
      if (error) throw new Error(error.message);
      if (!cliente) return json({ error: 'Tu cuenta no está vinculada a ningún cliente del centro.' }, 403);
      const suscripciones = await cargarSuscripciones(admin, [cliente.id as string]);
      const r = await enviarATodas(suscripciones, {
        titulo: 'Notificación de prueba',
        cuerpo: `Hola, ${cliente.nombre}. Así te avisaremos de las novedades del centro.`,
        url: RUTA_AVISOS,
        etiqueta: 'prueba',
      });
      const borradas = await borrarCaducadas(admin, r.caducadas);
      return json({ enviadas: r.enviadas, fallidas: r.fallidas, borradas });
    }

    // ── Aviso: a sus destinatarios, solo desde el personal con permiso ────────
    const avisoId = typeof peticion.avisoId === 'string' ? peticion.avisoId.trim() : '';
    if (!avisoId) return json({ error: 'Indica avisoId o prueba.' }, 400);

    const { data: trabajador, error: errorTrab } = await admin
      .from('trabajadores')
      .select('id, rol, trabajador_permisos(permiso)')
      .eq('user_id', user.id)
      .eq('activo', true)
      .maybeSingle();
    if (errorTrab) throw new Error(errorTrab.message);
    const permisos = ((trabajador?.trabajador_permisos ?? []) as { permiso: string }[]).map((p) => p.permiso);
    const autorizado = !!trabajador && (trabajador.rol === 'ADMIN' || permisos.some((p) => PERMISOS_ENVIO.includes(p)));
    if (!autorizado) return json({ error: 'No tienes permiso para enviar avisos.' }, 403);

    const { data: aviso, error: errorAviso } = await admin.from('avisos').select('id, titulo, cuerpo').eq('id', avisoId).maybeSingle();
    if (errorAviso) throw new Error(errorAviso.message);
    if (!aviso) return json({ error: 'El aviso no existe.' }, 404);

    const { data: destinatarios, error: errorDest } = await admin.from('aviso_destinatarios').select('cliente_id').eq('aviso_id', avisoId);
    if (errorDest) throw new Error(errorDest.message);
    const idsDestino = (destinatarios ?? []).map((d) => d.cliente_id as string);
    if (idsDestino.length === 0) return json({ enviadas: 0, fallidas: 0, borradas: 0 });

    const { data: clientes, error: errorCli } = await admin
      .from('clientes')
      .select('id')
      .in('id', idsDestino)
      .eq('notificaciones_push', true)
      .eq('activo', true);
    if (errorCli) throw new Error(errorCli.message);
    const suscripciones = await cargarSuscripciones(admin, (clientes ?? []).map((c) => c.id as string));

    const r = await enviarATodas(suscripciones, {
      titulo: String(aviso.titulo ?? 'Aviso del centro'),
      cuerpo: resumen(String(aviso.cuerpo ?? '')),
      url: RUTA_AVISOS,
      etiqueta: `aviso-${avisoId}`,
    });
    const borradas = await borrarCaducadas(admin, r.caducadas);
    return json({ enviadas: r.enviadas, fallidas: r.fallidas, borradas });
  } catch (e) {
    console.error('[enviar-push]', e);
    return json({ error: e instanceof Error ? e.message : 'Error inesperado al enviar las notificaciones.' }, 500);
  }
});
