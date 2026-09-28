// bun tools/sky-state-probe.mjs — World › sky says what the LOG has ("world: …") and, only while this client shows
// something else, what and why ("you: previewing / loading… / no clouds (your clouds⚙ is off)"). Cloud quality is set
// to off BEFORE load: a software-rendered cloud bake exhausts this machine (run it under perf-guard.sh).
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser();
try {
  const pg = await page();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=skystate&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp && document.querySelector('#sec-sky .head'), null, { timeout: 90000 });
  await pg.evaluate(() => document.querySelector('#sec-sky .head').click());
  await pg.waitForFunction(() => document.querySelector('#sec-sky .sky-state'), null, { timeout: 20000 });
  const read = () => pg.evaluate(() => {
    const w = document.querySelector('#sec-sky .state-world')?.textContent ?? null;
    const y = document.querySelector('#sec-sky .state-you'); return { w, y: y && !y.hidden ? y.textContent : null };
  });
  const settle = async () => {
    const t0 = Date.now();
    try { await pg.waitForFunction(async () => { const s = await import('./lib/sky.js'); return !s.skyRendering(); }, null, { timeout: 120000 }); }
    catch (e) { console.log('    unsettled after 120 s:', JSON.stringify(await read())); throw e; }
    console.log(`    settled in ${Date.now() - t0} ms`);
  };
  const log = async (a) => { await pg.evaluate(async (x) => { const { sendVerb } = await import('./lib/net.js'); sendVerb('sky', x); }, a); await pg.waitForTimeout(1500); await settle(); return read(); };
  const dusk = await log({ hours: 18.5, rate: 0, clouds: 'cumulus', weather: 'clear' });
  check('a logged sky reads as world: 18:30 · clear · clouds cumulus', /^world: 18:30 · clear · clouds cumulus$/.test(dusk.w ?? ''), dusk.w);
  check('clouds⚙ off against a cloudy log: "you:" says so', /no clouds \(your clouds⚙ is off\)/.test(dusk.y ?? ''), dusk.y);
  // a preview: the view changes, the log doesn't
  await pg.evaluate(async () => { const s = await import('./lib/sky.js'); await s.previewSky({ ...s.loggedSky().args, hours: 7 }); });
  await settle();
  const prev = await read();
  check('a preview leaves world: alone', prev.w === dusk.w, prev.w);
  check('…and adds "you: previewing (not logged)"', /previewing \(not logged\)/.test(prev.y ?? ''), prev.y);
  // someone logs a sky while you preview: the view follows the log, and "previewing" is gone
  const noon = await log({ hours: 12, rate: 0, clouds: 'clear', weather: 'clear' });   // not rain: its weather system in software crosses the memory floor
  check('world: follows a new log', /^world: 12:00 · clear · clouds clear$/.test(noon.w ?? ''), noon.w);
  check('the new log ends the preview, and clear clouds need no clouds⚙ note', noon.y === null, noon.y);
  // unrelated log entries don't touch the readout (in VR any write re-rasterises the panel)
  const quiet = await pg.evaluate(async () => {
    const el = document.querySelector('#sec-sky .sky-state'); let n = 0;
    const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    const { sendVerb } = await import('./lib/net.js');
    sendVerb('light', { id: 'ssq1', pos: [3, 1, 3], color: 0xffd9a0, intensity: 4, range: 5 });
    await new Promise((r) => setTimeout(r, 1200));
    sendVerb('remove', { id: 'ssq1' });
    await new Promise((r) => setTimeout(r, 1200));
    // and refreshes that change nothing (the 30 s sun tick, a degrade notice) must not write either
    const { bus } = await import('./lib/base.js');
    for (let i = 0; i < 3; i++) bus.emit('sky-degraded', { msg: 'probe: no-op refresh' });
    await new Promise((r) => setTimeout(r, 300));
    mo.disconnect(); return n;
  });
  check('unrelated log entries leave the readout untouched (0 mutations)', quiet === 0, quiet);
  // a real clock: time and rate are hidden (they can't act); back to the authored clock, they come back
  const clockUi = async (clock) => { await log({ hours: 12, rate: 0, clouds: 'clear', weather: 'clear', ...clock }); return pg.evaluate(() => {
    const row = (k) => { const i = [...document.querySelectorAll('#sec-sky input[type=range]')][k === 'hours' ? 0 : 1]; return { dis: i.disabled, shown: getComputedStyle(i.parentNode).display !== 'none' }; };
    return { hours: row('hours'), rate: row('rate') }; }); };
  const realUi = await clockUi({ clock: 'real', tz: 'America/Los_Angeles' });
  const backUi = await clockUi({ clock: undefined, tz: undefined });
  console.log('   ', JSON.stringify({ realUi, backUi }));
  check('a real clock hides time and rate', realUi.hours.dis && realUi.rate.dis && !realUi.hours.shown && !realUi.rate.shown, JSON.stringify(realUi));
  check('…and the authored clock brings them back', !backUi.hours.dis && !backUi.rate.dis && backUi.hours.shown && backUi.rate.shown, JSON.stringify(backUi));
  // azimuth and fill only act on the basic sky: on the detailed sky they're hidden
  const basic = await pg.evaluate(async () => {
    const impl = (await import('./lib/sky.js')).skyImpl?.();
    const rows = [...document.querySelectorAll('#sec-sky input[type=range]')].map((i) => i.parentNode).filter((r) => /azim|fill/i.test(r.textContent));
    return { impl, n: rows.length, shown: rows.filter((r) => getComputedStyle(r).display !== 'none').length };
  });
  console.log('    basic-only rows:', JSON.stringify(basic));
  check('on the detailed sky, azimuth and fill are hidden', basic.impl === 'eidoverse' && basic.n === 2 && basic.shown === 0, JSON.stringify(basic));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
