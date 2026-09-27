// capnotice-probe — the capability card sits top-centre over everything until dismissed (the owner, 09-27: placement
// that dodged menus wandered over the body and half across panels), and dismisses itself for the visit after 30 s,
// paused while the pointer is on it. Headless Chromium runs WebGL 2, so the 'Running on WebGL 2' card is up.
//   bun tools/capnotice-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
const card = () => pg.evaluate(() => { const c = document.querySelector('.capnotice:not(#lite-banner)'); if (!c) return null; const r = c.getBoundingClientRect();
  const frames = [...document.querySelectorAll('.frame')].map((f) => +getComputedStyle(f).zIndex || 0);
  return { top: Math.round(r.top), cx: Math.round(r.left + r.width / 2 - innerWidth / 2), z: +getComputedStyle(c).zIndex, maxFrameZ: Math.max(0, ...frames) }; });
try {
  await pg.goto(`${world.origin}/?world=staging&name=capprobe&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => !!document.querySelector('.capnotice .cn-ok'), null, { timeout: 90000 });
  const t0 = Date.now(); const c1 = await card();
  console.log('  ·', JSON.stringify(c1));
  check('the card is top-centre', c1 && c1.top === 8 && Math.abs(c1.cx) <= 1, JSON.stringify(c1));
  check('…over every frame', c1 && c1.z > c1.maxFrameZ, JSON.stringify(c1));
  // hover: the timer pauses
  const b = await pg.locator('.capnotice .cn-item').first().boundingBox();
  await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await pg.waitForTimeout(Math.max(0, 33000 - (Date.now() - t0)));
  check('hovered, it stays past 30 s', !!(await card()));
  await pg.mouse.move(2, 400);   // off it: the 30 s starts again
  await pg.waitForTimeout(31500);
  check('…and 30 s after the pointer leaves, it dismisses itself', (await card()) === null);
  check('…for this visit only (not "don\'t show again")', !(await pg.evaluate(() => (localStorage.getItem('ew-capnotice-dismissed') || '').includes('webgl'))));
  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
