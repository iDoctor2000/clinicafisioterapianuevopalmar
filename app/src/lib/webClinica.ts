/** URL de la web pública de la clínica: la app vive en `<web>/app/`, así que es la carpeta superior. */
export function urlWebClinica(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base.replace(/app\/?$/, ''), window.location.origin).toString();
}

/** Abre la web de la clínica. Si la app está instalada (pantalla completa), la abre aparte para no salir de la app. */
export function abrirWebClinica(): void {
  const instalada = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (instalada) window.open(urlWebClinica(), '_blank', 'noopener');
  else window.location.assign(urlWebClinica());
}
