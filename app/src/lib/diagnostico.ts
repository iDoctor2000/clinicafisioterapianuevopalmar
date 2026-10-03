/**
 * Registro de diagnóstico: anota todo lo que pasa en la app (comandos, errores, navegación,
 * conexión, avisos en pantalla) en un búfer circular persistido en localStorage y genera un
 * informe de texto completo para compartirlo cuando algo falla.
 *
 * No guarda contraseñas ni imágenes: los argumentos se resumen y se recortan.
 */

export type TipoEvento = 'arranque' | 'comando' | 'error' | 'aviso' | 'navegacion' | 'red' | 'auth' | 'push' | 'info';

export interface EventoDiagnostico {
  /** Instante ISO. */
  t: string;
  tipo: TipoEvento;
  mensaje: string;
  /** Datos adicionales ya resumidos (sin contraseñas ni imágenes). */
  datos?: unknown;
}

const CLAVE = 'np-diagnostico-v1';
const MAX_EVENTOS = 600;
const MAX_TEXTO = 400;

let eventos: EventoDiagnostico[] = cargar();
let instalado = false;
const inicioSesion = new Date();

function cargar(): EventoDiagnostico[] {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as EventoDiagnostico[]) : [];
  } catch {
    return [];
  }
}

function guardar(): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(eventos));
  } catch {
    /* sin almacenamiento (modo privado): el registro vive solo en memoria */
  }
}

/** Resume cualquier valor para el registro: recorta textos largos, oculta contraseñas e imágenes. */
export function resumir(v: unknown, profundidad = 0): unknown {
  if (v == null) return v;
  if (typeof v === 'string') {
    if (v.startsWith('data:image')) return `[imagen ${Math.round(v.length / 1024)} KB]`;
    return v.length > MAX_TEXTO ? `${v.slice(0, MAX_TEXTO)}… (${v.length} caracteres)` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Error) return { nombre: v.name, mensaje: v.message, pila: v.stack?.split('\n').slice(0, 6).join(' | ') };
  if (profundidad > 3) return '[…]';
  if (Array.isArray(v)) return v.length > 20 ? [...v.slice(0, 20).map((x) => resumir(x, profundidad + 1)), `… ${v.length - 20} más`] : v.map((x) => resumir(x, profundidad + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/password|contrase|token|secret|clave/i.test(k)) out[k] = '[oculto]';
      else if (/foto|imagen|dataUrl|base64/i.test(k) && typeof val === 'string') out[k] = `[imagen ${Math.round(val.length / 1024)} KB]`;
      else out[k] = resumir(val, profundidad + 1);
    }
    return out;
  }
  return String(v);
}

/** Anota un evento. Es la función que usa el resto de la app. */
export function registrar(tipo: TipoEvento, mensaje: string, datos?: unknown): void {
  eventos.push({ t: new Date().toISOString(), tipo, mensaje, datos: datos === undefined ? undefined : resumir(datos) });
  if (eventos.length > MAX_EVENTOS) eventos = eventos.slice(eventos.length - MAX_EVENTOS);
  guardar();
}

export function eventosRegistrados(): EventoDiagnostico[] {
  return eventos.slice();
}

export function borrarRegistro(): void {
  eventos = [];
  guardar();
  registrar('info', 'Registro de diagnóstico borrado por el usuario');
}

function textoError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(resumir(e));
  } catch {
    return String(e);
  }
}

/**
 * Engancha los capturadores globales (una sola vez): errores de JavaScript, promesas rechazadas,
 * console.error/warn, cambios de ruta, conexión y visibilidad.
 */
