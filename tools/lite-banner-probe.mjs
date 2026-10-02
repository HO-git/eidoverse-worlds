// lite-banner-probe — on a PHONE a died boot demotes to lite and says so in a pinned card (under the emote
// row, surviving the history replay) whose first button enters the 3D world; someone who asked for lite gets
// the card too (a way back, never "type ?lite=0"); a DESKTOP whose boot died is not demoted at all, and gets
// a status-strip pill offering the light version instead (owner, 10-01: lite is default only on mobile).
//   bun tools/lite-banner-probe.mjs [origin]   (no origin: an owned scratch world, probe-harness)
// Mutation witnessed red: drop the liteBanner(WHY) call in lite.js.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, ownedWorld } from './probe-harness.mjs';
const world = await ownedWorld({ live: process.argv[2] || null });
const O = world.origin, K = encodeURIComponent(world.key);
const SHOT = process.env.SHOT ?? join(tmpdir(), 'lite-banner.png');
let fail = 0; const ok = (n, c, d = '') => { if (!c) fail++; console.log(`  ${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };
const { browser: b } = await launchBrowser();
try {
  // seed chat so history replay would bury a chat line
  const ws = new WebSocket(O.replace('http', 'ws') + '/ws?name=talker');
  await new Promise((r, j) => { const t = setTimeout(() => j(new Error(`no snapshot from ${O} in 20 s`)), 20000);
    ws.onerror = () => { clearTimeout(t); j(new Error(`websocket to ${O} failed`)); };
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', world: 'busy', id: 'talker', token: world.key }));
    ws.onmessage = e => { if (JSON.parse(e.data).type === 'snapshot') { clearTimeout(t); r(); } }; });
  for (let i = 0; i < 40; i++) ws.send(JSON.stringify({ type: 'verb', verb: 'say', args: { text: `chatter line ${i}` } }));
  await new Promise(r => setTimeout(r, 800)); ws.close();
  const PHONE = { viewport: { width: 360, height: 700 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 4a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' };
  const DESK = { viewport: { width: 1100, height: 700 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
  const run = async (label, q, seed, dev = PHONE) => {
    const ctx = await b.newContext(dev); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    if (seed) await p.addInitScript(() => localStorage.setItem('ew-boot-attempt:busy', String(Date.now() - 5000)));
    await p.goto(`${O}/?world=busy&name=${label}&key=${K}${q}`);
    await p.waitForFunction(() => globalThis.__ewLite !== undefined && document.querySelector('#lite-emote-host #hud'), null, { timeout: 30000 });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => { const bn = document.getElementById('lite-banner'); const rc = bn?.getBoundingClientRect();
      return { lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy, banner: bn?.textContent ?? null, onScreen: !!rc && rc.top >= 0 && rc.bottom <= innerHeight && rc.width > 0,
        clearOfEmotes: (() => { const e = document.getElementById('lite-emote-host')?.getBoundingClientRect(); return !bn || !e || rc.top >= e.bottom; })(),
        chatTail: [...document.querySelectorAll('#chatlog > *')].slice(-1).map(e => e.textContent.slice(0, 30))[0] };
    });
    return { p, ctx, r, errs };
  };
  let { p, ctx, r, errs } = await run('crashed', '', true);
  console.log('phone crash:', JSON.stringify(r));
  ok('a phone whose last boot died is lite (why=crash)', r.lite === true && r.why === 'crash');
  ok('…and SAYS so in a pinned card, on screen after the history replay', !!r.banner && /didn't finish loading/.test(r.banner) && r.onScreen, r.chatTail);
  ok('…below the emote row, not over it (360 px wide, the row wraps)', r.clearOfEmotes === true);
  ok('…it names the way in (the ∃ logo), and its one button is got it', /Tap the \u2203 Eidoverse logo/.test(r.banner) && await p.evaluate(() => { const c = document.getElementById('lite-banner'); return c.classList.contains('capnotice') && [...c.querySelectorAll('button')].map(b => b.textContent).join('|') === 'got it'; }));
  ok('…the ∃ is a real tap target (≥ 44 px) leading the top bar', await p.evaluate(() => { const h = document.getElementById('hud'); const r = h.getBoundingClientRect(); return h.parentElement.id === 'lite-emote-host' && h.parentElement.firstElementChild === h && r.height >= 44 && r.width >= 44 && !h.disabled; }));
  const L = await p.evaluate(() => { const R = (q) => document.querySelector(q)?.getBoundingClientRect(); const ov = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const bar = R('#lite-emote-host'), card = R('#lite-banner'), chat = R('.frame.chat-frame'), dock = R('#hud'), gear = R('.chat-gear'), input = R('#chatline'), hud = document.getElementById('hud');
    const cs = getComputedStyle(document.querySelector('.frame.chat-frame'));
    return { dockInBar: !!dock && dock.top >= bar.top && dock.bottom <= bar.bottom, dockClearOfCompose: !ov(dock, gear) && !ov(dock, input),
      chatBelowCard: chat.top >= card.bottom, chatToBottom: Math.abs(innerHeight - chat.bottom) <= 1, chatFullWidth: chat.left <= 0.5 && Math.abs(innerWidth - chat.right) <= 0.5,
      square: parseFloat(cs.borderTopLeftRadius) === 0 && parseFloat(cs.borderBottomRightRadius) === 0,
      gap: Math.round(chat.top - card.bottom), cardFullWidth: card.left <= 12 && innerWidth - card.right <= 12, hudVisible: !!hud && getComputedStyle(hud).display !== 'none' }; });
  console.log('phone layout:', JSON.stringify(L));
  ok('layout: the ∃ lives in the top bar, clear of the chat compose row', L.dockInBar && L.dockClearOfCompose);
  ok('layout: the chat is edge to edge — full width, to the bottom, square corners, no dead gap', L.chatBelowCard && L.chatToBottom && L.chatFullWidth && L.square && L.gap <= 16, JSON.stringify(L));
  ok('layout: the card spans the column; the ∃ shows', L.cardFullWidth && L.hudVisible);
  await p.screenshot({ path: SHOT.replace('.png', '-phone.png') });
  let nav = p.waitForURL(/lite=0/, { timeout: 10000 }).then(() => true, () => false);
  await p.locator('#hud').click();
  ok('tapping the ∃ leaves for the full world (?lite=0)', await nav, p.url());
  ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200)); await ctx.close();

  { // a FRESH phone (no history) starts in lite; choosing 3D is remembered on that device
    const ctx = await b.newContext(PHONE); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`${O}/?world=busy&name=freshphone&key=${K}`);
    await p.waitForFunction(() => globalThis.__ewLite !== undefined && document.querySelector('#lite-emote-host #hud'), null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const f = await p.evaluate(() => ({ lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy, banner: document.getElementById('lite-banner')?.textContent ?? '' }));
    ok('a fresh phone starts in lite (why=phone), and the card says why: on a phone', f.lite === true && f.why === 'phone' && /You're on a phone/.test(f.banner), JSON.stringify(f));
    const nav = p.waitForURL(/lite=0/, { timeout: 10000 }).then(() => true, () => false);
    await p.locator('#hud').click();
    ok('…the ∃ goes full and remembers it (ew-lite=0)', await nav && await p.evaluate(() => localStorage.getItem('ew-lite') === '0'));
    await p.goto(`${O}/?world=busy&name=freshphone&key=${K}`);
    await p.waitForFunction(() => globalThis.__ewLite !== undefined, null, { timeout: 30000 });
    const g = await p.evaluate(() => ({ lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy }));
    ok('…so the next plain visit on that phone is full (why=saved)', g.lite === false && g.why === 'saved', JSON.stringify(g));
    ok('no page errors on the fresh phone', errs.length === 0, errs.join(' | ').slice(0, 200)); await ctx.close();
  }

  ({ p, ctx, r, errs } = await run('asked', '&lite=1', false, DESK));
  ok('someone who ASKED for lite (a desktop link) gets the card too, naming the way back', r.lite === true && r.why === 'url' && /This link opens the light version/.test(r.banner ?? '') && /Eidoverse logo/.test(r.banner ?? ''), JSON.stringify(r));
  await p.screenshot({ path: SHOT });
  nav = p.waitForURL(/lite=0/, { timeout: 10000 }).then(() => true, () => false);
  await p.locator('#hud').click();
  ok('the ∃ leaves for the full world at desktop width too', await nav, p.url()); await ctx.close();

  ({ p, ctx, r, errs } = await run('dismiss', '', true));
  await p.evaluate(() => { globalThis.__roOff = 0; const d = ResizeObserver.prototype.disconnect; ResizeObserver.prototype.disconnect = function () { globalThis.__roOff++; return d.call(this); }; });
  await p.locator('#lite-banner .cn-ok').click();
  ok('got it dismisses it', await p.evaluate(() => !document.getElementById('lite-banner')));
  await p.waitForTimeout(200);
  ok('…and the chat grows flush up to the bar', await p.evaluate(() => Math.abs(document.querySelector('.frame.chat-frame').getBoundingClientRect().top - document.getElementById('lite-emote-host').getBoundingClientRect().bottom) <= 1));
  ok('…and stops following the emote row (its ResizeObserver disconnects)', await p.evaluate(() => globalThis.__roOff === 1)); await ctx.close();

  { // a DESKTOP whose last boot died: full client, plus a pill offering the light version
    const ctx = await b.newContext(DESK); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => localStorage.setItem('ew-boot-attempt:busy', String(Date.now() - 5000)));
    await p.goto(`${O}/?world=busy&name=deskcrash&key=${K}`);
    await p.waitForFunction(() => globalThis.__ewLite !== undefined, null, { timeout: 30000 });
    const d = await p.evaluate(() => ({ lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy }));
    ok('a desktop whose last boot died is NOT demoted (full, why=retry)', d.lite === false && d.why === 'retry', JSON.stringify(d));
    const chip = await p.waitForSelector('#stchip-lite-retry', { timeout: 60000 }).then(() => true, () => false);
    ok('…and gets the "last load stalled" pill', chip);
    if (chip) {
      await p.locator('#stchip-lite-retry').click();
      ok('…which offers the light version as a button', await p.evaluate(() => [...document.querySelectorAll('#stpop button')].some(b => /light version/.test(b.textContent))));
      await p.screenshot({ path: SHOT.replace('.png', '-desktop-retry.png') });
    }
    ok('no page errors on the desktop retry', errs.length === 0, errs.join(' | ').slice(0, 200)); await ctx.close();
  }
} catch (e) { fail++; console.log('PROBE FAILED', e.message); } finally { await b.close(); await world.close(); }
console.log(fail ? `${fail} failed` : 'all green'); process.exit(fail ? 1 : 0);
