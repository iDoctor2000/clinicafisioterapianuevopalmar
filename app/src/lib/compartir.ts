/** Utilidades para generar y compartir imágenes (tarjeta del QR, "Tu año en Pilates"). */

export function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function aPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se ha podido generar la imagen.'))), 'image/png'));
}

export function descargarBlob(blob: Blob, nombre: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

/**
 * Comparte una imagen con el menú del móvil (WhatsApp, Instagram…). Si el navegador no
 * sabe compartir archivos, la descarga. Devuelve 'compartida', 'descargada' o 'cancelada'.
 */
export async function compartirImagen(blob: Blob, nombre: string, texto: string, url?: string): Promise<'compartida' | 'descargada' | 'cancelada'> {
  const archivo = new File([blob], nombre, { type: 'image/png' });
  const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (n.share && (!n.canShare || n.canShare({ files: [archivo] }))) {
      await n.share({ files: [archivo], title: 'Nuevo Palmar Pilates', text: texto });
      return 'compartida';
    }
    if (n.share && url) {
      await n.share({ title: 'Nuevo Palmar Pilates', text: texto, url });
      return 'compartida';
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return 'cancelada';
    throw e;
  }
  descargarBlob(blob, nombre);
  return 'descargada';
}
