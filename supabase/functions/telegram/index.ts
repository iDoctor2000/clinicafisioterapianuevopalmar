/**
 * Edge Function `telegram`: bot privado de Telegram para el administrador.
 *
 *   /informe       → cómo va la app los últimos 7 días (uso de alumnos y equipo, avisos, pasar lista,
 *                    errores que ha visto la gente y señales de fallo).
 *   /informe 30    → lo mismo con otros días (1 a 90).
 *   /hoy           → el último día.
 *   /errores [N]   → solo los errores.
 *   /ayuda         → la lista de órdenes.
 *
 * Seguridad (Telegram no manda la sesión de Supabase, así que "Verify JWT" va DESACTIVADO):
 *   · Telegram manda en cada mensaje la cabecera X-Telegram-Bot-Api-Secret-Token con el secreto que se
 *     puso al activar el bot (setWebhook ... secret_token=...). Si no coincide con TELEGRAM_SECRETO, no
 *     se contesta nada.
 *   · Solo se contesta con datos a los chats de TELEGRAM_CHATS (números separados por comas). A
 *     cualquier otro se le dice que el bot es privado (y su número de chat, para poder darlo de alta).
 *   · El informe sale de `informe_uso()` (0036), que ya viene sin datos personales (iniciales).
 *
 * La respuesta va en la propia contestación al webhook (método sendMessage), así que no hace falta
 * guardar el token del bot en Supabase.
 *
 * Secrets (Edge Functions → Secrets): TELEGRAM_SECRETO, TELEGRAM_CHATS.
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase automáticamente.
 */

declare const Deno: { env: { get(n: string): string | undefined }; serve(h: (r: Request) => Promise<Response> | Response): void } | undefined;

export interface Informe {
  generado: string;
  dias: number;
  alumnos: { activos: number; con_cuenta: number; uso_dia: number; uso_7: number; uso_30: number; notificaciones: number };
  acciones_alumnos: { accion: string; veces: number; personas: number }[];
  avisos: { avisos: number; entregas: number; leidos: number };
  equipo: { quien: string; rol: string; acciones: number; dias: number; ultimo_uso: string | null }[];
  equipo_sin_cuenta: number;
  acciones_equipo: { accion: string; veces: number }[];
  lista: { clases: number; marcadas: number };
  senales: { push_atascados: number; mantenimientos_7: number; ultima_copia: string | null; clases_canceladas: number; cobros_vencidos: number };
  errores?: { total: number; personas: number; por_quien: Record<string, number>; top: { mensaje: string; tipo: string; veces: number; personas: number; quien: string; ultima: string }[] };
}

