import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// La app se publica bajo /app/ dentro de la web de la clínica (GitHub Pages).
// En GitHub Pages sin dominio propio la ruta es /<nombre-del-repo>/app/ (lo fija el workflow con VITE_BASE).
const base = process.env.VITE_BASE ?? '/app/';

export default defineConfig({
  base,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      // Service worker propio (src/sw.ts): precache + navegación offline + notificaciones push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Nuevo Palmar Pilates',
        short_name: 'Pilates NP',
        description: 'Reservas y gestión del centro de Pilates de Clínica Nuevo Palmar',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#EDE4DB',
        theme_color: '#3A3A3A',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  // docs/PRIVACIDAD.md (fuera de app/) se importa con `?raw` en src/app/Privacidad.tsx: el servidor de
  // desarrollo debe poder servirlo. En el build se incrusta en el bundle.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
