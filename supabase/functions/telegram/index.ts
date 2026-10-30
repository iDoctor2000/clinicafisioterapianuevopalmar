/**
 * Edge Function `telegram`: bot privado de Telegram para el administrador.
 *
 *   /informe       → cómo va la app los últimos 7 días (uso de alumnos y equipo, avisos, pasar lista,
 *                    errores que ha visto la gente y señales de fallo).
 *   /informe 30    → lo mismo con otros días (1 a 90).
 *   /hoy           → el último día.
 *   /informehoy    → los cambios hechos hoy desde las 00:00, uno a uno, y los errores de hoy (también /cambios).
 *   /errores [N]   → solo los errores.
 *   /ayuda         → la lista de órdenes.
 *
 * Seguridad (Telegram no manda la sesión de Supabase, así que "Verify JWT" va DESACTIVADO):
 *   · Telegram manda en cada mensaje la cabecera X-Telegram-Bot-Api-Secret-Token con el secreto que se
 *     puso al activar el bot (setWebhook ... secret_token=...). Si no coincide con TELEGRAM_SECRETO, no
 *     se contesta nada.
 *   · Solo se contesta con datos a los chats de TELEGRAM_CHATS (números separados por comas). A
 *     cualquier otro se le dice que el bot es privado (y su número de chat, para poder darlo de alta).
 *   · El informe sale de `informe_uso()` (0036) y los cambios de hoy de `informe_cambios_hoy()` (0045), que ya
 *     vienen sin datos personales (iniciales).
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

/** Lo que devuelve `informe_cambios_hoy()` (0045). */
export interface CambiosHoy {
  generado: string;
  equipo: { quien: string; acciones: number }[];
  acciones_equipo: { accion: string; veces: number }[];
  acciones_alumnos: { accion: string; veces: number; personas: number }[];
  automaticas: number;
  cambios_equipo: { hora: string; quien: string; accion: string; detalle: string }[];
  cambios_alumnos: { hora: string; quien: string; accion: string; detalle: string }[];
  cobros: { cobrados: number; importe_centimos: number; pendientes_nuevos: number };
  sin_publicar: { franjas: number; clases: number; plazas: number };
  errores: number;
  /** 0046: cuáles (ausente si falta esa migración). */
  errores_detalle?: { mensaje: string; tipo: string; veces: number; personas: number; quien: string; ultima: string }[];
}

