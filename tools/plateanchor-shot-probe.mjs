// plateanchor-shot-probe — the nameplate's vertical anchor (client/lib/plateanchor.js) on REAL bodies, in the real
// client against an owned scratch world: the SAME avatar three times (idle / sitting on the ground / lying — the
// 'sit' and 'lie' clip slots), shot BEFORE (the plate pinned at the old fixed 1.95 above the root) and AFTER (hung from
// the body), plus the measured rest crown / gap / anchor for each. Clouds OFF before boot (a cloudy sky bakes on the
// CPU in headless Chromium). On a small host, run it under a lock and a memory guard:
//
//   bun tools/plateanchor-shot-probe.mjs --shots <dir> [--avatars claude,tigerbee]
//
// "Before" is emulated in-page: each body's _placePlate is swapped for the old line (label at 0, 1.95, 0) for the
// shot, then restored — everything else on the frame is today's code.
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const { check, done } = checker();
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const shotDir = arg('--shots', null);
const avatars = arg('--avatars', 'claude').split(',');
const prefix = Number(arg('--prefix', '90'));
if (shotDir) mkdirSync(shotDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORLD = 'anchors';

const world = await ownedWorld({ env: { SKIP_OPT_SWEEP: '1' } });
const { browser, close } = await launchBrowser();
const peers = [];
function peer(id, avatar, pose) {
  const ws = new WebSocket(`${world.origin.replace(/^http/, 'ws')}/ws`);
  const p = { ws, pose, timer: null };
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', world: WORLD, id, avatar, token: world.key }));
    p.timer = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pose', pose: p.pose })); }, 66);
  };
  peers.push(p);
  return p;
}
const endPeers = () => { for (const p of peers) { clearInterval(p.timer); try { p.ws.close(); } catch {} } peers.length = 0; };

