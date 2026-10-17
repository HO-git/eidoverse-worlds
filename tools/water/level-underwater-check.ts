// Underwater under the world's water LEVEL (lakes, rivers, the sea), in a real browser, on both backends.
//   WATER_PREVIEW_URL=http://127.0.0.1:<port>/?world=<fresh>&spectate=1&name=lvl bun tools/water/level-underwater-check.ts
// A terrain with a level is applied locally (the real terrain + water build), the camera is driven (renderer
// mode) above the deepest wet spot, under its surface looking level, and under it looking up. Checks: the
// underwater state turns on only under the surface; the image under it is fogged (calmer, toward the water's
// colour) while above it is not; no shader errors on WebGPU or WebGL. SHOT_DIR=<dir> saves the frames.
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.WATER_PREVIEW_URL ?? 'http://127.0.0.1:19347/?world=level-underwater&spectate=1&name=lvl';
const shots = process.env.SHOT_DIR; if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
try {
  for (const backend of ['webgpu', 'webgl']) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()); });
    // The ground builder is upstream's engine module (/library/eidoverse/terrain.js), not in this repo; a test
    // preview's library may not carry it. Stand in with this repo's own height law (shared/terrainmath.js — the
    // law the server and agents use), so the water fills real lows; never fetched from any other server.
    await page.route('**/library/eidoverse/terrain.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '// stand-in: makeTerrain is defined by the test' }));
    await page.goto(`${base}&${backend}=1`);
    await page.waitForFunction(() => !!globalThis.__waterDebug);
    await page.evaluate(async () => { const st = await import('/lib/state.js'); for (let i = 0; i < 200 && !st.state.hydrated; i++) await new Promise((r) => setTimeout(r, 50)); });
    const r = await page.evaluate(async () => {
      const { camera, renderer, scene } = await import('/lib/core.js');
      const { CONFIG } = await import('/lib/base.js'); CONFIG.renderer = true;   // we drive the camera
      const { applyTerrainState } = await import('/lib/world.js');
      const { THREE } = await import('/lib/core.js'), tm = await import('/shared/terrainmath.js');
      (globalThis as any).makeTerrain = (args: any) => {
        const p = tm.terrainParams(args), h = tm.makeHeightField(p), geo = new THREE.PlaneGeometry(p.size, p.size, 128, 128).rotateX(-Math.PI / 2);
        const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, h(pos.getX(i), pos.getZ(i)));
        geo.computeVertexNormals();
        return { mesh: new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ color: 0x7a8a5a, roughness: 0.95 })), heightAt: h };
      };
      const lw = await import('/lib/water.js'), wv = await import('/lib/watervolumes.js'); (globalThis as any).__lvlDebug = [];
      // a level at the ground's 35th percentile: a third of the square floods, whatever the seed makes
      const { heightAt } = await import('/lib/terrain.js');
      // applyTerrainState queues the build (world.js enqueueWorldBuild): wait for each to land
      const until = async (ok: () => boolean, what: string) => { for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); if (!ok()) throw Error(`${what} never landed`); };
      const ground = { seed: 11, size: 120, amplitude: 7 };
      const sample = () => { const hs: number[] = []; for (let x = -55; x <= 55; x += 5) for (let z = -55; z <= 55; z += 5) hs.push(heightAt(x, z)); return hs.sort((a, b) => a - b); };
      applyTerrainState(ground); await until(() => { const h = sample(); return h[h.length - 1] - h[0] > 1; }, 'the terrain');
      const hs = sample(), level = hs[Math.floor(hs.length * 0.35)];
      applyTerrainState({ ...ground, water: { level } }); await until(() => lw.waterLevel() === level, 'the water level');
      // a real sky over it (its domes draw unfogged — the under-dome must hide them below the surface)
      const st = await import('/lib/state.js'); st.foldLive({ seq: 1e9, ts: Date.now(), actor: 'test', verb: 'sky', args: { hours: 11 } });
      await new Promise((r) => setTimeout(r, 1500));
      // the deepest wet spot on a coarse scan
      let best: any = null;
      for (let x = -40; x <= 40; x += 2.5) for (let z = -40; z <= 40; z += 2.5) {   // away from the square's edge
        const w = lw.waterAt(x, z); if (w && (!best || w.depth > best.depth)) best = { x, z, depth: w.depth, kind: w.kind };
      }
      if (!best) return { error: 'no water in the test terrain' };
      const frame = async (pos: number[], look: number[]) => {
        camera.position.set(pos[0], pos[1], pos[2]); camera.lookAt(look[0], look[1], look[2]); camera.updateMatrixWorld();
        wv.updateWater();
        await renderer.compileAsync(scene, camera);
        // WebGL compiles in parallel and skips a draw until its program is ready: settle a few frames, then
        // capture right after our own render (the drawing buffer is only valid until the next composite)
        const { renderWorld } = await import('/lib/render.js');
        for (let i = 0; i < 4; i++) { wv.updateWater(); renderWorld(); await new Promise((r) => setTimeout(r, 60)); }
        wv.updateWater(); renderWorld();
        const under = wv.underLevel();
        if (under && (globalThis as any).__lvlDebug) {
          const sheet = scene.children.find((o: any) => o.name === 'water');
          (globalThis as any).__lvlDebug.push({ far: camera.far, near: camera.near, sheet: sheet ? { side: sheet.material.side, visible: sheet.visible, y: sheet.position.y, idx: sheet.geometry.index?.count } : null,
            domes: scene.children.filter((o: any) => o.geometry?.type === 'SphereGeometry').map((o: any) => ({ r: o.geometry.parameters.radius, visible: o.visible, order: o.renderOrder, fog: o.material.fog, depthTest: o.material.depthTest, transparent: o.material.transparent })),
            sky: scene.children.filter((o: any) => o.material && o.material.fog === false).map((o: any) => ({ type: o.geometry?.type, order: o.renderOrder, depthTest: o.material.depthTest, depthWrite: o.material.depthWrite, scale: o.scale?.x })), cam: camera.position.toArray().map((v: number) => +v.toFixed(2)) });
        }
        const url = renderer.domElement.toDataURL('image/png');
        return { under, url };
      };
      const surf = lw.surfaceHeightAt(best.x, best.z)!;
      const out: any = { best, surf };
      out.above = await frame([best.x - 6, surf + 3, best.z - 6], [best.x + 6, surf - 1, best.z + 6]);
      out.below = await frame([best.x, surf - Math.min(1.2, best.depth * 0.5), best.z], [best.x + 10, surf - Math.min(1.2, best.depth * 0.5), best.z]);
      out.up = await frame([best.x, surf - Math.min(1.2, best.depth * 0.5), best.z], [best.x + 1, surf + 10, best.z + 0.5]);
      out.debug = (globalThis as any).__lvlDebug;
      return out;
    });
    assert.ok(!r.error, r.error);
    // pixel statistics from the PNGs, in the page (mean colour and spread)
    const stats = await page.evaluate(async (urls: string[]) => Promise.all(urls.map(async (u) => {
      const img = new Image(); img.src = u; await img.decode();
      const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d')!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data; let n = 0, s = [0, 0, 0], q = 0;
      for (let i = 0; i < d.length; i += 16) { n++; for (let k = 0; k < 3; k++) s[k] += d[i + k]; q += (d[i] + d[i + 1] + d[i + 2]) ** 2; }
      const m = s.map((v) => v / n), lum = (m[0] + m[1] + m[2]); return { mean: m.map((v) => Math.round(v)), spread: Math.round(Math.sqrt(Math.max(0, q / n - lum * lum))) };
    })), [r.above.url, r.below.url, r.up.url]);
    if (shots) for (const [k, v] of Object.entries({ above: r.above.url, below: r.below.url, up: r.up.url })) writeFileSync(`${shots}/${backend}-${k}.png`, Buffer.from((v as string).split(',')[1], 'base64'));
    console.log(backend, JSON.stringify({ spot: r.best, under: [r.above.under, r.below.under, r.up.under], stats }));
    if (process.env.LVL_DEBUG) console.log(JSON.stringify(r.debug, null, 1));
    assert.equal(r.above.under, false, 'above the surface is not underwater');
    assert.equal(r.below.under, true, 'below the surface is underwater');
    assert.equal(r.up.under, true);
    assert.ok(stats[1].spread < stats[0].spread * 0.5, 'under water the view is fogged (well under half the contrast above)');
    assert.deepEqual(errors.filter((e) => /shader|WGSL|GLSL|compile|TSL/i.test(e)), [], `${backend}: shader errors`);
    console.log(`PASS (${backend}): underwater only under the surface, fogged below, clear above, no shader errors`);
    await page.close();
  }
} finally { await browser.close(); }