const ACCIONES: Record<string, string> = {
  RESERVAR: 'reservas', CANCELAR_RESERVA: 'cancelaciones', LISTA_ESPERA: 'lista de espera', CONSENTIMIENTO: 'consentimientos firmados',
  ASISTENCIA: 'marcas de asistencia', RENOVAR_CONTRATO: 'renovaciones', ANADIR_ALUMNO: 'alumnos apuntados a clases', CREAR_CONTRATO: 'contrataciones nuevas',
  EDITAR_CONTRATO: 'contrataciones editadas', FINALIZAR_CONTRATO: 'contratos finalizados', EDITAR_HORARIO: 'cambios de horario', GENERAR_CLASES: 'clases generadas',
  CANCELAR_CLASE: 'clases canceladas', REACTIVAR_CLASE: 'clases reactivadas', PUBLICAR_AVISO: 'avisos publicados', CONSENTIMIENTO_PAPEL: 'consentimientos en papel',
  RESERVAS_AUTOMATICAS: 'repasos de reservas fijas', ELIMINAR_FRANJA: 'franjas eliminadas', BAJA_CIERRA_CONTRATO: 'bajas', EDITAR_CLIENTE: 'fichas editadas', CREAR_CLIENTE: 'alumnos nuevos',
  BORRAR_CLASE: 'clases eliminadas', CREAR_HORARIO: 'franjas nuevas', MOVER_FIJO: 'alumnos pasados de franja', PUBLICAR_CAMBIOS: 'publicaciones del horario',
  COBRO_PENDIENTE_SUSTITUIDO: 'cobros repetidos quitados', COBROS_FUERA_DE_CONTRATO: 'cobros fuera de contrato quitados', ANULAR_RECUPERACION: 'recuperaciones anuladas',
  CREAR_CLASE_EXTRA: 'clases extraordinarias', QUITAR_ALUMNO: 'alumnos quitados de clases',
};
/** Cada cambio, en singular (para la lista de hoy). */
const CAMBIO: Record<string, string> = {
  RESERVAR: 'Reserva', CANCELAR_RESERVA: 'Cancela', LISTA_ESPERA: 'Lista de espera', CONSENTIMIENTO: 'Firma el consentimiento', ANADIR_ALUMNO: 'Apunta',
  RENOVAR_CONTRATO: 'Renueva', CREAR_CONTRATO: 'Contratación nueva', EDITAR_CONTRATO: 'Edita contratación', FINALIZAR_CONTRATO: 'Finaliza contrato',
  EDITAR_HORARIO: 'Cambia franja', CREAR_HORARIO: 'Franja nueva', ELIMINAR_FRANJA: 'Elimina franja', CANCELAR_CLASE: 'Cancela clase', BORRAR_CLASE: 'Elimina clase',
  REACTIVAR_CLASE: 'Reactiva clase', PUBLICAR_AVISO: 'Aviso', PUBLICAR_CAMBIOS: 'Publica el horario', MOVER_FIJO: 'Pasa de franja', CONSENTIMIENTO_PAPEL: 'Consentimiento en papel',
  BAJA_CIERRA_CONTRATO: 'Baja', EDITAR_CLIENTE: 'Edita ficha', CREAR_CLIENTE: 'Alumno nuevo', COBRO_PENDIENTE_SUSTITUIDO: 'Cobro repetido quitado',
  COBROS_FUERA_DE_CONTRATO: 'Cobros fuera de contrato', ANULAR_RECUPERACION: 'Anula recuperación', CREAR_CLASE_EXTRA: 'Clase extraordinaria',
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

const euros = (c: number) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const cambio = (a: string) => CAMBIO[a] ?? a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ');

/** Los cambios de hoy en texto para Telegram. Si no cabe en un mensaje, se recortan las listas (lo más reciente se queda). */
export function formatearCambiosHoy(c: CambiosHoy): string {
  const cabecera: string[] = [`Nuevo Palmar · cambios de hoy desde las 00:00 (${c.generado})`, ''];
  const resumen: string[] = [];
  const totalEquipo = c.equipo.reduce((n, e) => n + e.acciones, 0);
  if (totalEquipo === 0) resumen.push('EQUIPO: nadie ha hecho cambios hoy.');
  else {
    resumen.push(`EQUIPO: ${totalEquipo} ${totalEquipo === 1 ? 'acción' : 'acciones'} (${c.equipo.map((e) => `${e.quien} ${e.acciones}`).join(', ')}).`);
    resumen.push(`${c.acciones_equipo.map((x) => `${x.veces} ${accion(x.accion)}`).join(', ')}.`);
  }
  if (c.acciones_alumnos.length > 0) resumen.push(`ALUMNOS (ellos solos): ${c.acciones_alumnos.map((x) => `${x.veces} ${accion(x.accion)} (${x.personas})`).join(', ')}.`);
  else resumen.push('ALUMNOS: no han hecho nada ellos solos hoy.');
  if (c.automaticas > 0) resumen.push(`Automáticas (mantenimiento, lista de espera…): ${c.automaticas}.`);
  resumen.push(`COBROS: ${c.cobros.cobrados} ${c.cobros.cobrados === 1 ? 'cobrado' : 'cobrados'} hoy (${euros(c.cobros.importe_centimos)}), ${c.cobros.pendientes_nuevos} ${c.cobros.pendientes_nuevos === 1 ? 'pendiente nuevo' : 'pendientes nuevos'}.`);
  const sp = c.sin_publicar;
  if (sp.franjas + sp.clases + sp.plazas > 0) resumen.push(`SIN PUBLICAR: ${sp.franjas} franjas y ${sp.clases} clases nuevas, ${sp.plazas} plazas retenidas (los alumnos aún no lo ven).`);
  if (c.errores === 0) resumen.push('ERRORES: ninguno hoy.');
  else {
    resumen.push(`ERRORES: ${c.errores} hoy.`);
    for (const t of c.errores_detalle ?? []) {
      resumen.push(`· ${t.mensaje} — ${t.veces} ${t.veces === 1 ? 'vez' : 'veces'}, ${t.personas} ${t.personas === 1 ? 'persona' : 'personas'} (${t.quien.split(', ').map((q) => QUIEN[q] ?? q).join(', ')}; ${TIPO_ERROR[t.tipo] ?? t.tipo}; última ${t.ultima})`);
    }
    if (!c.errores_detalle) resumen.push('(El detalle sale con /errores 1.)');
  }
  const linea = (x: { hora: string; quien: string; accion: string; detalle: string }) => `${x.hora} ${x.quien} · ${cambio(x.accion)}${x.detalle ? `: ${x.detalle}` : ''}`;
  const montar = (nEq: number, nAl: number) => {
    const l = [...cabecera, ...resumen];
    if (c.cambios_equipo.length > 0) {
      l.push('', `CAMBIOS DEL EQUIPO (los más recientes primero${nEq < c.cambios_equipo.length ? `; ${nEq} de ${c.cambios_equipo.length}` : ''})`);
      l.push(...c.cambios_equipo.slice(0, nEq).map(linea));
    }
    if (c.cambios_alumnos.length > 0 && nAl > 0) {
      l.push('', `ALUMNOS (los más recientes${nAl < c.cambios_alumnos.length ? `; ${nAl} de ${c.cambios_alumnos.length}` : ''})`);
      l.push(...c.cambios_alumnos.slice(0, nAl).map(linea));
    }
    return l.join('\n');
  };
  // Se quitan primero líneas de los alumnos y después del equipo hasta que quepa.
  let nEq = c.cambios_equipo.length;
  let nAl = c.cambios_alumnos.length;
  let texto = montar(nEq, nAl);
  while (texto.length > MAX_MENSAJE && (nAl > 0 || nEq > 0)) {
    if (nAl > 0) nAl -= 1; else nEq -= 1;
    texto = montar(nEq, nAl);
  }
  return texto.length > MAX_MENSAJE ? `${texto.slice(0, MAX_MENSAJE)}\n…` : texto;
}

const AYUDA = [
  'Órdenes:',
  '/informe – cómo va la app los últimos 7 días',
  '/informe 30 – lo mismo con otros días (1 a 90)',
  '/hoy – el último día',
  '/informehoy – los cambios y los errores de hoy desde las 00:00 (también /cambios)',
  '/errores – solo los errores que ha visto la gente (también /errores 30)',
].join('\n');

export interface Dependencias {
  secreto: string;
  chats: string[];
  pedirInforme: (dias: number) => Promise<Informe>;
  pedirCambiosHoy: () => Promise<CambiosHoy>;
}

/** Órdenes que dan los cambios de hoy (con la falta de ortografía habitual incluida). */
const ORDENES_CAMBIOS = ['/informehoy', '/infromehoy', '/informe_hoy', '/cambios', '/cambioshoy'];

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
  if (ORDENES_CAMBIOS.includes(nombre)) {
    try {
      return respuesta(chatId, formatearCambiosHoy(await d.pedirCambiosHoy()));
    } catch (e) {
      return respuesta(chatId, `No he podido sacar los cambios de hoy: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
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
  const rpc = async (nombre: string, cuerpo: Record<string, unknown>, migracion: string): Promise<unknown> => {
    const url = env('SUPABASE_URL');
    const clave = env('SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!r.ok) throw new Error(`la base de datos ha respondido ${r.status} (¿falta la migración ${migracion}?)`);
    return r.json();
  };
  Deno.serve((req) => atender(req, {
    secreto: env('TELEGRAM_SECRETO'),
    chats: env('TELEGRAM_CHATS').split(',').map((x) => x.trim()).filter(Boolean),
    pedirInforme: async (dias) => (await rpc('informe_uso', { p_dias: dias }, '0036')) as Informe,
    pedirCambiosHoy: async () => (await rpc('informe_cambios_hoy', {}, '0045')) as CambiosHoy,
  }));
}