const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ew-cloud-quality', 'off'); } catch {} });   // THE SKY GUARD
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.dismiss().catch(() => {}));
  await pg.goto(`${world.origin}/?world=${WORLD}&name=anchorcam&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => document.getElementById('splash')?.classList.contains('gone') && !!globalThis.EW?.me?.(), null, { timeout: 120000 });
  await sleep(3000);
  const fr = await pg.evaluate(() => {
    const p = EW.myState.pos, d = new EW.THREE.Vector3(); EW.camera.getWorldDirection(d); d.y = 0; d.normalize();
    return { p: [p.x, p.y, p.z], f: [d.x, d.z], r: [-d.z, d.x] };
  });
  const at = (fwd, right) => [fr.p[0] + fr.f[0] * fwd + fr.r[0] * right, fr.p[1], fr.p[2] + fr.f[1] * fwd + fr.r[1] * right];
  const yaw = Math.atan2(-fr.f[0], -fr.f[1]);   // face the camera
  let n = prefix;
  for (const av of avatars) {
    const ids = ['stand', 'sit', 'lie'].map((c) => `${av}-${c}`);
    const base = { speed: 0, presence: 'present' };
    peer(ids[0], av, { ...base, yaw, clip: 'idle', p: at(4.2, -1.6) });
    peer(ids[1], av, { ...base, yaw, clip: 'sit', p: at(4.2, 0) });
    peer(ids[2], av, { ...base, yaw: yaw + Math.PI / 2, clip: 'lie', p: at(4.2, 1.9) });
    await pg.waitForFunction((ids) => ids.every((id) => { const r = EW.remotes.get(id); return r?.avatar?.label && !r.loading && !r.capsuleFor; }),
      ids, { timeout: 150000 });
    // the posture clips hydrate after the body: wait until each is really playing its own slot, then the crossfade + chase
    await pg.waitForFunction((ids) => {
      const want = { stand: 'idle', sit: 'sit', lie: 'lie' };
      return ids.every((id) => { const a = EW.remotes.get(id).avatar, w = want[id.split('-').pop()]; return a.actions[w] && a.current === a.actions[w]; });
    }, ids, { timeout: 90000 }).catch(() => {});
    await pg.evaluate(() => { const me = EW.me(); if (me?.root) me.root.visible = false; });   // your own body is in the way
    await sleep(3500);
    const m = await pg.evaluate((ids) => ids.map((id) => {
      const a = EW.remotes.get(id).avatar, T = EW.THREE, h = a.vrm.humanoid;
      const w = (n) => { const b = h?.getRawBoneNode?.(n); return b ? b.getWorldPosition(new T.Vector3()) : null; };
      const lw = a.label.getWorldPosition(new T.Vector3()), rw = a.root.getWorldPosition(new T.Vector3());
      const head = w('head'), hips = w('hips');
      const r = a._plateRest ?? {};
      return { id, slot: a.currentSlot, rest: { crown: r.crown, head: r.crown - r.headSpan, hipsToCrown: r.hipsToCrown, boundsTop: r.boundsTop, eye: r.eye, height: r.height },
        scale: a.vrm.scene.getWorldScale(new T.Vector3()).y, lie: a._plateLie,
        plateAboveRoot: lw.y - rw.y, headAboveRoot: head ? head.y - rw.y : null, hipsAboveRoot: hips ? hips.y - rw.y : null,
        plateOverHipsXZ: hips ? Math.hypot(lw.x - hips.x, lw.z - hips.z) : null, plateOverHeadXZ: head ? Math.hypot(lw.x - head.x, lw.z - head.z) : null,
        ownClear: a._ownClear };
    }), ids);
    out[av] = m;
    for (const x of m) console.log('   ', JSON.stringify(x, (_k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
    const [st, si, li] = m;
    check(`${av}: standing plate = crown + gap above the root (rest crown ${st.rest.crown?.toFixed(3)})`, st.slot === 'idle'
      && Math.abs(st.plateAboveRoot - st.rest.crown * st.scale) < 0.2 && st.plateAboveRoot > st.headAboveRoot);
    check(`${av}: sitting plate comes down with the body (under the standing one, above the head)`, si.slot === 'sit'
      && si.plateAboveRoot < st.plateAboveRoot - 0.2 && si.plateAboveRoot > si.headAboveRoot);
    check(`${av}: lying plate over the head, just above it`, li.slot === 'lie' && li.lie > 0.99 && li.plateOverHeadXZ < 0.05
      && li.plateAboveRoot > li.headAboveRoot && li.plateAboveRoot - li.headAboveRoot < 0.6);
    // THE JUMP (owner, 10-01: "big noticeable lag on the nameplate on jumping"): the standing peer streams the jump
    // clip in place; its hips move under the root and the plate, over the root, does not (sampled every frame for 1.5 s)
    peers[0].pose = { ...peers[0].pose, clip: 'jump' };
    await pg.waitForFunction((id) => { const a = EW.remotes.get(id)?.avatar; return a?.actions?.jump && a.current === a.actions.jump; }, ids[0], { timeout: 30000 }).catch(() => {});
    const jump = await pg.evaluate((id) => new Promise((res) => {
      const a = EW.remotes.get(id).avatar, T = EW.THREE, lw = new T.Vector3(), rw = new T.Vector3(), hw = new T.Vector3();
      const hipsB = a.vrm.humanoid.getRawBoneNode('hips'); let pMin = Infinity, pMax = -Infinity, hMin = Infinity, hMax = -Infinity, frames = 0;
      const t0 = performance.now();
      const tick = () => {
        a.label.getWorldPosition(lw); a.root.getWorldPosition(rw); hipsB.getWorldPosition(hw);
        const p = lw.y - rw.y, h = hw.y - rw.y; pMin = Math.min(pMin, p); pMax = Math.max(pMax, p); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); frames++;
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
        else res({ slot: a.currentSlot, posture: a.postureSlot, frames, plateSwing: pMax - pMin, hipsSwing: hMax - hMin });
      };
      requestAnimationFrame(tick);
    }), ids[0]);
    console.log('    jump:', JSON.stringify(jump, (_k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
    check(`${av}: jumping in place, the hips move under the root and the plate does not (≤ 1 mm)`, jump.slot === 'jump' && jump.frames > 3
      && jump.hipsSwing > 0.03 && jump.plateSwing <= 0.001, JSON.stringify(jump));
    peers[0].pose = { ...peers[0].pose, clip: 'idle' };
    if (shotDir) {
      await pg.screenshot({ path: `${shotDir}/${n}-anchor-${av}-after.png` });
      await pg.evaluate((ids) => { for (const id of ids) { const a = EW.remotes.get(id).avatar;
        a.__place = a._placePlate; a._placePlate = function () { this.label.position.set(0, 1.95, 0); }; } }, ids);
      await sleep(1200);
      await pg.screenshot({ path: `${shotDir}/${n + 1}-anchor-${av}-before.png` });
      await pg.evaluate((ids) => { for (const id of ids) { const a = EW.remotes.get(id).avatar; a._placePlate = a.__place; } }, ids);
      n += 2;
    }
    endPeers();
    await pg.waitForFunction((ids) => ids.every((id) => !EW.remotes.get(id)), ids, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  if (shotDir) writeFileSync(`${shotDir}/${prefix}-anchor-measure.json`, JSON.stringify(out, null, 1));
  await ctx.close();
} finally {
  endPeers();
  await close();
  await world.close();
}
done();
