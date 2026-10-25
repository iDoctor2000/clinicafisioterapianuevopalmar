/**
 * Foto de la hoja de consentimiento firmada en papel, en el bucket privado `consentimientos`
 * (0025_consentimiento_adjunto.sql). Un objeto por cliente, en `<cliente_id>/<marca>.jpg`; la
 * marca evita cachés al cambiarla. La app obtiene URLs firmadas de corta duración para mostrarla.
 */
import { mensajeError, servidor } from './cliente';

export const BUCKET_CONSENTIMIENTOS = 'consentimientos';
const VALIDEZ_S = 10 * 60;

const cache = new Map<string, { url: string; caduca: number }>();

/** Sube la foto y devuelve la ruta a guardar en `clientes.consentimiento_adjunto`. Borra las anteriores del cliente. */
export async function subirAdjuntoConsentimiento(clienteId: string, blob: Blob): Promise<string> {
  const ruta = `${clienteId}/${Date.now()}.jpg`;
  const { error } = await servidor().storage.from(BUCKET_CONSENTIMIENTOS).upload(ruta, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw new Error(traducir(error));
  await borrarAdjuntosConsentimiento(clienteId, ruta);
  return ruta;
}

/** URL firmada para `<img>` (null si no se puede). Las data URLs (demo) se devuelven tal cual. */
export async function urlAdjuntoConsentimiento(ruta: string | null | undefined): Promise<string | null> {
  if (!ruta) return null;
  if (/^(data:|blob:|https?:)/i.test(ruta)) return ruta;
  const c = cache.get(ruta);
  if (c && c.caduca > Date.now()) return c.url;
  const { data, error } = await servidor().storage.from(BUCKET_CONSENTIMIENTOS).createSignedUrl(ruta, VALIDEZ_S);
  if (error || !data?.signedUrl) {
    console.warn('[consentimientos] No se ha podido firmar la URL de la foto:', error ? mensajeError(error) : 'sin URL');
    return null;
  }
  cache.set(ruta, { url: data.signedUrl, caduca: Date.now() + VALIDEZ_S * 1000 - 30_000 });
  return data.signedUrl;
}

/** Borra las fotos del cliente (todas menos `conservar`, si se indica). No falla si no hay ninguna. */
export async function borrarAdjuntosConsentimiento(clienteId: string, conservar?: string): Promise<void> {
  const almacen = servidor().storage.from(BUCKET_CONSENTIMIENTOS);
  const { data, error } = await almacen.list(clienteId);
  if (error) { console.warn('[consentimientos] No se ha podido listar la carpeta:', mensajeError(error)); return; }
  const rutas = (data ?? []).map((o) => `${clienteId}/${o.name}`).filter((r) => r !== conservar);
  for (const r of rutas) cache.delete(r);
  if (rutas.length === 0) return;
  const { error: errorBorrado } = await almacen.remove(rutas);
  if (errorBorrado && !/not found|no existe/i.test(errorBorrado.message)) throw new Error(traducir(errorBorrado));
}

function traducir(e: { message: string }): string {
  const msg = mensajeError(e);
  if (/bucket not found/i.test(msg)) return 'El almacén de consentimientos no está configurado en el servidor (falta la migración 0025_consentimiento_adjunto.sql).';
  if (/payload too large|exceeded the maximum allowed size|too large/i.test(msg)) return 'La foto es demasiado grande (máximo 2 MB).';
  if (/row-level security|violates|unauthorized|permission/i.test(msg)) return 'No tienes permiso para guardar la foto de este cliente.';
  return msg;
}
