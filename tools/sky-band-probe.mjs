// bun tools/sky-band-probe.mjs — bandedBakeRender (sky_baked.js) writes THE SAME TEXELS as one full-quad draw.
//
// Owner's machine 2026-09-23: `[load] sky bake — 89951ms over 1 frame`, then CONTEXT_LOST_WEBGL. sky.js now re-issues
// the boot bake's single full-screen renderAsync as cost-weighted strips across frames (bandedBakeRender). This binds
// the property that makes that safe, in the real client page with the real three:
//   same     — a deterministic bake material (uv-only, no time uniforms) rendered as one quad and as bands gives
//              byte-identical pixels                                         [mutate: --mutate-gap drops one band → red]
//   bands    — it really rendered several strips, one per frame (not one draw)
//   seams    — the rows where strips meet match the one-draw render exactly (checked within 'same', listed)
// NOT bound here: the sky.js interception on the owner's machine. The headless GPU (SwiftShader) never takes the baked
// sky tier, so the boot bake does not run headless at all; the live proof is her console's
// '[sky] boot bake banded: N bands over M ms' line (and ?skyband=0 to compare).
// Usage: bun tools/sky-band-probe.mjs [origin] [--mutate-gap]   (run under a memory guard: headless Chromium renders on the CPU)
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';

const { check, done } = checker();
const GAP = process.argv.includes('--mutate-gap');
const world = await ownedWorld({ live: process.argv.slice(2).find((a) => a.startsWith('http')) ?? null });
const { browser, page } = await launchBrowser();
const pg = await page();
const errs = [];
pg.on('pageerror', (e) => errs.push(String(e)));

try {
  await pg.goto(`${world.origin}/?world=staging&name=skyband&key=${world.key}&xr=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 60000 });
  await pg.waitForTimeout(4000);
  const r = await Promise.race([pg.evaluate(async (gap) => {
    const { THREE, TSL, renderer } = await import('./lib/core.js');
    const { bandedBakeRender, bandCuts } = await import('./lib/sky_baked.js');
    const W = 256, H = 128, PASSES = 8, BUDGET = 16000;   // 256*128*8/16000 ≈ 17 strips
    const mat = new THREE.NodeMaterial();
    mat.fragmentNode = TSL.Fn(() => { const u = TSL.uv(); return TSL.vec4(u.x, u.y, TSL.sin(u.x.mul(37.0)).mul(TSL.cos(u.y.mul(23.0))).mul(0.5).add(0.5), 1); })();
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mk = () => new THREE.RenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
    const A = mk(), B = mk();
    const prev = renderer.getRenderTarget();
    await renderer.compileAsync(scene, cam);
    renderer.setRenderTarget(A); renderer.render(scene, cam); renderer.setRenderTarget(prev);
    // B starts a different colour so a missed strip cannot pass by accident
    { const clr = new THREE.Scene(); clr.background = new THREE.Color(1, 0, 1); renderer.setRenderTarget(B); renderer.render(clr, cam); renderer.setRenderTarget(prev); }
    let frames = 0;
    const nextFrame = () => new Promise((res) => requestAnimationFrame(() => { frames++; res(); }));
    const target = gap ? { width: W, height: H, __skip: true } : B;
    let n;
    if (gap) {   // mutant: render all strips but the middle one
      const origRender = renderer.render.bind(renderer); let k = 0; const cuts = bandCuts(W, H, PASSES, BUDGET); const mid = Math.floor((cuts.length - 1) / 2);
      renderer.render = (s, c) => { if (s.children?.some((m) => m.material === mat)) { if (k++ === mid) return undefined; } return origRender(s, c); };   // band renders only — the world's own frames run in between
      try { n = await bandedBakeRender(renderer, scene, cam, B, { cloudPasses: PASSES, passTexelBudget: BUDGET, nextFrame }); } finally { renderer.render = origRender; }
    } else n = await bandedBakeRender(renderer, scene, cam, target, { cloudPasses: PASSES, passTexelBudget: BUDGET, nextFrame });
    const a = await renderer.readRenderTargetPixelsAsync(A, 0, 0, W, H);
    const b = await renderer.readRenderTargetPixelsAsync(B, 0, 0, W, H);
    let diff = 0, maxd = 0; const badRows = new Set();
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { diff++; badRows.add(Math.floor(i / 4 / W)); } if (d > maxd) maxd = d; }
    const cuts = bandCuts(W, H, PASSES, BUDGET).map((v) => Math.round(v * H));
    return { n, frames, diff, maxd, badRows: [...badRows].slice(0, 12), cuts, total: a.length };
  }, GAP), new Promise((_, rej) => setTimeout(() => rej(new Error('page pinned 60 s')), 60000))]);
  console.log('  result:', JSON.stringify(r));
  check('bands: the bake was rendered as several strips, across frames', r.n >= 4 && r.frames >= r.n - 1, `${r.n} strips over ${r.frames} frames (cuts at rows ${r.cuts.join(',')})`);
  check('same: banded pixels are byte-identical to the one-draw bake (seam rows included)', r.diff === 0, `${r.diff} of ${r.total} bytes differ (max Δ ${r.maxd}); rows ${r.badRows.join(',') || '-'}`);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran to completion', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