const ACCIONES: Record<string, string> = {
  RESERVAR: 'reservas', CANCELAR_RESERVA: 'cancelaciones', LISTA_ESPERA: 'lista de espera', CONSENTIMIENTO: 'consentimientos firmados',
  ASISTENCIA: 'marcas de asistencia', RENOVAR_CONTRATO: 'renovaciones', ANADIR_ALUMNO: 'alumnos apuntados a clases', CREAR_CONTRATO: 'contrataciones nuevas',
  EDITAR_CONTRATO: 'contrataciones editadas', FINALIZAR_CONTRATO: 'contratos finalizados', EDITAR_HORARIO: 'cambios de horario', GENERAR_CLASES: 'clases generadas',
  CANCELAR_CLASE: 'clases canceladas', REACTIVAR_CLASE: 'clases reactivadas', PUBLICAR_AVISO: 'avisos publicados', CONSENTIMIENTO_PAPEL: 'consentimientos en papel',
  RESERVAS_AUTOMATICAS: 'repasos de reservas fijas', ELIMINAR_FRANJA: 'franjas eliminadas', BAJA_CIERRA_CONTRATO: 'bajas', EDITAR_CLIENTE: 'fichas editadas', CREAR_CLIENTE: 'alumnos nuevos',
};
const QUIEN: Record<string, string> = { ALUMNO: 'alumnos', EQUIPO: 'equipo', SIN_SESION: 'sin entrar' };
const TIPO_ERROR: Record<string, string> = { pantalla: 'mensaje en pantalla', accion: 'acción que no se pudo hacer', fallo: 'fallo de la app' };
const MAX_MENSAJE = 3900;

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)} %` : '-');
const accion = (a: string) => ACCIONES[a] ?? a.toLowerCase().replace(/_/g, ' ');
const periodo = (d: number) => (d === 1 ? 'el último día' : `los últimos ${d} días`);

function bloqueErrores(i: Informe): string[] {
  const l: string[] = [];
  if (!i.errores) return ['ERRORES', 'Todavía no se registran (falta la migración 0035).'];
  const e = i.errores;
  if (e.total === 0) return ['ERRORES', `Ninguno en ${periodo(i.dias)}.`];
  const quien = Object.entries(e.por_quien).map(([k, n]) => `${QUIEN[k] ?? k} ${n}`).join(', ');
  l.push('ERRORES', `${e.total} en ${periodo(i.dias)}, a ${e.personas} ${e.personas === 1 ? 'persona' : 'personas'} (${quien}).`);
  for (const t of e.top) l.push(`· ${t.mensaje} — ${t.veces} ${t.veces === 1 ? 'vez' : 'veces'}, ${t.personas} ${t.personas === 1 ? 'persona' : 'personas'} (${t.quien.split(', ').map((q) => QUIEN[q] ?? q).join(', ')}; ${TIPO_ERROR[t.tipo] ?? t.tipo}; última ${t.ultima})`);
  return l;
}

/** El informe en texto para Telegram (sin formato: se lee bien en el móvil). */
export function formatearInforme(i: Informe, soloErrores = false): string {
  const l: string[] = [`Nuevo Palmar · ${periodo(i.dias)} (${i.generado})`, ''];
  if (!soloErrores) {
    const a = i.alumnos;
    l.push('ALUMNOS',
      `${a.con_cuenta} de ${a.activos} tienen la app (${pct(a.con_cuenta, a.activos)}).`,
      `La han usado: ${a.uso_dia} hoy/último día, ${a.uso_7} en 7 días, ${a.uso_30} en 30 días.`,
      `Con notificaciones activadas: ${a.notificaciones}.`);
    if (i.acciones_alumnos.length > 0) l.push(`Ellos solos: ${i.acciones_alumnos.map((x) => `${x.veces} ${accion(x.accion)} (${x.personas})`).join(', ')}.`);
    else l.push('No han hecho nada ellos solos en la app.');
    l.push(`Avisos: ${i.avisos.avisos} enviados, ${i.avisos.entregas} entregas, leídos ${pct(i.avisos.leidos, i.avisos.entregas)}.`, '');
    l.push('EQUIPO');
    for (const e of i.equipo) l.push(`· ${e.quien} (${e.rol.toLowerCase()}): ${e.acciones} acciones en ${e.dias} ${e.dias === 1 ? 'día' : 'días'}${e.ultimo_uso ? `, último uso ${e.ultimo_uso}` : ''}`);
    if (i.equipo_sin_cuenta > 0) l.push(`${i.equipo_sin_cuenta} ${i.equipo_sin_cuenta === 1 ? 'persona del equipo no tiene' : 'personas del equipo no tienen'} cuenta en la app.`);
    if (i.acciones_equipo.length > 0) l.push(`Lo más hecho: ${i.acciones_equipo.map((x) => `${x.veces} ${accion(x.accion)}`).join(', ')}.`);
    l.push(`Pasar lista: ${i.lista.marcadas} de ${i.lista.clases} clases dadas (${pct(i.lista.marcadas, i.lista.clases)}).`, '');
  }
  l.push(...bloqueErrores(i));
  if (!soloErrores) {
    const s = i.senales;
    const alertas: string[] = [];
    if (s.push_atascados > 0) alertas.push(`${s.push_atascados} avisos al móvil sin salir desde hace más de un día`);
    if (s.mantenimientos_7 < 7) alertas.push(`el mantenimiento nocturno solo se ha hecho ${s.mantenimientos_7} de las últimas 7 noches`);
    l.push('', 'SEÑALES',
      alertas.length > 0 ? `Ojo: ${alertas.join('; ')}.` : 'Avisos al móvil y mantenimiento nocturno, bien.',
      `Última copia de seguridad: ${s.ultima_copia ?? 'ninguna'}. Clases canceladas: ${s.clases_canceladas}. Cobros pendientes vencidos: ${s.cobros_vencidos}.`);
  }
  const texto = l.join('\n');
  return texto.length > MAX_MENSAJE ? `${texto.slice(0, MAX_MENSAJE)}\n…` : texto;
}

const AYUDA = [
  'Órdenes:',
  '/informe – cómo va la app los últimos 7 días',
  '/informe 30 – lo mismo con otros días (1 a 90)',
  '/hoy – el último día',
  '/errores – solo los errores que ha visto la gente (también /errores 30)',
].join('\n');

export interface Dependencias {
  secreto: string;
  chats: string[];
  pedirInforme: (dias: number) => Promise<Informe>;
}

const respuesta = (chatId: number | string, text: string) =>
  new Response(JSON.stringify({ method: 'sendMessage', chat_id: chatId, text, disable_web_page_preview: true }), { headers: { 'Content-Type': 'application/json' } });

/** Atiende una actualización de Telegram (webhook). */
export async function atender(req: Request, d: Dependencias): Promise<Response> {
  if (req.method !== 'POST') return new Response('ok');
  if (!d.secreto || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== d.secreto) return new Response('no autorizado', { status: 401 });
  let upd: { message?: { chat?: { id?: number }; text?: string } };
  try { upd = await req.json(); } catch { return new Response('ok'); }
  const chatId = upd.message?.chat?.id;
  const texto = (upd.message?.text ?? '').trim();
  if (chatId == null || !texto.startsWith('/')) return new Response('ok');
  if (!d.chats.includes(String(chatId))) {
    return respuesta(chatId, `Este bot es privado. Tu número de chat es ${chatId}: si eres el administrador, ponlo en TELEGRAM_CHATS (Supabase → Edge Functions → Secrets).`);
  }
  const [orden, arg] = texto.split(/\s+/);
  const nombre = orden.split('@')[0].toLowerCase();
  const dias = Math.min(90, Math.max(1, Number.parseInt(arg ?? '', 10) || (nombre === '/hoy' ? 1 : 7)));
  if (nombre === '/start' || nombre === '/ayuda' || nombre === '/help') return respuesta(chatId, AYUDA);
  if (nombre !== '/informe' && nombre !== '/hoy' && nombre !== '/errores') return respuesta(chatId, `No conozco esa orden.\n\n${AYUDA}`);
  try {
    const informe = await d.pedirInforme(nombre === '/hoy' ? 1 : dias);
    return respuesta(chatId, formatearInforme(informe, nombre === '/errores'));
  } catch (e) {
    return respuesta(chatId, `No he podido sacar el informe: ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (typeof Deno !== 'undefined') {
  const env = (n: string) => Deno!.env.get(n)?.trim() ?? '';
  Deno.serve((req) => atender(req, {
    secreto: env('TELEGRAM_SECRETO'),
    chats: env('TELEGRAM_CHATS').split(',').map((x) => x.trim()).filter(Boolean),
    pedirInforme: async (dias) => {
      const url = env('SUPABASE_URL');
      const clave = env('SUPABASE_SERVICE_ROLE_KEY');
      const r = await fetch(`${url}/rest/v1/rpc/informe_uso`, {
        method: 'POST',
        headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_dias: dias }),
      });
      if (!r.ok) throw new Error(`la base de datos ha respondido ${r.status} (¿falta la migración 0036?)`);
      return (await r.json()) as Informe;
    },
  }));
}
