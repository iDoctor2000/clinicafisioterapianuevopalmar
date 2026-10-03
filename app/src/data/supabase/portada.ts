/**
 * Fotos del carrusel de la portada en Supabase Storage: bucket PÚBLICO `portada`
 * (creado en `supabase/migrations/0008_portada.sql`). Las imágenes no son datos
 * personales (fotos del centro), así que se sirven por URL pública y la fila de
 * `portada_imagenes` guarda esa URL tal cual.
 */
import { mensajeError, servidor } from './cliente';

export const BUCKET_PORTADA = 'portada';

/** Sube la imagen (ya reducida en el navegador) y devuelve su URL pública. */
export async function subirImagenPortada(id: string, blob: Blob): Promise<string> {
  const ruta = `${id}.jpg`;
  const { error } = await servidor().storage.from(BUCKET_PORTADA).upload(ruta, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '86400' });
  if (error) throw new Error(traducirErrorStorage(error));
  const { data } = servidor().storage.from(BUCKET_PORTADA).getPublicUrl(ruta);
  // Marca de versión para que un reemplazo con el mismo nombre no quede cacheado.
  return `${data.publicUrl}?v=${Date.now()}`;
}

/** Ruta del objeto dentro del bucket a partir de la URL pública guardada; null si no es de este bucket. */
export function rutaDeUrlPortada(url: string): string | null {
  const m = url.match(new RegExp(`/object/public/${BUCKET_PORTADA}/([^?#]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Borra el objeto del bucket al que apunta la URL. No falla si no es del bucket o no existe. */
export async function borrarImagenPortada(url: string): Promise<void> {
  const ruta = rutaDeUrlPortada(url);
  if (!ruta) return;
  const { error } = await servidor().storage.from(BUCKET_PORTADA).remove([ruta]);
  if (error && !/not found|no existe/i.test(error.message)) throw new Error(traducirErrorStorage(error));
}

function traducirErrorStorage(e: { message: string; statusCode?: string | number }): string {
  const msg = e.message || '';
  if (/bucket not found/i.test(msg)) return 'El almacén de fotos de la portada no está configurado en el servidor (falta la migración 0008_portada.sql).';
  if (/row-level security|unauthorized|not allowed|403/i.test(msg) || String(e.statusCode) === '403') return 'Solo el administrador puede cambiar las fotos de la portada.';
  if (/payload too large|exceeded the maximum allowed size|413/i.test(msg) || String(e.statusCode) === '413') return 'La imagen es demasiado grande (máximo 2 MB).';
  if (/mime type|not supported/i.test(msg)) return 'Formato de imagen no admitido. Usa JPG, PNG o WebP.';
  return mensajeError(e);
}
