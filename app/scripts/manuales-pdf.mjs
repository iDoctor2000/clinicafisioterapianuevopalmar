// Convierte los manuales HTML en PDF (A4) con el Chromium de Playwright.
// Uso: cd app && npm run manuales   (los HTML están en docs/manuales; los PDF salen en app/public/manuales)
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(raiz, '../docs/manuales');
const salida = path.resolve(raiz, 'public/manuales');
fs.mkdirSync(salida, { recursive: true });
const exe = process.env.CHROME_PATH || execSync('ls -d /opt/pw-browsers/chromium*/chrome-linux*/chrome 2>/dev/null | head -1').toString().trim() || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
const pie = `<div style="width:100%;font-family:'Liberation Sans',Arial,sans-serif;font-size:8pt;color:#8A8A8A;padding:0 16mm;display:flex;justify-content:space-between;">
  <span>Nuevo Palmar Pilates · Clínica de Fisioterapia Nuevo Palmar</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;
for (const nombre of ['cliente', 'monitor', 'administrador']) {
  await page.goto('file://' + path.join(dir, `${nombre}.html`), { waitUntil: 'load' });
  await page.pdf({
    path: path.join(salida, `${nombre}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: pie,
    margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
  });
  console.log('ok', nombre);
}
await browser.close();
