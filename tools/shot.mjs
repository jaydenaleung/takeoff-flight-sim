// Dev helper: screenshot a URL served by the Vite dev server.
// usage: node tools/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, w = '1280', h = '720', wait = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => errors.push('timeout waiting for __ready'));
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 12).join('\n'));
await browser.close();
