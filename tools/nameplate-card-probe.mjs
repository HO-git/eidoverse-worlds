// nameplate-card-probe — the nameplate ear and the hover card (client/lib/platecard.js), in the REAL client against
// an owned scratch world (probe-harness), with fake peers that are plain sockets joined to the same world and
// streaming pose packets — the wire every body uses, so `mic` / `hear` arrive exactly as a browser's would.
// Clouds are forced OFF before boot (a cloudy sky bakes on the CPU in headless Chromium and has frozen the host).
//
//   bun tools/nameplate-card-probe.mjs [--shots <dir>]
//
// What must hold:
//   the wire — this client's own pose packets carry `mic` and `hear` (booleans), so peers can know;
//   the ear — a grey ear sits BESIDE (right of, level with, not on) the plate of a NEAR peer with hearing off; none
//     for a near peer who hears, none for a far one (past the voice range) with hearing off; a live flip of `hear`
//     brings it in and fades it out;
//   the card — resting on a plate opens it only after the delay; it names the person and says mic off / can't hear
//     you; it follows the plate while the pointer rests on it; leaving plate and card closes it; Esc closes it and
//     leaves the panels alone; "message" opens their DM tab;
//   phone (390×844, touch) — a tap on a plate opens the same card inside the viewport; a tap elsewhere closes it.
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
import { mkdirSync } from 'node:fs';

const { check, done } = checker();
const shotDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
if (shotDir) mkdirSync(shotDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORLD = 'plates';

const world = await ownedWorld({ env: { SKIP_OPT_SWEEP: '1' } });
const { browser, close } = await launchBrowser();

// ---- fake peers: a socket each, a pose every 66 ms (the client's own cadence) ------------------------------------
const peers = new Map();   // id → { ws, pose }
const seen = new Map();    // id → the last pose the server relayed for it (read off peer sockets' frames)
function peer(id, pose) {
  const ws = new WebSocket(`${world.origin.replace(/^http/, 'ws')}/ws`);
  const p = { ws, pose, timer: null };
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', world: WORLD, id, token: world.key }));
    p.timer = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pose', pose: p.pose })); }, 66);
  };
  ws.onmessage = (e) => {
    try { const m = JSON.parse(String(e.data)); if (m.type === 'frame') for (const [k, v] of Object.entries(m.poses ?? {})) seen.set(k, v); } catch {}
  };
  peers.set(id, p);
  return p;
}
const endPeers = () => { for (const p of peers.values()) { clearInterval(p.timer); try { p.ws.close(); } catch {} } peers.clear(); };

