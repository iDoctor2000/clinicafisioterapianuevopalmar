/**
 * Cliente de Supabase. Solo se crea si el build lleva las variables
 * VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY; si no, la app funciona en modo demo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

/** true cuando la app está configurada contra un proyecto Supabase (modo producción). */
export function hayServidor(): boolean {
  return supabase !== null;
}

/** Cliente garantizado (lanza si no hay servidor: solo debe llamarse en modo SUPABASE). */
export function servidor(): SupabaseClient {
  if (!supabase) throw new Error('La app no está configurada con Supabase.');
  return supabase;
}

/** Convierte cualquier error (PostgREST, Auth, red) en un mensaje para el usuario. */
export function mensajeError(e: unknown): string {
  const msg = typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  if (!msg) return 'Se ha producido un error inesperado.';
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg)) {
    return 'No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
  }
  if (/jwt expired|invalid jwt|refresh token/i.test(msg)) return 'Tu sesión ha caducado. Vuelve a entrar.';
  return msg;
}