export function instalarDiagnostico(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  registrar('arranque', 'App abierta', { url: location.href, standalone: esStandalone(), online: navigator.onLine });

  window.addEventListener('error', (e) => {
    registrar('error', `Error JS: ${e.message}`, { archivo: e.filename, linea: e.lineno, columna: e.colno, error: e.error ? resumir(e.error) : undefined });
  });
  window.addEventListener('unhandledrejection', (e) => {
    registrar('error', `Promesa rechazada: ${textoError(e.reason)}`, { motivo: resumir(e.reason) });
  });

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    registrar('error', `console.error: ${args.map(textoError).join(' ')}`);
    origError(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    registrar('aviso', `console.warn: ${args.map(textoError).join(' ')}`);
    origWarn(...args);
  };

  window.addEventListener('hashchange', () => registrar('navegacion', `Pantalla: ${location.hash || '#/'}`));
  window.addEventListener('online', () => registrar('red', 'Conexión recuperada'));
  window.addEventListener('offline', () => registrar('red', 'Sin conexión'));
  document.addEventListener('visibilitychange', () => registrar('info', document.visibilityState === 'visible' ? 'App en primer plano' : 'App en segundo plano'));
  window.addEventListener('appinstalled', () => registrar('info', 'App instalada en la pantalla de inicio'));
}

function esStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

export interface ContextoInforme {
  modo: string;
  version: string;
  compilado: string;
  servidor: string | null;
  sesion: Record<string, unknown> | null;
  usuarioAuth: { id: string; email: string } | null;
  ultimoError: string | null;
  errorCarga: string | null;
  /** Secciones de datos ya resumidas por quien llama (config, recuentos, auditoría…). */
  datos: Record<string, unknown>;
}

interface InfoNavegador {
  [k: string]: unknown;
}

async function infoEntorno(): Promise<InfoNavegador> {
  const n = navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; saveData?: boolean }; standalone?: boolean; userAgentData?: { platform?: string; mobile?: boolean } };
  const info: InfoNavegador = {
    navegador: n.userAgent,
    plataforma: n.userAgentData?.platform ?? n.platform,
    movil: n.userAgentData?.mobile,
    idioma: n.language,
    zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
    horaLocal: new Date().toString(),
    pantalla: `${screen.width}×${screen.height} (ventana ${window.innerWidth}×${window.innerHeight}, escala ${window.devicePixelRatio})`,
    instaladaComoApp: esStandalone(),
    online: n.onLine,
    conexion: n.connection ? `${n.connection.effectiveType ?? '?'} · ${n.connection.downlink ?? '?'} Mb/s · ahorro de datos ${n.connection.saveData ? 'sí' : 'no'}` : 'desconocida',
    cookies: n.cookieEnabled,
    notificaciones: typeof Notification !== 'undefined' ? Notification.permission : 'no soportadas',
    soportaPush: 'PushManager' in window,
    serviceWorker: 'serviceWorker' in n ? (n.serviceWorker.controller ? 'activo' : 'registrado sin controlar la página') : 'no soportado',
    url: location.href,
    referencia: document.referrer || '(ninguna)',
  };
  try {
    if ('serviceWorker' in n) {
      const reg = await n.serviceWorker.getRegistration();
      info.serviceWorkerEstado = reg ? { ambito: reg.scope, activo: !!reg.active, esperando: !!reg.waiting, instalando: !!reg.installing } : 'sin registro';
      const sub = await reg?.pushManager?.getSubscription();
      info.suscripcionPush = sub ? `sí (${new URL(sub.endpoint).host})` : 'no';
    }
  } catch (e) {
    info.serviceWorkerEstado = `error al consultar: ${textoError(e)}`;
  }
  try {
    if (n.storage?.estimate) {
      const est = await n.storage.estimate();
      info.almacenamiento = `${Math.round((est.usage ?? 0) / 1024)} KB usados de ${Math.round((est.quota ?? 0) / 1024 / 1024)} MB`;
    }
  } catch {
    /* ignorar */
  }
  try {
    info.localStorage = Object.keys(localStorage).map((k) => `${k} (${Math.round((localStorage.getItem(k)?.length ?? 0) / 1024)} KB)`);
  } catch {
    info.localStorage = 'no disponible';
  }
  return info;
}

