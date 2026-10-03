/// <reference lib="webworker" />
/**
 * Service worker de la PWA (estrategia `injectManifest` de vite-plugin-pwa).
 *
 * - Precache de todos los ficheros del build (`self.__WB_MANIFEST` lo inyecta Workbox al compilar).
 * - Navegación offline: cualquier ruta bajo `base` responde con `index.html`.
 * - Notificaciones push (Web Push): muestra la notificación y, al tocarla, abre/enfoca la app.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

/** Ruta pública de la app (p. ej. `/app/`). Vite la sustituye en el build. */
const BASE = import.meta.env.BASE_URL;
const URL_AVISOS = `${BASE}#/avisos`;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Los manuales en PDF (y cualquier archivo con extensión) se sirven tal cual, no con la app.
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`), { denylist: [/\/manuales\//, /\.(pdf|png|jpe?g|webp|txt|json|xml|csv)(\?.*)?$/i] }));

// Activar la versión nueva del SW sin esperar a que se cierren todas las pestañas
// (equivale a `registerType: 'autoUpdate'` con generateSW).
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

interface CargaPush {
  titulo?: string;
  cuerpo?: string;
  url?: string;
  etiqueta?: string;
}

/** Lee el cuerpo del push (JSON o texto plano) sin que un formato inesperado tumbe el evento. */
function leerCarga(e: PushEvent): CargaPush {
  if (!e.data) return {};
  try {
    const json = e.data.json() as unknown;
    if (json && typeof json === 'object') return json as CargaPush;
  } catch { /* no es JSON */ }
  try {
    return { cuerpo: e.data.text() };
  } catch {
    return {};
  }
}

self.addEventListener('push', (e) => {
  const carga = leerCarga(e);
  const titulo = carga.titulo?.trim() || 'Nuevo Palmar Pilates';
  const url = typeof carga.url === 'string' && carga.url ? carga.url : URL_AVISOS;
  e.waitUntil(
    self.registration.showNotification(titulo, {
      body: carga.cuerpo ?? '',
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/icon-192.png`,
      tag: carga.etiqueta,
      lang: 'es',
      data: { url },
    }),
  );
});

/** Convierte `data.url` (relativa a `base`, `#/ruta` o absoluta) en una URL absoluta dentro del origen. */
function urlDestino(url: unknown): string {
  const raiz = new URL(BASE, self.location.origin);
  if (typeof url !== 'string' || !url) return new URL(URL_AVISOS, self.location.origin).href;
  const destino = url.startsWith('#') ? new URL(url, raiz) : new URL(url, raiz);
  return destino.origin === raiz.origin ? destino.href : raiz.href;
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = urlDestino((e.notification.data as { url?: unknown } | undefined)?.url);
  const raiz = new URL(BASE, self.location.origin).href;
  e.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const abierta = ventanas.find((w) => w.url.startsWith(raiz));
      if (abierta) {
        await abierta.focus();
        try {
          if ('navigate' in abierta) await abierta.navigate(destino);
        } catch { /* algunos navegadores no permiten navigate(): al menos queda enfocada */ }
        return;
      }
      await self.clients.openWindow(destino);
    })(),
  );
});
