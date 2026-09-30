// gpulost-probe — real Chromium: kill the WebGL context (WEBGL_lose_context), expect a reload into the
// same world without ?xr=1 and a 'Graphics reset' card; kill it again inside 2 min, expect NO reload
// and a 'Graphics lost again' card.   bun tools/gpulost-probe.mjs   (an owned server; SHOT=<png> saves the last frame)
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check: ok, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser();
try {
  const p = await page(); const errs = [], tees = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (/\[gpu\]/.test(m.text())) tees.push(m.text()); });
  const booted = () => p.waitForFunction(() => globalThis.__gpuLost && globalThis.EW?.renderer, null, { timeout: 90000 });
  await p.goto(`${world.origin}/?world=gpulost&name=g&key=${world.key}&xr=0&vrprobe=1`); await booted();
  const kill = () => p.evaluate(() => { const gl = globalThis.EW.renderer.backend.gl; gl.getExtension('WEBGL_lose_context').loseContext(); });
  const nav1 = p.waitForEvent('framenavigated', { timeout: 15000 }).then(() => true, () => false);
  await kill();
  ok('a lost context reloads the page', await nav1);
  await p.waitForFunction(() => globalThis.__ewLite !== undefined, null, { timeout: 30000 });
  if (await p.evaluate(() => !globalThis.__ewLite)) await booted();
  ok('…into the FULL client, not lite (a recovery is not a crash)', await p.evaluate(() => globalThis.__ewLite === false), await p.evaluate(() => String(globalThis.__ewLiteWhy)));
  ok('…into the same world, without the XR boot flag', /world=gpulost/.test(p.url()) && !/[?&]xr=/.test(p.url()), p.url());
  await p.waitForTimeout(3000);
  for (const t of ['go in anyway']) { const x = p.getByText(t, { exact: true }); if (await x.isVisible().catch(() => false)) await x.click(); }
  const card1 = await p.evaluate(() => [...document.querySelectorAll('.capnotice .cn-item')].map((i) => i.textContent).join(' | '));
  ok("…and says why on the capability card ('Graphics reset')", /Graphics reset/.test(card1), card1.slice(0, 160));
  const nav2 = p.waitForEvent('framenavigated', { timeout: 6000 }).then(() => true, () => false);
  await kill();
  ok('a second loss inside 2 min does NOT reload (no loop)', !(await nav2));
  const card2 = await p.evaluate(() => [...document.querySelectorAll('.capnotice .cn-item')].map((i) => i.textContent).join(' | '));
  ok("…and says so ('Graphics lost again')", /Graphics lost again/.test(card2), card2.slice(0, 160));
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log('  · tees:', tees.join(' ;; ').slice(0, 300));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
} catch (e) { ok('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
