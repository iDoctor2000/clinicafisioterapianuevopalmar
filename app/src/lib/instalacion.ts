/**
 * Instalación de la PWA en la pantalla de inicio.
 *
 * - Android (Chrome, Edge…): el navegador emite `beforeinstallprompt`; lo guardamos y la app
 *   puede lanzar el diálogo nativo con un toque (`instalarDirecto`).
 * - iPhone/iPad: Apple no permite lanzar la instalación desde la web; solo se puede explicar
 *   el gesto (Compartir → Añadir a pantalla de inicio).
 *
 * Este módulo se importa en main.tsx para capturar el evento lo antes posible.
 */

type EventoInstalacion = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let evento: EventoInstalacion | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    evento = e as EventoInstalacion;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    evento = null;
    try { localStorage.setItem(CLAVE_INSTALADA, '1'); } catch { /* sin almacenamiento */ }
    avisar();
  });
}

const CLAVE_INSTALADA = 'np-app-instalada';

/** Suscribe un aviso a los cambios (evento disponible, app instalada). Devuelve la baja. */
export function alCambiarInstalacion(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

export function estaInstalada(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    return localStorage.getItem(CLAVE_INSTALADA) === '1' && esMovil() && !evento;
  } catch {
    return false;
  }
}

export type Plataforma = 'ios-safari' | 'ios-otro' | 'android' | 'escritorio';

export function plataforma(): Plataforma {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-otro' : 'ios-safari';
  if (/Android/i.test(ua)) return 'android';
  return 'escritorio';
}

export function esMovil(): boolean {
  return plataforma() !== 'escritorio';
}

/** En iPad la barra de Safari está arriba; en iPhone, abajo. */
export function esIpad(): boolean {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** true si el navegador permite instalar con un toque (diálogo nativo disponible). */
export function puedeInstalarDirecto(): boolean {
  return evento !== null;
}

/** Lanza el diálogo nativo. Devuelve 'aceptada', 'rechazada' o 'no-disponible'. */
export async function instalarDirecto(): Promise<'aceptada' | 'rechazada' | 'no-disponible'> {
  if (!evento) return 'no-disponible';
  try {
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    evento = null;
    avisar();
    return outcome === 'accepted' ? 'aceptada' : 'rechazada';
  } catch {
    return 'no-disponible';
  }
}

// ---------------------------------------------------------------------------
// Aviso de la primera visita: se muestra una vez y, si se cierra, no vuelve en 30 días.
// ---------------------------------------------------------------------------

const CLAVE_AVISO = 'np-aviso-instalar';
const DIAS_SILENCIO = 30;

export function avisoSilenciado(ahora = Date.now()): boolean {
  try {
    const v = Number(localStorage.getItem(CLAVE_AVISO) || 0);
    return v > 0 && ahora - v < DIAS_SILENCIO * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

export function silenciarAviso(ahora = Date.now()): void {
  try { localStorage.setItem(CLAVE_AVISO, String(ahora)); } catch { /* sin almacenamiento */ }
}