function bloque(titulo: string, cuerpo: string): string {
  const linea = '─'.repeat(72);
  return `\n${linea}\n${titulo.toUpperCase()}\n${linea}\n${cuerpo.trim()}\n`;
}

function json(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

function hora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** Genera el informe completo en texto plano. */
export async function generarInforme(ctx: ContextoInforme): Promise<string> {
  const ahora = new Date();
  const errores = eventos.filter((e) => e.tipo === 'error');
  const comandosFallidos = eventos.filter((e) => e.tipo === 'comando' && /fallido|error/i.test(e.mensaje));
  const cabecera = [
    'INFORME DE DIAGNÓSTICO · Nuevo Palmar Pilates',
    `Generado: ${ahora.toString()}`,
    `App: versión ${ctx.version} (compilada ${ctx.compilado})`,
    `Modo: ${ctx.modo}${ctx.servidor ? ` · servidor ${ctx.servidor}` : ''}`,
    `Sesión abierta desde: ${inicioSesion.toLocaleString('es-ES')} (${Math.round((ahora.getTime() - inicioSesion.getTime()) / 60000)} min)`,
    `Eventos registrados: ${eventos.length} · errores: ${errores.length} · comandos fallidos: ${comandosFallidos.length}`,
  ].join('\n');

  const partes = [cabecera];

  partes.push(bloque('Resumen de problemas', (errores.length === 0 && comandosFallidos.length === 0 && !ctx.ultimoError && !ctx.errorCarga)
    ? 'No hay errores registrados.'
    : [
      ctx.errorCarga ? `Error de carga actual: ${ctx.errorCarga}` : '',
      ctx.ultimoError ? `Último error de un comando: ${ctx.ultimoError}` : '',
      ...comandosFallidos.slice(-10).map((e) => `[${hora(e.t)}] ${e.mensaje}`),
      ...errores.slice(-15).map((e) => `[${hora(e.t)}] ${e.mensaje}`),
    ].filter(Boolean).join('\n')));

  partes.push(bloque('Quién', json({ sesion: ctx.sesion ?? '(sin sesión)', usuarioAuth: ctx.usuarioAuth ?? '(ninguno)' })));
  partes.push(bloque('Dispositivo y navegador', json(await infoEntorno())));
  for (const [titulo, cuerpo] of Object.entries(ctx.datos)) partes.push(bloque(titulo, typeof cuerpo === 'string' ? cuerpo : json(cuerpo)));

  const lineas = eventos.map((e) => {
    const extra = e.datos === undefined ? '' : ` · ${JSON.stringify(e.datos)}`;
    return `[${hora(e.t)}] ${e.tipo.padEnd(10)} ${e.mensaje}${extra}`;
  });
  partes.push(bloque(`Cronología completa (${eventos.length} eventos, del más antiguo al más reciente)`, lineas.join('\n') || '(vacía)'));
  partes.push('\nFIN DEL INFORME\n');
  return partes.join('\n');
}

/** Nombre de archivo del informe. */
export function nombreInforme(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `diagnostico-nuevopalmar-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`;
}

/**
 * Comparte el informe: hoja de compartir del móvil (WhatsApp, correo…) si existe; si no, lo descarga.
 * Devuelve cómo se ha entregado.
 */
export async function compartirInforme(texto: string): Promise<'compartido' | 'descargado' | 'cancelado'> {
  const nombre = nombreInforme();
  const archivo = new File([texto], nombre, { type: 'text/plain' });
  const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof n.share === 'function' && (!n.canShare || n.canShare({ files: [archivo] }))) {
    try {
      await n.share({ files: [archivo], title: 'Informe de diagnóstico', text: 'Informe de diagnóstico de la app Nuevo Palmar Pilates' });
      registrar('info', 'Informe de diagnóstico compartido');
      return 'compartido';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelado';
      /* si la hoja de compartir falla, descargamos */
    }
  }
  const url = URL.createObjectURL(archivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  registrar('info', 'Informe de diagnóstico descargado');
  return 'descargado';
}

export async function copiarInforme(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
