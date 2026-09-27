/**
 * Fotos de clientes en Supabase Storage (bucket privado `fotos-clientes`, creado en
 * `supabase/migrations/0006_fotos.sql`). Cada cliente tiene como mucho un objeto:
 * `<cliente_id>/avatar.jpg`. Como el bucket es privado, la app obtiene URLs firmadas
 * (válidas 1 h) y las guarda en un caché en memoria para no firmar en cada render.
 *
 * `clientes.foto_url` guarda la ruta del objeto más `?v=<marca de tiempo>`: al cambiar
 * la foto cambia la marca y con ella la clave del caché (y la URL firmada).
 */
import { mensajeError, servidor } from './cliente';

export const BUCKET_FOTOS = 'fotos-clientes';
/** Validez de la URL firmada (segundos). */
const VALIDEZ_S = 60 * 60;
/** Renovamos un poco antes de que caduque para que ninguna imagen en pantalla se rompa. */
const MARGEN_MS = 5 * 60 * 1000;

const cache = new Map<string, { url: string; caduca: number }>();
const enCurso = new Map<string, Promise<string | null>>();

/** Ruta del objeto de la foto de un cliente dentro del bucket. */
export function rutaFoto(clienteId: string): string {
  return `${clienteId}/avatar.jpg`;
}

/** Ruta sin la marca `?v=`. */
function rutaDe(fotoUrl: string): string {
  return fotoUrl.split('?')[0];
}

/**
 * URL que se puede poner en un `<img>` para la foto de un cliente, o null si no tiene.
 * Acepta también data URLs y URLs absolutas (las devuelve tal cual: modo demo / bucket público).
 */
export function urlFoto(clienteId: string, fotoUrl: string | null | undefined): Promise<string | null> {
  if (!fotoUrl) return Promise.resolve(null);
  if (/^(data:|blob:|https?:)/i.test(fotoUrl)) return Promise.resolve(fotoUrl);
  const clave = fotoUrl;
  const c = cache.get(clave);
  if (c && c.caduca > Date.now()) return Promise.resolve(c.url);
  const pendiente = enCurso.get(clave);
  if (pendiente) return pendiente;
  const p = (async () => {
    try {
      const { data, error } = await servidor().storage.from(BUCKET_FOTOS).createSignedUrl(rutaDe(fotoUrl) || rutaFoto(clienteId), VALIDEZ_S);
      if (error || !data?.signedUrl) {
        console.warn('[fotos] No se ha podido firmar la URL de la foto:', error ? mensajeError(error) : 'sin URL');
        return null;
      }
      cache.set(clave, { url: data.signedUrl, caduca: Date.now() + VALIDEZ_S * 1000 - MARGEN_MS });
      return data.signedUrl;
    } finally {
      enCurso.delete(clave);
    }
  })();
  enCurso.set(clave, p);
  return p;
}

/** Sube (o reemplaza) la foto y devuelve el valor a guardar en `clientes.foto_url`. */
export async function subirFoto(clienteId: string, blob: Blob): Promise<string> {
  const ruta = rutaFoto(clienteId);
  const { error } = await servidor().storage.from(BUCKET_FOTOS).upload(ruta, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw new Error(traducirErrorStorage(error));
  olvidar(clienteId);
  return `${ruta}?v=${Date.now()}`;
}

/** Borra el objeto de la foto. No falla si no existía. */
export async function borrarFoto(clienteId: string): Promise<void> {
  const { error } = await servidor().storage.from(BUCKET_FOTOS).remove([rutaFoto(clienteId)]);
  if (error && !/not found|no existe/i.test(error.message)) throw new Error(traducirErrorStorage(error));
  olvidar(clienteId);
}

/** Quita del caché todas las entradas de un cliente (tras subir o borrar). */
export function olvidar(clienteId: string): void {
  const prefijo = `${clienteId}/`;
  for (const k of Array.from(cache.keys())) if (k.startsWith(prefijo)) cache.delete(k);
}

/** Solo para pruebas. */
export function _vaciarCacheFotos(): void {
  cache.clear();
  enCurso.clear();
}

function traducirErrorStorage(e: { message: string; statusCode?: string | number }): string {
  const msg = e.message || '';
  if (/bucket not found/i.test(msg)) return 'El almacén de fotos no está configurado en el servidor (falta la migración 0006_fotos.sql).';
  if (/row-level security|unauthorized|not allowed|403/i.test(msg) || String(e.statusCode) === '403') return 'No tienes permiso para cambiar esta foto.';
  if (/payload too large|exceeded the maximum allowed size|413/i.test(msg) || String(e.statusCode) === '413') return 'La imagen es demasiado grande (máximo 500 KB).';
  if (/mime type|not supported/i.test(msg)) return 'Formato de imagen no admitido. Usa JPG, PNG o WebP.';
  return mensajeError(e);
}
