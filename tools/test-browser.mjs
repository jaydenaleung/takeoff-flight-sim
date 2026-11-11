// Headless browser smoke test: loads the simulator, flies a take-off with real key presses,
// exercises views and the radio, and fails on any console error.
//   node tools/test-browser.mjs [baseUrl] [outDir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'test-output';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

async function open(query, w = 1440, h = 860) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  return page;
}
const state = (page) => page.evaluate(() => {
  const f = window.__app.flight, o = f.fm.out;
  return { ias: o.ias, alt: o.altFt, agl: o.agl, gs: o.gs, onGround: o.onGround, pitch: o.pitch * 57.3, gear: f.fm.gear, crashed: f.fm.crashed && f.fm.crashed.reason, phase: window.__app.ui.atc.phase, log: window.__app.ui.atc.log.length, view: window.__app.views.mode, tiles: window.__app.world.terrain.meshCount };
});

// ---- 1. menu
{
  const page = await open('');
  const n = await page.locator('.fleet .ac').count();
  check('menu lists 12 aircraft', n === 12, `${n}`);
  await page.locator('.fleet .ac', { hasText: 'F-22A' }).click();
  await page.waitForTimeout(800);
  check('spec sheet updates', (await page.locator('.sheet h2').textContent()).includes('F-22A'));
  await page.screenshot({ path: `${out}/1-menu.png` });
  await page.close();
}
// ---- 2. gate start: radio flow with real key presses
{
  const page = await open('?fly&ac=a20n&dep=KLAX&dest=KSFO&start=gate&hour=8&wx=clear');
  const phase = (p, ms = 60000) => page.waitForFunction((x) => window.__app.ui.atc.phase === x, p, { timeout: ms }).catch(() => {});
  const readback = (ms = 60000) => page.waitForFunction(() => !!window.__app.ui.atc.readback, null, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.keyboard.press('Tab');                 // ATIS -> clearance
  await page.waitForTimeout(600);
  await page.keyboard.press('F1');                  // request clearance
  await readback();
  await page.keyboard.press('F1');                  // read back
  await phase('cleared');
  const s = await state(page);
  check('clearance obtained by radio', s.phase === 'cleared', s.phase);
  check('radio log has traffic', s.log >= 4, `${s.log} entries`);
  await page.screenshot({ path: `${out}/2-gate.png` });
  await page.close();
}
// ---- 3. take-off flown with the keyboard
{
  const page = await open('?fly&ac=b738&dep=KSFO&dest=KLAX&start=runway&hour=10&wx=scattered');
  await page.evaluate(() => { window.__app.flight.timeScale = 4; });
  await page.keyboard.press('KeyP');                // release the parking brake
  await page.keyboard.press('Home');                // full thrust
  let s, t0 = Date.now(), rotating = false;
  for (;;) {
    await page.waitForTimeout(400);
    s = await state(page);
    if (s.crashed || Date.now() - t0 > 300000) break;
    if (!rotating && s.ias > 140) { await page.keyboard.down('ArrowDown'); rotating = true; }
    if (rotating && s.pitch > 13) { await page.keyboard.up('ArrowDown'); }
    if (rotating && s.pitch < 9 && !s.onGround) { await page.keyboard.down('ArrowDown'); }
    if (s.agl > 120) break;
  }
  await page.keyboard.up('ArrowDown');
  check('take-off with keyboard', !s.crashed && s.agl > 100, s.crashed || `agl ${s.agl.toFixed(0)} m, ias ${s.ias.toFixed(0)} kt`);
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyZ');                // autopilot
  await page.keyboard.press('KeyX');                // autothrottle
  await page.evaluate(() => { window.__app.flight.timeScale = 1; });
  await page.waitForFunction(() => window.__app.flight.fm.gear < 0.6, null, { timeout: 120000 }).catch(() => {});
  s = await state(page);
  check('gear retracts', s.gear < 0.6, s.gear.toFixed(2));
  const info = await page.evaluate(() => { const a = window.__app; return { tris: a.renderer.info.render.triangles, calls: a.renderer.info.render.calls, shown: a.world.terrain.shown, fps: a.fps }; });
  console.log(`     render: ${info.tris.toLocaleString()} triangles, ${info.calls} draw calls, ${info.shown} terrain tiles shown, ${info.fps.toFixed(1)} fps (software GL)`);
  check('autopilot engaged', await page.evaluate(() => window.__app.flight.ap.on));
  check('terrain tiles loaded', s.tiles > 40, `${s.tiles}`);
  await page.screenshot({ path: `${out}/3-climb.png` });
  await page.keyboard.press('Digit1');              // cockpit view
  await page.waitForTimeout(1200);
  check('cockpit view', (await state(page)).view === 'cockpit');
  await page.screenshot({ path: `${out}/4-cockpit.png` });
  await page.keyboard.press('KeyN'); await page.waitForTimeout(500);
  check('large map opens', await page.locator('.bigmap.on').count() === 1);
  await page.keyboard.press('KeyN');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check('pause menu', await page.locator('.overlay.on.pause').count() === 1);
  await page.keyboard.press('Escape');
  await page.close();
}
// ---- 4. night ILS approach, autoland armed
{
  const page = await open('?fly&ac=a359&dep=KLAX&dest=KSFO&start=final&hour=21.5&wx=clear');
  await page.keyboard.press('KeyZ'); await page.keyboard.press('KeyX'); await page.keyboard.press('KeyV');
  await page.waitForTimeout(5000);
  const armed = await page.evaluate(() => { const a = window.__app.flight.ap; return a.armed.loc || a.lat === 'LOC'; });
  check('approach armed on final', armed);
  await page.screenshot({ path: `${out}/5-night-final.png` });
  await page.close();
}
// ---- 5. fighter with HUD
{
  const page = await open('?fly&ac=f22&dep=KEDW&dest=KLSV&start=cruise&hour=17.5&wx=scattered&view=cockpit');
  await page.waitForTimeout(3000);
  check('fighter HUD visible', await page.evaluate(() => getComputedStyle(document.querySelector('.fhud')).display !== 'none'));
  await page.screenshot({ path: `${out}/6-fighter-hud.png` });
  await page.keyboard.press('Digit2'); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/7-fighter-chase.png` });
  await page.close();
}
await browser.close();
const real = errors.filter((e) => !/favicon|speechSynthesis|AudioContext/i.test(e));
check('no console errors', real.length === 0, real.slice(0, 5).join(' | '));
console.log(failed ? `\n${failed} browser check(s) FAILED` : '\nAll browser checks passed');
process.exit(failed ? 1 : 0);
