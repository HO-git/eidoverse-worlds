// lantern-probe — the lantern prompt (client/lib/lantern.js) and the HUD quiet defaults, in the REAL
// client against an owned scratch world (probe-harness). Clouds are forced OFF before boot: a cloudy sky
// bakes on the CPU in headless Chromium and has frozen the host.
//
//   bun tools/lantern-probe.mjs [--shots <dir>]
//
// What must hold:
//   quiet defaults — a fresh profile arrives with the world panel CLOSED, and (on WebGL 2, which headless
//     is) the capability note as a small chip that expands to its full text on click, not a card;
//   Enter still opens chat (the prompt is additive);
//   Ctrl+K opens the prompt; "wave" ranks the emote first and Enter PLAYS it (playEmote observed);
//   "sky" opens the world panel with its sky section expanded;
//   "hello there" + Enter goes through chat's own send path (the server echoes it into #chatlog);
//   "/who" passes through to the command path; Esc closes; a mouse click on a row runs it.
// --shots writes the after/ screenshots (1280x720 and 390x844) as it goes.
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
import { mkdirSync } from 'node:fs';

const { check, done } = checker();
const shotDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
if (shotDir) mkdirSync(shotDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const world = await ownedWorld({ env: { SKIP_OPT_SWEEP: '1' } });
const { browser, close } = await launchBrowser();

async function boot(ctxOpts, name) {
  const ctx = await browser.newContext(ctxOpts);
  // THE SKY GUARD, before any module reads localStorage (sky.js)
  await ctx.addInitScript(() => { try { localStorage.setItem('ew-cloud-quality', 'off'); } catch {} });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.dismiss().catch(() => {}));
  await pg.goto(`${world.origin}/?world=lantern&name=${name}&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.getElementById('splash')?.classList.contains('gone') && !!globalThis.EW?.me?.(),
    null, { timeout: 120000 });
  await sleep(4000);   // panels, glyphs, the chip's first placement
  return { ctx, pg, errs };
}
const shot = async (pg, file) => { if (shotDir) await pg.screenshot({ path: `${shotDir}/${file}` }); };
const lantern = (pg) => pg.evaluate(() => {
  const el = document.getElementById('lantern');
  const rows = [...(el?.querySelectorAll('.ln-row') ?? [])].map((r) => ({
    title: r.querySelector('.ln-title')?.textContent, key: r.querySelector('kbd')?.textContent ?? null, kind: r.className }));
  return { open: !!el && !el.hidden, focused: document.activeElement === el?.querySelector('.ln-input'), rows };
});
const type = async (pg, text) => { await pg.keyboard.press('Control+k'); await sleep(150); await pg.keyboard.type(text, { delay: 15 }); await sleep(200); };

try {
  // ------------------------------------------------------------ desktop 1280x720
  const { ctx, pg, errs } = await boot({ viewport: { width: 1280, height: 720 } }, 'lanterndesk');
  await shot(pg, '01-default-1280x720.png');

  const d = await pg.evaluate(() => {
    const w = document.querySelector('.frame[data-frame="world"]');
    const chip = document.getElementById('capchip')?.getBoundingClientRect();
    const pop = document.querySelector('.capnotice .cn-pop');
    return { world: w ? getComputedStyle(w).display : 'absent', chip: chip ? [chip.width, chip.height] : null,
      popHidden: pop?.hidden ?? null, backend: document.querySelector('.capnotice') ? 'webgl-chip' : 'none' };
  });
  check('quiet default: the world panel starts CLOSED on a fresh profile', d.world === 'none', JSON.stringify(d));
  check('quiet default: the WebGL 2 note is a small chip (≤ 140×32), its text folded away',
    d.chip && d.chip[0] > 0 && d.chip[0] <= 140 && d.chip[1] <= 32 && d.popHidden === true, JSON.stringify(d));

  await pg.click('#capchip');
  await sleep(300);
  const pop = await pg.evaluate(() => { const p = document.querySelector('.capnotice .cn-pop'); const r = p.getBoundingClientRect();
    return { hidden: p.hidden, text: p.textContent, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
  check('chip click expands the full text, with "don’t show again", inside the viewport',
    !pop.hidden && /Running on WebGL 2/.test(pop.text) && /show again/.test(pop.text) && pop.inView, JSON.stringify(pop));
  await shot(pg, '04-chip-expanded-1280x720.png');
  await pg.click('#capchip'); await sleep(200);

  // Enter-to-chat is untouched
  await pg.mouse.click(640, 300); await sleep(200);
  await pg.keyboard.press('Enter'); await sleep(300);
  check('Enter still focuses the chat line (the prompt is additive)', await pg.evaluate(() => document.activeElement?.id === 'chatline'));
  await pg.keyboard.press('Escape'); await sleep(200);

  // Ctrl+K opens
  await pg.keyboard.press('Control+k'); await sleep(250);
  let L = await lantern(pg);
  check('Ctrl+K opens the prompt with its line focused', L.open && L.focused, JSON.stringify({ open: L.open, focused: L.focused }));
  check('an empty prompt lists the registry (> 40 actions)', L.rows.length > 40, String(L.rows.length));
  const counts = await pg.evaluate(async () => {
    const A = await import('/lib/actions.js');
    const by = {}; for (const a of A.all()) by[a.group] = (by[a.group] ?? 0) + 1;
    return { total: A.all().length, by };
  });
  console.log('  registry:', JSON.stringify(counts));
  await pg.keyboard.press('Escape'); await sleep(150);
  check('Esc closes it', !(await lantern(pg)).open);

  // "sk" — screenshot only, then "sky"
  await type(pg, 'sk');
  L = await lantern(pg);
  check('"sk" ranks the sky section first', L.rows[0]?.title === 'sky', JSON.stringify(L.rows.slice(0, 3)));
  await shot(pg, '02-lantern-sk-1280x720.png');
  await pg.keyboard.type('y'); await sleep(150);
  await pg.keyboard.press('Enter'); await sleep(1500);
  const sky = await pg.evaluate(() => ({ world: getComputedStyle(document.querySelector('.frame[data-frame="world"]')).display,
    open: document.getElementById('sec-sky')?.classList.contains('open') ?? null }));
  check('"sky" + Enter opens the world panel with the sky section expanded', sky.world !== 'none' && sky.open === true, JSON.stringify(sky));
  check('running an action closes the prompt', !(await lantern(pg)).open);
  await pg.evaluate(() => { document.querySelector('#dock button[data-toggles="world"]')?.click(); });   // put it away again
  await sleep(300);

  // "wave" — the emote first, Enter plays it
  await pg.evaluate(() => {
    const me = globalThis.EW.me(); const orig = me.playEmote.bind(me);
    globalThis.__emoted = []; me.playEmote = (n, ...r) => { globalThis.__emoted.push(n); return orig(n, ...r); };
  });
  await type(pg, 'wave');
  L = await lantern(pg);
  check('"wave" ranks the wave emote first, its number key shown', L.rows[0]?.title === 'wave' && /^[1-9]$/.test(L.rows[0]?.key ?? ''), JSON.stringify(L.rows.slice(0, 3)));
  await shot(pg, '03-lantern-wave-1280x720.png');
  await pg.keyboard.press('Enter'); await sleep(400);
  check('Enter on it plays the emote (playEmote("wave") observed)', (await pg.evaluate(() => globalThis.__emoted)).includes('wave'),
    JSON.stringify(await pg.evaluate(() => globalThis.__emoted)));

  // plain speech: no strong match → the say row first → chat's own send path (server echo lands in the log)
  await type(pg, 'hello there');
  L = await lantern(pg);
  check('"hello there" offers say-in-chat as the first row', /^say “hello there” in chat$/.test(L.rows[0]?.title ?? ''), JSON.stringify(L.rows.slice(0, 2)));
  await pg.keyboard.press('Enter');
  const said = await pg.waitForFunction(() => /hello there/.test(document.getElementById('chatlog')?.textContent ?? ''), null, { timeout: 8000 }).then(() => true, () => false);
  check('Enter sends it through the existing chat path (echoed into #chatlog)', said);

  // "/" passes through to the command path
  await type(pg, '/who');
  L = await lantern(pg);
  check('"/who" leads with the pass-through row', L.rows[0]?.title === 'run /who', JSON.stringify(L.rows.slice(0, 2)));
  await pg.keyboard.press('Enter');
  const who = await pg.waitForFunction(() => /here now:/.test(document.getElementById('chatlog')?.textContent ?? ''), null, { timeout: 5000 }).then(() => true, () => false);
  check('"/who" + Enter runs the command (its "here now:" line appears)', who);

  // the mouse: the pill opens it, a click on a row runs it
  await pg.click('#lantern-pill'); await sleep(200);
  await pg.keyboard.type('mute'); await sleep(150);
  L = await lantern(pg);
  check('the pill opens the prompt; "mute" finds the microphone (keyword) with its key', L.open && L.rows[0]?.title === 'microphone on / off' && L.rows[0]?.key === 'V', JSON.stringify(L.rows.slice(0, 2)));
  await pg.keyboard.press('Control+a'); await pg.keyboard.type('audio'); await sleep(150);
  await pg.locator('#lantern .ln-row', { hasText: /^audio$/ }).first().click();
  await sleep(1000);
  const audio = await pg.evaluate(() => ({ settings: getComputedStyle(document.querySelector('.frame[data-frame="settings"]')).display,
    open: document.getElementById('sec-audio')?.classList.contains('open') ?? null }));
  check('clicking the "audio" row opens settings ▸ audio', audio.settings !== 'none' && audio.open === true, JSON.stringify(audio));
  check('no page errors on the desktop run', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();

  // ------------------------------------------------------------ phone 390x844
  const ph = await boot({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, 'lanternphone');
  await shot(ph.pg, '05-phone-default-390x844.png');
  const pr = await ph.pg.evaluate(() => { const r = document.getElementById('lantern-pill').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  check('phone: the pill is on screen', pr[0] >= 0 && pr[2] <= 390 && pr[1] >= 0 && pr[3] <= 844, JSON.stringify(pr));
  await ph.pg.tap('#lantern-pill'); await sleep(300);
  await ph.pg.keyboard.type('sk'); await sleep(200);
  const PL = await lantern(ph.pg);
  const box = await ph.pg.evaluate(() => { const r = document.getElementById('lantern').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  check('phone: tapping the pill opens the prompt inside the viewport', PL.open && box[0] >= 0 && box[2] <= 390 && box[1] >= 0 && box[3] <= 844, JSON.stringify(box));
  await shot(ph.pg, '06-phone-lantern-open-390x844.png');
  check('no page errors on the phone run', ph.errs.length === 0, ph.errs.slice(0, 3).join(' | '));
  await ph.ctx.close();
} finally {
  await close().catch(() => {});
  await world.close();
}
done();
