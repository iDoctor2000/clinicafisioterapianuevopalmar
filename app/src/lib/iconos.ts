/**
 * Iconos de actividad incluidos en la app (y en la web, en `assets/iconos/`).
 * El campo `icono` de una actividad puede ser una de estas claves o la URL de una imagen subida.
 */
export const ICONOS_ACTIVIDAD = [
  { clave: 'reformer', nombre: 'Reformer con torre' },
  { clave: 'suelo', nombre: 'Pilates suelo' },
  { clave: 'funcional', nombre: 'Funcional' },
  { clave: 'geronto', nombre: 'Gerontopilates' },
  { clave: 'barre', nombre: 'Barre' },
  { clave: 'yoga-flow', nombre: 'Yoga flow' },
  { clave: 'hatha-yoga', nombre: 'Hatha yoga' },
  { clave: 'core-stretch', nombre: 'Core & stretch' },
  { clave: 'hipopresivos', nombre: 'Hipopresivos' },
] as const;

export type ClaveIcono = (typeof ICONOS_ACTIVIDAD)[number]['clave'];

export function esClaveIcono(v: string): v is ClaveIcono {
  return ICONOS_ACTIVIDAD.some((i) => i.clave === v);
}

/** URL de la imagen del icono (clave incluida o URL externa); null si la actividad no tiene icono. */
export function urlIcono(icono: string): string | null {
  const v = (icono || '').trim();
  if (!v) return null;
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('data:') || v.startsWith('../') || v.startsWith('/')) return v;
  if (esClaveIcono(v)) return `${import.meta.env.BASE_URL}iconos/${v}.png`;
  return null;
}
