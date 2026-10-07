/**
 * Lluvia de confeti en los colores de la marca, sin librerías. Se lanza con `lanzarConfeti()`
 * y desaparece sola. Respeta "reducir movimiento" del sistema.
 */
const COLORES = ['#A08D79', '#CFC0B0', '#86735F', '#E1D5C8', '#2F2F2F', '#C9713F', '#D95A6A', '#FFFFFF'];

export function lanzarConfeti({ piezas = 160, duracionMs = 3200 }: { piezas?: number; duracionMs?: number } = {}): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  Object.assign(c.style, { position: 'fixed', inset: '0', width: `${W}px`, height: `${H}px`, pointerEvents: 'none', zIndex: '90' });
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  const g = c.getContext('2d');
  if (!g) { c.remove(); return; }
  g.scale(dpr, dpr);
  const p = Array.from({ length: piezas }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.5,
    y: H * 0.35 + (Math.random() - 0.5) * 60,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 15 - 5,
    w: 6 + Math.random() * 7, h: 9 + Math.random() * 9,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
    color: COLORES[Math.floor(Math.random() * COLORES.length)],
    redondo: Math.random() < 0.3,
  }));
  const inicio = performance.now();
  const paso = (t: number) => {
    const pasado = t - inicio;
    g.clearRect(0, 0, W, H);
    const alfa = Math.max(0, 1 - Math.max(0, pasado - duracionMs * 0.6) / (duracionMs * 0.4));
    for (const q of p) {
      q.vy += 0.32; q.vx *= 0.985; q.vy *= 0.985;
      q.x += q.vx; q.y += q.vy; q.r += q.vr;
      g.save(); g.globalAlpha = alfa; g.translate(q.x, q.y); g.rotate(q.r); g.fillStyle = q.color;
      if (q.color === '#FFFFFF') { g.strokeStyle = '#CFC0B0'; g.lineWidth = 1; }
      if (q.redondo) { g.beginPath(); g.arc(0, 0, q.w / 2, 0, Math.PI * 2); g.fill(); }
      else { g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.r))); }
      g.restore();
    }
    if (pasado < duracionMs) requestAnimationFrame(paso); else c.remove();
  };
  requestAnimationFrame(paso);
}
