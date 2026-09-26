/**
 * Tratamiento de imágenes en el navegador (sin librerías): recorte cuadrado centrado y
 * reducción a un tamaño pequeño, en JPEG, antes de subir una foto de perfil.
 * Con 256×256 y calidad 0,8 una foto de cara pesa entre 10 y 30 KB.
 */

export const TAMANO_FOTO = 256;
export const CALIDAD_JPEG = 0.8;
/** Tamaño máximo del archivo original que aceptamos (los móviles actuales hacen fotos de 3-10 MB). */
export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

export class ErrorImagen extends Error {}

export function esImagen(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name);
}

/** Fuente decodificada con sus dimensiones (ImageBitmap o HTMLImageElement). */
type Fuente = { img: CanvasImageSource; ancho: number; alto: number; liberar: () => void };

/**
 * Decodifica la imagen respetando la orientación EXIF cuando el navegador lo permite
 * (`createImageBitmap` con `imageOrientation: 'from-image'`); si no, vía `<img>`
 * (los navegadores modernos también aplican EXIF ahí por defecto).
 */
async function decodificar(file: Blob): Promise<Fuente> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { img: bmp, ancho: bmp.width, alto: bmp.height, liberar: () => bmp.close() };
    } catch {
      /* formato no soportado por createImageBitmap (p. ej. HEIC en algunos navegadores): probamos con <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const el = new Image();
      el.onload = () => resolver(el);
      el.onerror = () => rechazar(new ErrorImagen('No se ha podido leer la imagen.'));
      el.src = url;
    });
    return { img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Rectángulo cuadrado centrado dentro de una imagen `ancho`×`alto`. */
export function recorteCuadrado(ancho: number, alto: number): { x: number; y: number; lado: number } {
  const lado = Math.max(1, Math.min(ancho, alto));
  return { x: Math.floor((ancho - lado) / 2), y: Math.floor((alto - lado) / 2), lado };
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    canvas.toBlob((b) => (b ? resolver(b) : rechazar(new ErrorImagen('No se ha podido generar la imagen.'))), tipo, calidad);
  });
}

/**
 * Recorta la imagen a un cuadrado centrado y la reduce a `lado`×`lado` píxeles en JPEG.
 * Lanza `ErrorImagen` con un mensaje para el usuario si el archivo no es una imagen válida.
 */
export async function recortarYReducir(file: File | Blob, lado = TAMANO_FOTO, calidad = CALIDAD_JPEG): Promise<Blob> {
  if (file instanceof File && !esImagen(file)) throw new ErrorImagen('El archivo elegido no es una imagen.');
  if (file.size > MAX_ORIGINAL_BYTES) throw new ErrorImagen('La imagen es demasiado grande. Elige otra o hazla con menos resolución.');
  if (file.size === 0) throw new ErrorImagen('El archivo está vacío.');
  const fuente = await decodificar(file);
  try {
    if (fuente.ancho < 32 || fuente.alto < 32) throw new ErrorImagen('La imagen es demasiado pequeña.');
    const r = recorteCuadrado(fuente.ancho, fuente.alto);
    const canvas = document.createElement('canvas');
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ErrorImagen('Este navegador no permite tratar imágenes.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Fondo blanco: los PNG con transparencia no quedan negros al pasar a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lado, lado);
    ctx.drawImage(fuente.img, r.x, r.y, r.lado, r.lado, 0, 0, lado, lado);
    return await aBlob(canvas, 'image/jpeg', calidad);
  } finally {
    fuente.liberar();
  }
}

/** Blob → data URL (modo demo: la foto se guarda dentro de la instantánea local). */
export function blobADataUrl(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const fr = new FileReader();
    fr.onload = () => resolver(String(fr.result));
    fr.onerror = () => rechazar(new ErrorImagen('No se ha podido leer la imagen.'));
    fr.readAsDataURL(blob);
  });
}
