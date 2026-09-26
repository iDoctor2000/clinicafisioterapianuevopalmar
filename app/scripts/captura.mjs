import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
const [,, url, out, w='390', h='844', actions=''] = process.argv;
const exe = execSync('ls -d /opt/pw-browsers/chromium*/chrome-linux*/chrome 2>/dev/null | head -1').toString().trim() || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text()); });
await page.goto(url, { waitUntil: 'networkidle' });
for (const a of actions.split(';').filter(Boolean)) {
  const [tipo, sel] = a.split('=');
  if (tipo === 'click') await page.click(sel);
  if (tipo === 'text') await page.getByText(sel, { exact: false }).first().click();
  if (tipo === 'wait') await page.waitForTimeout(+sel);
}
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('saved', out);
