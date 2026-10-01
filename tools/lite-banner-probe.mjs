// lite-banner-probe — a demotion we INFERRED (crash, ram, no-gpu) says so in a pinned banner that
// survives the history replay and sits under the emote row; one the person ASKED for does not.
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
  const run = async (label, q, seed) => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 700 } }); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    if (seed) await p.addInitScript(() => localStorage.setItem('ew-boot-attempt:busy', String(Date.now() - 5000)));
    await p.goto(`${O}/?world=busy&name=${label}&key=${K}${q}`);
    await p.waitForFunction(() => globalThis.__ewLite !== undefined && document.getElementById('lite-dock'), null, { timeout: 30000 });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => { const bn = document.getElementById('lite-banner'); const rc = bn?.getBoundingClientRect();
      return { lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy, banner: bn?.textContent ?? null, onScreen: !!rc && rc.top >= 0 && rc.bottom <= innerHeight && rc.width > 0,
        clearOfEmotes: (() => { const e = document.getElementById('lite-emote-host')?.getBoundingClientRect(); return !bn || !e || rc.top >= e.bottom; })(),
        chatTail: [...document.querySelectorAll('#chatlog > *')].slice(-1).map(e => e.textContent.slice(0, 30))[0] };
    });
    return { p, ctx, r, errs };
  };
  let { p, ctx, r, errs } = await run('crashed', '', true);
  console.log('crash:', JSON.stringify(r));
  ok('a crash demotion is lite (why=crash)', r.lite === true && r.why === 'crash');
  ok('…and SAYS so in a pinned banner, on screen after the history replay', !!r.banner && /didn't finish loading/.test(r.banner) && r.onScreen, r.chatTail);
  ok('…below the emote row, not over it', r.clearOfEmotes === true);
  await p.screenshot({ path: SHOT });
  await p.setViewportSize({ width: 390, height: 780 }); await p.waitForTimeout(400);
  ok('…and still clear of the emote row at phone width (the row wraps)', await p.evaluate(() => document.getElementById('lite-banner').getBoundingClientRect().top >= document.getElementById('lite-emote-host').getBoundingClientRect().bottom));
  await p.screenshot({ path: SHOT.replace('.png', '-phone.png') });
  const nav = p.waitForURL(/lite=0/, { timeout: 10000 }).then(() => true, () => false);
  ok('…styled as the capability card, one button: got it', await p.evaluate(() => { const c = document.getElementById('lite-banner'); return c.classList.contains('capnotice') && [...c.querySelectorAll('button')].map(b => b.textContent).join('|') === 'got it' && /\u{1F30D}/u.test(c.textContent); }));
  await p.locator('#lite-dock button[data-id=full]').click();
  ok('the \u{1F30D} it points at leaves for the full world (?lite=0)', await nav, p.url());
  ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200)); await ctx.close();
  ({ p, ctx, r, errs } = await run('asked', '&lite=1', false));
  ok('someone who ASKED for lite gets no banner', r.lite === true && r.why === 'url' && r.banner === null, JSON.stringify(r)); await ctx.close();
  ({ p, ctx, r, errs } = await run('dismiss', '', true));
  await p.evaluate(() => { globalThis.__roOff = 0; const d = ResizeObserver.prototype.disconnect; ResizeObserver.prototype.disconnect = function () { globalThis.__roOff++; return d.call(this); }; });
  await p.locator('#lite-banner .cn-ok').click();
  ok('got it dismisses it', await p.evaluate(() => !document.getElementById('lite-banner')));
  ok('…and stops following the emote row (its ResizeObserver disconnects)', await p.evaluate(() => globalThis.__roOff === 1)); await ctx.close();
} catch (e) { fail++; console.log('PROBE FAILED', e.message); } finally { await b.close(); await world.close(); }
console.log(fail ? `${fail} failed` : 'all green'); process.exit(fail ? 1 : 0);
