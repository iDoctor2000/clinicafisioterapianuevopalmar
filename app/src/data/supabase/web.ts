/**
 * Imágenes de las actividades (icono y foto) en el bucket PÚBLICO `web`
 * (creado en `supabase/migrations/0009_web.sql`), compartido con el editor de la web.
 */
import { mensajeError, servidor } from './cliente';

export const BUCKET_WEB = 'web';

/** Sube una imagen ya reducida y devuelve su URL pública (con marca de versión). */
export async function subirImagenActividad(actividadId: string, tipo: 'icono' | 'foto', blob: Blob): Promise<string> {
  const ruta = `actividades/${actividadId}-${tipo}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
  const { error } = await servidor().storage.from(BUCKET_WEB).upload(ruta, blob, { upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '86400' });
  if (error) throw new Error(traducir(error));
  const { data } = servidor().storage.from(BUCKET_WEB).getPublicUrl(ruta);
  return `${data.publicUrl}?v=${Date.now()}`;
}

function traducir(e: { message: string; statusCode?: string | number }): string {
  const msg = e.message || '';
  if (/bucket not found/i.test(msg)) return 'El almacén de imágenes de la web no está configurado en el servidor (falta la migración 0009_web.sql).';
  if (/row-level security|unauthorized|not allowed|403/i.test(msg) || String(e.statusCode) === '403') return 'Solo el administrador puede subir imágenes de actividades.';
  if (/payload too large|exceeded the maximum allowed size|413/i.test(msg) || String(e.statusCode) === '413') return 'La imagen es demasiado grande (máximo 5 MB).';
  if (/mime type|not supported/i.test(msg)) return 'Formato de imagen no admitido. Usa JPG, PNG o WebP.';
  return mensajeError(e);
}