async function boot(ctxOpts, name) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { try { localStorage.setItem('ew-cloud-quality', 'off'); } catch {} });   // THE SKY GUARD
  await ctx.addInitScript(readers);
  await ctx.addInitScript(() => { globalThis.__plog = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click'])
    addEventListener(t, (e) => __plog.push(`${t}:${e.pointerType ?? ''}:${e.target?.tagName}:${Math.round(e.clientX)},${Math.round(e.clientY)}:${Math.round(performance.now())}`), true); });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.dismiss().catch(() => {}));
  await pg.goto(`${world.origin}/?world=${WORLD}&name=${name}&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.getElementById('splash')?.classList.contains('gone') && !!globalThis.EW?.me?.(),
    null, { timeout: 120000 });
  await sleep(3000);
  return { ctx, pg, errs };
}
const shot = async (pg, file, clip) => { if (shotDir) await pg.screenshot({ path: `${shotDir}/${file}`, ...(clip ? { clip } : {}) }); };

// where I stand and which way the camera looks along the ground — peers are placed in view from these
const frameOf = (pg) => pg.evaluate(() => {
  const p = EW.myState.pos, d = new EW.THREE.Vector3(); EW.camera.getWorldDirection(d); d.y = 0; d.normalize();
  return { p: [p.x, p.y, p.z], f: [d.x, d.z], r: [-d.z, d.x] };
});
const at = (fr, fwd, right) => [fr.p[0] + fr.f[0] * fwd + fr.r[0] * right, fr.p[1], fr.p[2] + fr.f[1] * fwd + fr.r[1] * right];
// a peer's plate (and ear) on screen, projected the way platecard.js does
// in-page readers, installed before boot so one evaluate can read card AND plate from the same frame
const readers = () => {
  globalThis.__plateOf = (id) => {
  const r = EW.remotes.get(id), av = r?.avatar;
  if (!av?.label) return null;
  const T = EW.THREE, cam = EW.camera, cv = EW.renderer.domElement;
  const v = new T.Vector3(); av.label.getWorldPosition(v);
  const depth = -v.clone().applyMatrix4(cam.matrixWorldInverse).z;
  const ppm = (cv.clientHeight / 2) / (Math.tan(T.MathUtils.degToRad(cam.fov) / 2) * depth);
  v.project(cam);
  const b = cv.getBoundingClientRect();
  const x = b.left + (v.x + 1) / 2 * cv.clientWidth, y = b.top + (1 - v.y) / 2 * cv.clientHeight;
  const hw = av.label.scale.x * (av.label.userData.pill ?? 0.5) / 2 * ppm, hh = av.label.scale.x * 52 / 1024 * ppm;
  let ear = null;
  if (av.ear) {
    const e = new T.Vector3(); av.ear.getWorldPosition(e); e.project(cam);
    const ex = b.left + (e.x + 1) / 2 * cv.clientWidth, ey = b.top + (1 - e.y) / 2 * cv.clientHeight, ew = av.ear.scale.x * ppm;
    ear = { l: ex - ew / 2, r: ex + ew / 2, t: ey - ew / 2, b: ey + ew / 2, op: +av.ear.material.opacity.toFixed(3), vis: av.ear.visible };
  }
  return { x, y, l: x - hw, r: x + hw, t: y - hh, b: y + hh, ear, hear: r.hear, mic: r.mic, shown: av.label.visible };
};
  globalThis.__card = () => {
  const c = document.getElementById('platecard');
  if (!c) return { exists: false };
  const r = c.getBoundingClientRect();
  return { exists: true, open: !c.hidden, for: c.dataset.for ?? null, side: c.dataset.side ?? null, text: c.textContent.replace(/\s+/g, ' ').trim(),
    l: r.left, t: r.top, r: r.right, b: r.bottom, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
};
};
const plate = (pg, id) => pg.evaluate((id) => __plateOf(id), id);
const cardState = (pg) => pg.evaluate(() => __card());
const both = (pg, id) => pg.evaluate((id) => ({ k: __card(), a: __plateOf(id) }), id);
const earOn = (pl) => !!pl?.ear?.vis && pl.ear.op > 0.5;
const earOff = (pl) => !pl?.ear || !pl.ear.vis || pl.ear.op < 0.05;


try {
  // ------------------------------------------------------------ desktop 1280x720
  const { ctx, pg, errs } = await boot({ viewport: { width: 1280, height: 720 } }, 'platedesk');
  const fr = await frameOf(pg);
  const base = { yaw: 0, speed: 0, clip: 'idle', presence: 'present' };
  const A = peer('nearmute', { ...base, p: at(fr, 3, -1.9), mic: false, hear: false });
  const B = peer('nearhear', { ...base, p: at(fr, 3.5, 1.9), mic: true, hear: true });
  const C = peer('farmute', { ...base, p: at(fr, 26, 0), mic: false, hear: false });
  await pg.waitForFunction(() => ['nearmute', 'nearhear', 'farmute'].every((id) => EW.remotes.get(id)?.avatar?.label
    && typeof EW.remotes.get(id).hear === 'boolean'), null, { timeout: 90000 });
  // settled bodies: a peer's first body can be the capsule floor while its VRM loads (remotes.js retryBody swaps it),
  // and a swapped body starts its ear from nothing — so wait until each body has stayed the same one for 2 s
  await pg.evaluate(async () => {
    const ids = ['nearmute', 'nearhear', 'farmute'];
    let last = ids.map((id) => EW.remotes.get(id)?.avatar), since = performance.now();
    while (performance.now() - since < 2000) {
      await new Promise((r) => setTimeout(r, 100));
      const now = ids.map((id) => EW.remotes.get(id)?.avatar);
      const bad = ids.some((id) => EW.remotes.get(id)?.loading);
      if (bad || now.some((a, i) => a !== last[i])) { last = now; since = performance.now(); }
    }
  });
  console.log('    bodies', await pg.evaluate(() => JSON.stringify(['nearmute', 'nearhear', 'farmute'].map((id) => {
    const r = EW.remotes.get(id); return [id, r?.capsuleFor ? 'capsule' : 'vrm']; }))));
  await sleep(1000);   // the 5 Hz decision + the fade

  // the wire, from the other side: my own packets carry both fields
  const mine = seen.get('platedesk');
  check('the wire: this client’s pose packets carry mic and hear as booleans',
    mine && typeof mine.mic === 'boolean' && typeof mine.hear === 'boolean', JSON.stringify(mine && { mic: mine.mic, hear: mine.hear }));

  let a = await plate(pg, 'nearmute'), b = await plate(pg, 'nearhear'), c = await plate(pg, 'farmute');
  check('ear: a NEAR peer with hearing off wears it', earOn(a), JSON.stringify(a));
  check('…beside the plate, not on it: right of the pill, level with it', a?.ear && a.ear.l >= a.r && a.ear.l - a.r < 20
    && Math.abs((a.ear.t + a.ear.b) / 2 - a.y) < 3 && a.ear.b - a.ear.t <= (a.b - a.t) * 1.8, JSON.stringify(a));
  check('ear: none for a near peer who hears', earOff(b), JSON.stringify(b?.ear));
  check('ear: none for a FAR peer (past voice range) with hearing off', earOff(c) && c?.hear === false, JSON.stringify(c));
  await shot(pg, '70-ear-near.png');

  // live: the hearing peer turns voices off → the ear fades in; back on → it fades out
  // (headless software GL runs a few frames a second, so these poll up to 4 s rather than trusting one sleep)
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v.ok) return v; await sleep(150); } return v; };
  // MEASURE THE RENDER, not the arithmetic: a region around the hearing peer's plate captured with the ear off and on;
  // what changed must be grey ear pixels, right of the pill and level with it — and the pill itself must not change
  // the peer's idle clip and its hair's springs move pixels too: hold that body still for the two captures
  await pg.evaluate(() => { const av = EW.remotes.get('nearhear').avatar; av.mixer.timeScale = 0; });
  await sleep(1500);   // springs settle
  const b0 = await plate(pg, 'nearhear');
  const clip = { x: Math.floor(b0.l - 30), y: Math.floor(b0.t - 30), width: Math.ceil(b0.r - b0.l + 110), height: Math.ceil(b0.b - b0.t + 60) };
  const capOff = (await pg.screenshot({ clip })).toString('base64');
  B.pose = { ...B.pose, hear: false };
  let fl = await until(async () => { const pl = await plate(pg, 'nearhear'); return { ok: earOn(pl), pl }; });
  check('ear: a live flip to hearing off brings it in', fl.ok, JSON.stringify(fl.pl?.ear));
  await sleep(300);
  const capOn = (await pg.screenshot({ clip })).toString('base64');
  if (shotDir) { const { writeFileSync } = await import('node:fs'); writeFileSync(`${shotDir}/70b-ear-off-crop.png`, Buffer.from(capOff, 'base64')); writeFileSync(`${shotDir}/70c-ear-on-crop.png`, Buffer.from(capOn, 'base64')); }
  const px = await pg.evaluate(async ([a, b]) => {
    const load = async (b64) => { const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height); };
    const A = await load(a), B = await load(b);
    // a changed pixel that is NEUTRAL GREY in the 'on' capture (the ear's stroke; the idle hair sway is orange)
    let l = Infinity, r = -1, t = Infinity, bt = -1, n = 0;
    for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
      const i = (y * A.width + x) * 4, [R, G, Bl] = [B.data[i], B.data[i + 1], B.data[i + 2]];
      const d = Math.abs(R - A.data[i]) + Math.abs(G - A.data[i + 1]) + Math.abs(Bl - A.data[i + 2]);
      if (d > 60 && Math.max(R, G, Bl) - Math.min(R, G, Bl) < 30 && R > 70) { n++; l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); bt = Math.max(bt, y); }
    }
    return { n, l, r, t, b: bt };
  }, [capOff, capOn]);
  const pl = fl.pl, rel = { l: px.l + clip.x, r: px.r + clip.x, t: px.t + clip.y, b: px.b + clip.y };
  check('ear (render): grey pixels appear, right of the pill, level with it — the pill untouched',
    px.n >= 6 && rel.l >= pl.r - 3 && rel.l - pl.r < 20 && rel.t < pl.b + 2 && rel.b > pl.t - 2, JSON.stringify({ px, rel, plate: { l: pl.l, r: pl.r, t: pl.t, b: pl.b } }));
  await pg.evaluate(() => { EW.remotes.get('nearhear').avatar.mixer.timeScale = 1; });
  B.pose = { ...B.pose, hear: true };
  fl = await until(async () => { const pl = await plate(pg, 'nearhear'); return { ok: earOff(pl), pl }; });
  check('…and back on fades it out', fl.ok, JSON.stringify(fl.pl?.ear));

  // ---- the hover card
  a = await plate(pg, 'nearmute');
  await pg.mouse.move(a.x, a.y); await sleep(150);
  let k = await cardState(pg);
  check('card: not open before the delay (150 ms in)', k.exists && !k.open, JSON.stringify(k));
  await sleep(350);
  k = await cardState(pg);
  check('card: open after the delay, for the person under the pointer', k.open && k.for === 'nearmute', JSON.stringify(k));
  check('…it says who, mic off, and can’t hear you (and not the default "present")', /nearmute/.test(k.text) && /mic off/.test(k.text)
    && /can’t hear you/.test(k.text) && !/present/.test(k.text), k.text);
  check('…beside the plate (right of it, clear of the ear), inside the viewport',
    k.side === 'right' && k.l >= (a.ear?.r ?? a.r) && k.l - (a.ear?.r ?? a.r) < 24 && k.inView, JSON.stringify({ k, a }));
  await shot(pg, '71-hover-card.png');

  // rest on the card, then the person steps sideways: the card follows the plate
  await pg.mouse.move((k.l + k.r) / 2, (k.t + k.b) / 2); await sleep(400);
  const { k: k0, a: a0 } = await both(pg, 'nearmute');
  check('card: moving from plate onto the card keeps it open', k0.open && k0.for === 'nearmute', JSON.stringify(k0));
  A.pose = { ...A.pose, p: at(fr, 3, -2.4) };   // a half-metre step: the card moves ~50 px and stays under the resting pointer
  // the body glides to its new place over several (slow, headless) frames: wait for the plate to stop, then read card
  // and plate in ONE evaluate — two calls can straddle a frame and measure a moving plate against a stale card
  { let px = null; for (let i = 0; i < 40; i++) { await sleep(150); const x = (await plate(pg, 'nearmute')).x; if (px !== null && Math.abs(x - px) < 0.5 && Math.abs(x - a0.x) > 20) break; px = x; } }
  const { k: k1, a: a1 } = await both(pg, 'nearmute');
  const dPlate = a1.x - a0.x, dCard = k1.l - k0.l;
  check('card: follows the plate while open', k1.open && Math.abs(dPlate) > 20 && Math.abs(dCard - dPlate) < 6,
    JSON.stringify({ dPlate, dCard, k0, k1, a0, a1 }));

  // leave plate and card: it closes
  await pg.mouse.move(640, 690); await sleep(600);
  k = await cardState(pg);
  check('card: leaving plate and card closes it', !k.open, JSON.stringify(k));

  // Esc closes it and nothing else
  a = await plate(pg, 'nearmute');
  await pg.mouse.move(a.x, a.y); await sleep(600);
  const framesBefore = await pg.evaluate(() => [...document.querySelectorAll('.frame')].filter((f) => getComputedStyle(f).display !== 'none').length);
  k = await cardState(pg);
  await pg.keyboard.press('Escape'); await sleep(200);
  const k2 = await cardState(pg);
  const framesAfter = await pg.evaluate(() => [...document.querySelectorAll('.frame')].filter((f) => getComputedStyle(f).display !== 'none').length);
  check('card: Esc closes it', k.open && !k2.open, JSON.stringify({ k, k2 }));
  check('…and goes no further: the open panels stay', framesBefore > 0 && framesAfter === framesBefore, JSON.stringify({ framesBefore, framesAfter }));

  // the action: "message" opens their DM tab
  B.pose = { ...B.pose, presence: 'busy' };
  await pg.mouse.move(640, 690); await sleep(300);
  a = await plate(pg, 'nearhear');
  await pg.mouse.move(a.x, a.y);
  k = (await until(async () => { const c = await cardState(pg); return { ok: c.open && c.for === 'nearhear', ...c }; }, 3000));
  check('card on a hearing, busy peer: mic on, hearing voices, busy', k.open && k.for === 'nearhear' && /mic on/.test(k.text)
    && /hearing voices/.test(k.text) && /busy/.test(k.text), k.text);
  await shot(pg, '73-hover-card-hearing-busy.png');
  await pg.mouse.move(k.l + 20, k.b - 12); await sleep(100);
  await pg.click('#platecard button[data-act="dm"]'); await sleep(400);
  const dm = await pg.evaluate(() => ({ card: !document.getElementById('platecard').hidden,
    tab: [...document.querySelectorAll('.chat-frame .chat-tabs button')].map((b) => b.textContent.trim()).find((t) => /nearhear/.test(t)) ?? null,
    focus: document.activeElement?.id }));
  check('card: "message" opens their DM tab and closes the card', !dm.card && dm.tab && dm.focus === 'chatline', JSON.stringify(dm));
  await pg.keyboard.press('Escape'); await sleep(150);

  // a close look for the review: the hard-of-hearing peer a couple of metres from the camera
  if (shotDir) {
    A.pose = { ...A.pose, p: at(fr, -1.4, -1.1) }; await sleep(2500);
    const c1 = await plate(pg, 'nearmute');
    if (c1) await shot(pg, '74-ear-close.png', { x: Math.max(0, c1.l - 60), y: Math.max(0, c1.t - 50), width: 260, height: 140 });
  }
  check('desktop: no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ------------------------------------------------------------ phone 390x844, touch
  const ph = await boot({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, 'platephone');
  const pf = await frameOf(ph.pg);
  A.pose = { ...A.pose, p: at(pf, 4, 0) };
  B.pose = { ...B.pose, p: at(pf, 30, 3) };
  C.pose = { ...C.pose, p: at(pf, 34, -3) };
  await ph.pg.waitForFunction(() => EW.remotes.get('nearmute')?.avatar?.label && EW.remotes.get('nearmute').hear === false, null, { timeout: 90000 });
  await ph.pg.evaluate(async () => {   // the same settled-body wait as the desktop pass
    let last = EW.remotes.get('nearmute')?.avatar, since = performance.now();
    while (performance.now() - since < 2000) {
      await new Promise((r) => setTimeout(r, 100));
      const now = EW.remotes.get('nearmute')?.avatar;
      if (now !== last || EW.remotes.get('nearmute')?.loading) { last = now; since = performance.now(); }
    }
  });
  await sleep(1000);
  a = await plate(ph.pg, 'nearmute');
  await ph.pg.touchscreen.tap(a.x, a.y); await sleep(400);
  k = await cardState(ph.pg);
  if (!k.open) console.log('    diag phone', JSON.stringify({ a, after: await plate(ph.pg, 'nearmute'),
    plog: await ph.pg.evaluate(() => __plog.slice(-6)),
    top: await ph.pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}#${e.id}.${e.className}` : null; }, [a.x, a.y]) }));
  check('phone: a tap on a plate opens its card, inside the viewport', k.open && k.for === 'nearmute' && k.inView, JSON.stringify(k));
  check('…clear of the plate (no overlap)', k.t >= a.b || k.l >= (a.ear?.r ?? a.r) || k.r <= a.l, JSON.stringify({ k, a }));
  await shot(ph.pg, '72-hover-card-phone.png');
  await ph.pg.touchscreen.tap(195, 780); await sleep(300);
  k = await cardState(ph.pg);
  check('phone: a tap elsewhere closes it', !k.open, JSON.stringify(k));
  check('phone: no page errors', ph.errs.length === 0, ph.errs.join(' | '));
  await ph.ctx.close();
} finally {
  endPeers();
  await close().catch(() => {});
  await world.close();
}
done();
