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
        background_color: '#F5F5F0',
        theme_color: '#548C2F',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
