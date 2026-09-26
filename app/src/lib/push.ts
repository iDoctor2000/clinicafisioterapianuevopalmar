/**
 * Web Push en el navegador: comprobar soporte y permiso, y crear/cancelar la
 * suscripción (`PushSubscription`) contra el service worker de la PWA.
 *
 * La clave pública VAPID llega en `VITE_VAPID_PUBLIC_KEY` (la privada vive solo en
 * la Edge Function `enviar-push`). Sin clave, la app no ofrece notificaciones push.
 */

export interface SuscripcionPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type EstadoPermiso = 'granted' | 'denied' | 'default';

/** Clave pública VAPID del build ('' si no se ha configurado). */
export function clavePublicaVapid(): string {
  return ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();
}

/** true si este navegador puede recibir notificaciones push (SW + PushManager + Notification). */
export function soportaPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export function estadoPermiso(): EstadoPermiso {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

/** iPhone/iPad: solo reciben push si la app está añadida a la pantalla de inicio (Safari 16.4+). */
export function esIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ se identifica como Mac: distinguirlo por la pantalla táctil.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function esStandalone(): boolean {
  try {
    return (
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    );
  } catch {
    return false;
  }
}

/** En iOS, el push solo funciona con la app instalada en la pantalla de inicio. */
export function iosSinInstalar(): boolean {
  return esIos() && !esStandalone();
}

/** Convierte una clave VAPID en base64url (como la genera `web-push`) en el `applicationServerKey` que pide el navegador. */
export function base64UrlAUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const limpio = base64Url.trim().replace(/-/g, '+').replace(/_/g, '/');
  const relleno = '='.repeat((4 - (limpio.length % 4)) % 4);
  const binario = atob(limpio + relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Codifica bytes en base64url (sin `=`), como lo espera `web-push` para p256dh/auth. */
export function bytesABase64Url(datos: ArrayBufferLike | ArrayBufferView | null): string {
  if (!datos) return '';
  const bytes = ArrayBuffer.isView(datos) ? new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength) : new Uint8Array(datos);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deSuscripcion(s: PushSubscription): SuscripcionPush {
  return { endpoint: s.endpoint, p256dh: bytesABase64Url(s.getKey('p256dh')), auth: bytesABase64Url(s.getKey('auth')) };
}

/** Service worker listo (registrado por `registerSW` en main.tsx). */
async function registroSw(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) return reg;
  return navigator.serviceWorker.ready;
}

/** Suscripción actual de este navegador, si existe (sin pedir permiso). */
export async function suscripcionActual(): Promise<SuscripcionPush | null> {
  if (!soportaPush()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const s = await reg?.pushManager.getSubscription();
    return s ? deSuscripcion(s) : null;
  } catch {
    return null;
  }
}

/**
 * Pide permiso (si hace falta) y crea la suscripción push con la clave pública VAPID.
 * Lanza un Error con mensaje para el usuario si no es posible.
 */
export async function suscribir(vapidPublicKey: string): Promise<SuscripcionPush> {
  if (!soportaPush()) throw new Error('Este navegador no permite notificaciones.');
  if (!vapidPublicKey) throw new Error('Las notificaciones no están configuradas en el servidor.');
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new Error(permiso === 'denied' ? 'PERMISO_DENEGADO' : 'PERMISO_NO_CONCEDIDO');
  const reg = await registroSw();
  const existente = await reg.pushManager.getSubscription();
  if (existente) return deSuscripcion(existente);
  const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlAUint8Array(vapidPublicKey) });
  return deSuscripcion(s);
}

/** Cancela la suscripción push de este navegador. Devuelve el endpoint cancelado (o null si no había). */
export async function cancelarSuscripcion(): Promise<string | null> {
  if (!soportaPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const s = await reg?.pushManager.getSubscription();
  if (!s) return null;
  const endpoint = s.endpoint;
  await s.unsubscribe();
  return endpoint;
}
