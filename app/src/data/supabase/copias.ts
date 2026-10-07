/** Última copia de seguridad anotada por la tarea nocturna (tabla de 0015; solo el administrador la lee). */
import { servidor } from './cliente';

export interface UltimaCopia { hechaEl: string; bytes: number; archivo: string }

export async function ultimaCopia(): Promise<UltimaCopia | null> {
  const r = await servidor().from('copias_seguridad').select('hecha_el, bytes, archivo').order('hecha_el', { ascending: false }).limit(1);
  if (r.error) throw r.error;
  const f = (r.data as { hecha_el: string; bytes: number; archivo: string }[] | null)?.[0];
  return f ? { hechaEl: f.hecha_el, bytes: Number(f.bytes), archivo: f.archivo } : null;
}
