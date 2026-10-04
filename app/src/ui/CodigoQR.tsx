import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, Printer, QrCode, Share2 } from 'lucide-react';
import { Boton } from './Boton';
import { Hoja } from './Hoja';
import { toast } from './Toast';
import { cn } from '@/lib/cn';

/** Dirección pública de la app (con dominio propio: https://www.fisioterapianuevopalmar.com/app/). */
export function urlApp(): string {
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

const COLOR_OSCURO = '#2B2B2B';
const COLOR_CLARO = '#FFFFFF';

/** Genera una tarjeta PNG (cartel) con el logotipo, el QR, el texto y la dirección. */
async function tarjetaPng(url: string): Promise<Blob> {
  const W = 1200, H = 1600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#F7F3EE'; g.fillRect(0, 0, W, H);
  // marco
  g.strokeStyle = '#B9A795'; g.lineWidth = 4; g.strokeRect(40, 40, W - 80, H - 80);
  // logotipo
  try {
    const logo = await cargarImagen(`${import.meta.env.BASE_URL}logo-marca.png`);
    const lw = 560, lh = (logo.height / logo.width) * lw;
    g.drawImage(logo, (W - lw) / 2, 110, lw, lh);
  } catch { /* sin logotipo */ }
  // QR
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: COLOR_OSCURO, light: COLOR_CLARO } });
  g.fillStyle = COLOR_CLARO;
  roundRect(g, (W - 780) / 2, 470, 780, 780, 36); g.fill();
  g.drawImage(qr, (W - 720) / 2, 500, 720, 720);
  // textos
  g.fillStyle = '#2B2B2B'; g.textAlign = 'center';
  g.font = '600 54px Georgia, "Playfair Display", serif';
  g.fillText('Reserva tus clases desde el móvil', W / 2, 1345);
  g.fillStyle = '#5C5C5C';
  g.font = '400 34px Inter, system-ui, sans-serif';
  g.fillText('Escanea el código con la cámara del móvil', W / 2, 1405);
  g.fillStyle = '#7F6D57';
  g.font = '600 34px Inter, system-ui, sans-serif';
  g.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 1480);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se ha podido generar la imagen.'))), 'image/png'));
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Botón redondo con el icono de QR para la cabecera. */
export function BotonQR({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Código QR de acceso a la app" title="Código QR de la app"
      className={cn('h-10 w-10 rounded-full flex items-center justify-center text-ink-soft hover:bg-beige-100 hover:text-ink tap', className)}>
      <QrCode className="h-6 w-6" />
    </button>
  );
}

/** Hoja con el QR de acceso a la app: compartir, descargar, imprimir o copiar el enlace. */
export function HojaQR({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const url = urlApp();
  const [svg, setSvg] = useState('');
  const [ocupado, setOcupado] = useState<'compartir' | 'descargar' | 'imprimir' | null>(null);

  useEffect(() => {
    if (!abierta) return;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: COLOR_OSCURO, light: COLOR_CLARO } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [abierta, url]);

  const compartir = async () => {
    setOcupado('compartir');
    try {
      const blob = await tarjetaPng(url);
      const archivo = new File([blob], 'nuevo-palmar-pilates-qr.png', { type: 'image/png' });
      const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (n.share && (!n.canShare || n.canShare({ files: [archivo] }))) {
        await n.share({ files: [archivo], title: 'Nuevo Palmar Pilates', text: `Reserva tus clases en la app de Nuevo Palmar Pilates: ${url}` });
      } else if (n.share) {
        await n.share({ title: 'Nuevo Palmar Pilates', text: 'Reserva tus clases en la app de Nuevo Palmar Pilates', url });
      } else {
        descargarBlob(blob);
        toast.ok('Imagen del QR descargada.');
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) toast.error('No se ha podido compartir. Prueba a descargar la imagen.');
    } finally { setOcupado(null); }
  };

  const descargar = async () => {
    setOcupado('descargar');
    try { descargarBlob(await tarjetaPng(url)); toast.ok('Imagen del QR descargada.'); }
    catch { toast.error('No se ha podido generar la imagen.'); }
    finally { setOcupado(null); }
  };

  const imprimir = async () => {
    setOcupado('imprimir');
    try {
      const svgImpresion = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
      const logo = new URL(`${import.meta.env.BASE_URL}logo-marca.png`, window.location.origin).toString();
      const w = window.open('', '_blank');
      if (!w) { toast.error('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes o usa "Descargar imagen".'); return; }
      w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Código QR · Nuevo Palmar Pilates</title>
<style>@page{size:A4;margin:18mm}body{font-family:Georgia,serif;color:#2B2B2B;text-align:center;margin:0}
.t{border:2px solid #B9A795;border-radius:18px;padding:16mm 12mm;max-width:150mm;margin:0 auto}
img{width:90mm}.qr{width:110mm;margin:10mm auto}.qr svg{width:100%;height:auto}
h1{font-size:22pt;font-weight:600;margin:4mm 0}p{font-family:Arial,sans-serif;font-size:12pt;color:#5C5C5C;margin:2mm 0}
.u{color:#7F6D57;font-weight:bold;font-size:13pt}</style></head><body><div class="t">
<img src="${logo}" alt="Nuevo Palmar Pilates"><div class="qr">${svgImpresion}</div>
<h1>Reserva tus clases desde el móvil</h1><p>Escanea el código con la cámara del móvil</p>
<p class="u">${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p></div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
      w.document.close();
    } finally { setOcupado(null); }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); toast.ok('Enlace copiado.'); }
    catch { toast.info(url); }
  };

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo="Código QR de la app">
      <div className="space-y-4 text-center">
        <p className="text-ink-soft">Escaneándolo con la cámara del móvil se abre la app de Nuevo Palmar Pilates. Compártelo con los alumnos o imprímelo para el centro.</p>
        <div className="mx-auto w-60 max-w-full rounded-3xl bg-white p-4 shadow-card border border-beige-200">
          {svg ? <div className="[&>svg]:w-full [&>svg]:h-auto" role="img" aria-label={`Código QR de ${url}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="aspect-square" />}
        </div>
        <button type="button" onClick={() => void copiar()} className="inline-flex items-center gap-1.5 text-sm font-semibold text-beige-600 tap break-all"><Copy className="h-4 w-4 shrink-0" /> {url.replace(/^https?:\/\//, '')}</button>
        <div className="grid gap-2">
          <Boton ancho onClick={() => void compartir()} cargando={ocupado === 'compartir'}><Share2 className="h-5 w-5" /> Compartir</Boton>
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="secundario" onClick={() => void descargar()} cargando={ocupado === 'descargar'}><Download className="h-5 w-5" /> Descargar</Boton>
            <Boton variante="secundario" onClick={() => void imprimir()} cargando={ocupado === 'imprimir'}><Printer className="h-5 w-5" /> Imprimir</Boton>
          </div>
        </div>
      </div>
    </Hoja>
  );
}

function descargarBlob(blob: Blob) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = 'nuevo-palmar-pilates-qr.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
