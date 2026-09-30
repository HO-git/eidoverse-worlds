// bun tools/xr-quad-colour-probe.mjs [--shots <dir>] — WHAT THE VR PANELS ACTUALLY PAINT (R's headset pass, 09-30:
// "little black squares like checkboxes" in World › Sky, "all colours washed out", "Style colour hexes don't render").
// The real client, ?xr=1, IWER session, the real domquad staging (its #xr-stage CSS) and the real vendored HTMLMesh.
//   raster  — each quad's canvas (texture.image) is dumped next to the desktop DOM shot of the same frame
//   swatch  — Settings › Style: every <input type=color> paints ITS colour on the quad (not the hex as text)
//   squares — World › Sky: no dark square is painted where the DOM shows none (hidden/unrendered form controls)
//   colour  — the quad's material through the REAL renderer's output pass: token colours in, the same values out
// On Chromium the engine runs WebGPURenderer's WebGL 2 backend in the headset too (owner, 09-30), so this headless
// path IS the user path for the output transform. What it can't show: the headset's own compositor/display.
// Run it under the house guards: flock the headless lock, perf-guard; clouds are forced off before boot here.
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const { check, done } = checker();
const shotDir = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
const shotBase = Number(process.env.SHOT_BASE ?? 100);
if (shotDir) mkdirSync(shotDir, { recursive: true });
const IWER_RAW = readFileSync(new URL('../node_modules/iwer/build/iwer.js', import.meta.url), 'utf8');
const DEVICE_LOOP = 'globalThis.requestAnimationFrame(this[P_SESSION].onDeviceFrame)';
if (IWER_RAW.split(DEVICE_LOOP).length !== 2) throw new Error(`iwer build changed: expected exactly one '${DEVICE_LOOP}'`);
const IWER = `globalThis.__iwerNativeRAF = globalThis.requestAnimationFrame.bind(globalThis);\n` +
  IWER_RAW.replace(DEVICE_LOOP, 'globalThis.__iwerNativeRAF(this[P_SESSION].onDeviceFrame)');

const world = await ownedWorld({ env: { SKIP_OPT_SWEEP: '1' } });
const { browser, page } = await launchBrowser();
const pg = await page();
const ev = (fn, arg) => Promise.race([pg.evaluate(fn, arg),
  new Promise((_, rej) => setTimeout(() => rej(new Error('page main thread pinned for 30 s')), 30000))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = shotBase;
const save = (name, dataUrl) => { if (!shotDir || !dataUrl) return; const f = `${shotDir}/${shotN++}-${name}.png`; writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64')); console.log(`  · shot ${f}`); };

await pg.addInitScript(() => { try { localStorage.setItem('ew-cloud-quality', 'off'); } catch {} });   // THE SKY GUARD, before boot
await pg.addInitScript(IWER);
await pg.addInitScript(() => {
  if (window.__probe) return;
  const { XRDevice, metaQuest3 } = window.IWER ?? {};
  if (!XRDevice) { window.__probe = { fatal: 'IWER did not load' }; return; }
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  window.__iwerDevice = device;
  try { delete window.IWER; } catch { window.IWER = undefined; }
  window.__probe = { grants: 0 };
  const real = navigator.xr.requestSession.bind(navigator.xr);
  navigator.xr.requestSession = async (...a) => { const s = await real(...a); window.__probe.grants++; return s; };
});
const errs = [];
pg.on('pageerror', (e) => errs.push(String(e)));
pg.on('console', (m) => { if (m.text().startsWith('[colourprobe]')) console.log('  · ' + m.text()); });
pg.on('dialog', (d) => d.dismiss().catch(() => {}));

try {
  await pg.goto(`${world.origin}/?world=staging&name=colourprobe&key=${world.key}&xr=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => { const b = document.querySelector('#xrbtn'); return !!b && getComputedStyle(b).display !== 'none'; }, null, { timeout: 90000 }).catch(() => {});
  await pg.waitForFunction(() => !!document.getElementById('sec-style-tab') && !!document.getElementById('sec-sky-tab'), null, { timeout: 60000 }).catch(() => {});   // settings' tabs load lazily (ui.js)
  const gate = await ev(() => ({ xrbtn: !!document.querySelector('#xrbtn'), domQuads: typeof globalThis.__domQuads, sky: !!document.getElementById('sec-sky-tab'), style: !!document.getElementById('sec-style-tab') }));
  check('booted: visor, domquad hook, the sky and style tabs', gate.xrbtn && gate.domQuads === 'function' && gate.sky && gate.style, JSON.stringify(gate));
  if (!(gate.xrbtn && gate.sky && gate.style)) throw new Error('boot gate failed');
  const backend = await ev(async () => (await import('./lib/core.js')).backendName());
  console.log(`  · backend: ${backend}`);

  // open both frames on the tabs under test (desktop), and shoot the DOM
  for (const [frame, tab] of [['world', 'sky'], ['settings', 'style']]) {
    await ev(async ([frame, tab]) => { const F = await import('./lib/frames.js'); F.getFrame(frame)?.show(); document.getElementById(`sec-${tab}-tab`).click(); }, [frame, tab]);
  }
  await sleep(800);
  for (const frame of ['world', 'settings']) {
    const el = await pg.$(`.frame[data-frame="${frame}"]`);
    if (shotDir && el) { const f = `${shotDir}/${shotN++}-desktop-${frame}.png`; await el.screenshot({ path: f }); console.log(`  · shot ${f}`); }
  }

  // ── into VR: the real entry stages the frames; show the two quads ──
  await ev(() => document.querySelector('#xrbtn').click());
  await pg.waitForFunction(() => window.__probe.grants >= 1 && globalThis.__domQuads().staged > 0, null, { timeout: 30000 }).catch(() => {});
  const shown = await ev(async () => { const D = await import('./lib/domquad.js'); return [D.domQuadShow('world', true), D.domQuadShow('settings', true)]; });
  check('in a session, the world and settings quads show', shown.every(Boolean), JSON.stringify(shown));
  await sleep(1500);   // SVG icons load async and re-raster through the observer

  const raster = await ev(async () => {
    const D = await import('./lib/domquad.js');
    const out = {};
    for (const id of ['world', 'settings']) {
      const t = D.domQuadTexture(id); const cv = t.image; const ctx = cv.getContext('2d');
      const el = t.dom; const er = el.getBoundingClientRect(); const s = cv.width / er.width;
      const px = (x, y) => Array.from(ctx.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data);
      // every form control the DOM does NOT render (hidden, display:none via CSS/attribute, zero-size, visibility)
      // must leave nothing on the quad; every one it DOES render is listed with what the quad shows at its centre
      const controls = [...el.querySelectorAll('input, select, option')].map((c) => {
        const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
        const rendered = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !c.closest('[hidden]') && c.checkVisibility?.() !== false;
        return { tag: c.tagName.toLowerCase(), type: c.type ?? null, value: c.value, rendered, x: r.left - er.left, y: r.top - er.top, w: r.width, h: r.height,
          centre: rendered ? px(r.left - er.left + r.width / 2, r.top - er.top + r.height / 2) : null };
      });
      out[id] = { url: cv.toDataURL('image/png'), w: cv.width, h: cv.height, controls };
    }
    return out;
  });
  save('quad-raster-world-sky', raster.world.url);
  save('quad-raster-settings-style', raster.settings.url);

  // ── #3: the Style swatches paint their colour ──
  const colours = raster.settings.controls.filter((c) => c.type === 'color' && c.rendered);
  console.log(`  · style swatches: ${JSON.stringify(colours.map((c) => ({ v: c.value, centre: c.centre })))}`);
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const near = (a, b, tol) => a && b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
  check('style: there are four colour swatches on the quad', colours.length === 4, `${colours.length}`);
  check('style: every swatch paints its own colour at its centre (±6)', colours.length > 0 && colours.every((c) => near(c.centre, hexRgb(c.value), 6)),
    JSON.stringify(colours.map((c) => `${c.value} → rgb(${c.centre?.slice(0, 3)})`)));

  // ── #1: nothing the DOM hides is painted as a box on the quad ──
  const sky = raster.world.controls;
  console.log(`  · sky controls: ${sky.length} (${sky.filter((c) => c.rendered).length} rendered); unrendered: ${JSON.stringify(sky.filter((c) => !c.rendered).map((c) => `${c.tag}${c.type ? ':' + c.type : ''}@${Math.round(c.x)},${Math.round(c.y)} ${Math.round(c.w)}×${Math.round(c.h)}`))}`);
  const squares = await ev(async () => {
    // paint census: every fill/stroke rect the rasteriser makes for an element the DOM does not render. The raster is
    // re-run with fill()/stroke() wrapped so each draw is attributed to the element being drawn at that moment.
    const D = await import('./lib/domquad.js');
    const t = D.domQuadTexture('world'); const root = t.dom;
        const unpainted = (e) => !e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const zeroOrHidden = new Set([...root.querySelectorAll('*')].filter(unpainted));
    const inHidden = (e) => { for (let n = e; n && n !== root.parentElement; n = n.parentElement) if (zeroOrHidden.has(n)) return true; return false; };
    const P = CanvasRenderingContext2D.prototype; const of = P.fill, os = P.stroke, ot = P.fillText; const hits = [];
    const gcs = window.getComputedStyle; let cur = null;
    window.getComputedStyle = function (e, ...a) { cur = e; return gcs.call(this, e, ...a); };
    P.fill = function (...a) { if (cur && inHidden(cur)) hits.push(`${cur.tagName.toLowerCase()}${cur.type ? ':' + cur.type : ''}.${cur.className || ''} fill ${this.fillStyle}`); return of.apply(this, a); };
    P.stroke = function (...a) { if (cur && inHidden(cur)) hits.push(`${cur.tagName.toLowerCase()}${cur.type ? ':' + cur.type : ''}.${cur.className || ''} stroke ${this.strokeStyle}`); return os.apply(this, a); };
    P.fillText = function (txt, ...a) { if (cur && inHidden(cur)) hits.push(`${cur.tagName.toLowerCase()}.${cur.className || ''} text '${txt}' ${this.fillStyle}`); return ot.call(this, txt, ...a); };
    try { t.paused = false; t.update(); } finally { P.fill = of; P.stroke = os; P.fillText = ot; window.getComputedStyle = gcs; }
    return { hits, hidden: zeroOrHidden.size, natives: root.querySelectorAll('select.dd-native').length };
  });
  console.log(`  · sky paint census: ${squares.natives} skinned native selects; ${squares.hidden} elements the DOM doesn't render; painted for them: ${JSON.stringify(squares.hits.slice(0, 12))}${squares.hits.length > 12 ? ` (+${squares.hits.length - 12})` : ''}`);
  check('sky: the quad paints NOTHING for an element the DOM does not render', squares.hits.length === 0, `${squares.hits.length} paints`);

  // ── exit, then #2: the quad material through the real renderer's output pass ──
  await ev(async () => { await window.__iwerDevice.activeSession?.end(); });
  await pg.waitForFunction(() => !window.__iwerDevice.activeSession, null, { timeout: 10000 }).catch(() => {});
  await sleep(500);
  const tokens = await ev(() => {
    const cs = getComputedStyle(document.documentElement); const n = document.createElement('canvas').getContext('2d');
    const norm = (v) => { n.fillStyle = '#000'; n.fillStyle = v; return n.fillStyle; };
    const out = {};
    for (const k of ['--fg', '--brand', '--attn', '--dim', '--accent']) { const v = cs.getPropertyValue(k).trim(); if (v) out[k] = norm(v); }
    const p = cs.getPropertyValue('--panel-rgb').trim().split(/\s+/).map(Number); if (p.length === 3) out['--panel-rgb'] = norm(`rgb(${p.join(',')})`);
    const st = document.getElementById('xr-stage-css')?.textContent.match(/\.frame\.panel \{[^}]*background: (rgb\([^)]*\))/);
    if (st) out['quad panel (lifted)'] = norm(st[1]);
    return out;
  });
  console.log(`  · tokens: ${JSON.stringify(tokens)}`);
  const measure = (exposure = null, path = 'domquad') => ev(async ([tokens, exposureSet, path]) => {
    const { THREE, renderer } = await import('./lib/core.js');
    const D = await import('./lib/domquad.js');
    const names = Object.keys(tokens); const cols = names.map((k) => tokens[k]);
    const cv = document.createElement('canvas'); cv.width = 64 * cols.length; cv.height = 64;
    const c2 = cv.getContext('2d'); cols.forEach((c, i) => { c2.fillStyle = c; c2.fillRect(i * 64, 0, 64, 64); });
    // the quad's OWN material, as domquad builds it (a stand-in HTMLMesh over a div painted in the token colours)
    const { HTMLMesh } = await import('./lib/vendor/htmlmesh.js');
    const div = document.createElement('div'); div.style.cssText = `position:fixed;left:0;top:0;width:${cols.length * 64}px;height:64px;display:flex`;
    for (const c of cols) { const s = document.createElement('div'); s.style.cssText = `width:64px;height:64px;background:${c}`; div.appendChild(s); }
    document.body.appendChild(div);
    let mesh = new HTMLMesh(div, { scale: 1 });
    if (path === 'canvasquads') {   // the ?canvasquads=1 fallback's own quad (xrpanels.makePanel), fed the same pixels
      const X = await import('./lib/xrpanels.js');
      const p = X.makePanel?.({ id: 'probe', fields: () => [], dispatch: () => {} }, 0, 1);
      if (p) { p.canvas.width = mesh.material.map.image.width; p.canvas.height = mesh.material.map.image.height; p.canvas.getContext('2d').drawImage(mesh.material.map.image, 0, 0); p.tex.needsUpdate = true;
        p.mesh.scale.set(cols.length * 0.064, 0.064, 1); p.mesh.position.set(0, 0, 0); p.mesh.rotation.set(0, 0, 0); mesh = p.mesh; mesh.material.map.pause = () => {}; }
    }
    if (path === 'domquad') { mesh.material.transparent = false; mesh.material.alphaTest = 0.5; }
    if (path === 'domquad') D.prepareQuadMaterial?.(mesh);   // absent on a parent without the fix: the stand-in then carries the bare HTMLMesh material
    div.remove(); mesh.material.map.pause();
    const sc = new THREE.Scene(); sc.add(mesh);
    const w = cols.length * 0.064, cam = new THREE.OrthographicCamera(-w / 2, w / 2, 0.032, -0.032, 0.01, 10); cam.position.z = 1;
    const size = renderer.getSize(new THREE.Vector2()); const dpr = renderer.getPixelRatio();
    const read = () => { renderer.render(sc, cam); const g = renderer.domElement; const tmp = document.createElement('canvas'); tmp.width = g.width; tmp.height = g.height; const t2 = tmp.getContext('2d'); t2.drawImage(g, 0, 0);
      return names.map((_, i) => Array.from(t2.getImageData(Math.round(((i + 0.5) / cols.length) * g.width), Math.round(g.height / 2), 1, 1).data).slice(0, 3)); };
    const exp0 = renderer.toneMappingExposure; if (exposureSet != null) renderer.toneMappingExposure = exposureSet;
    for (let k = 0; k < 6; k++) { read(); await new Promise((r) => setTimeout(r, 120)); }   // pipelines compile
    const got = read();
    const fbt = [...(renderer._frameBufferTargets?.values?.() ?? [])].map((t) => ({ type: t.texture.type, samples: t.samples }));
    const served = await fetch('/lib/quadcolour.js').then((r) => r.text()).then((t) => /div\(toneMappingExposure\);/.test(t) && !/max\(mat3/.test(t)).catch(() => null);
    const gl = renderer.backend?.gl; const cbf = gl ? !!gl.getExtension('EXT_color_buffer_float') : null;
    console.log('[colourprobe] fbt', JSON.stringify(fbt), 'served-unclamped', served, 'EXT_color_buffer_float', cbf);
    const exposure = renderer.toneMappingExposure, toneMapping = renderer.toneMapping;
    const url = (() => { renderer.render(sc, cam); const g = renderer.domElement; const tmp = document.createElement('canvas'); tmp.width = g.width; tmp.height = g.height; tmp.getContext('2d').drawImage(g, 0, 0); return tmp.toDataURL('image/png'); })();
    renderer.toneMappingExposure = exp0;
    mesh.dispose?.();
    return { names, want: cols, got, exposure, toneMapping, url, size: [size.x, size.y, dpr] };
  }, [tokens, exposure, path]);
  const setGrade = (g) => ev(async (g) => (await import('./lib/quadcolour.js').catch(() => null))?.setGrade(g, false) ?? null, g);
  const hadGrade = await setGrade({ saturation: 1, contrast: 1 });   // null on a parent without quadcolour.js
  const m = await measure();
  save('quad-output-swatches', m.url);
  const rows = m.names.map((k, i) => ({ k, want: m.want[i], got: `#${m.got[i].map((v) => v.toString(16).padStart(2, '0')).join('')}`, d: Math.max(...m.got[i].map((v, j) => Math.abs(v - hexRgb(m.want[i])[j]))) }));
  console.log(`  · output pass (toneMapping ${m.toneMapping}, exposure ${m.exposure}):`);
  for (const r of rows) console.log(`      ${r.k.padEnd(20)} token ${r.want}  → on screen ${r.got}   (max Δ ${r.d})`);
  check('colour: every token colour leaves the renderer as it went in (max Δ ≤ 4 of 255)', rows.every((r) => r.d <= 4), rows.map((r) => `${r.k} Δ${r.d}`).join(', '));
  // the sky moves the exposure (sky.js: warmth, the exposure slider); the panel must not move with it
  const me = await measure(0.7);
  const rowsE = me.names.map((k, i) => ({ k, d: Math.max(...me.got[i].map((v, j) => Math.abs(v - hexRgb(me.want[i])[j]))) }));
  console.log(`  · at exposure ${me.exposure}: ${me.names.map((k, i) => `${k} ${me.want[i]}→#${me.got[i].map((v) => v.toString(16).padStart(2, '0')).join('')}`).join(', ')}`);
  check('colour: …and at a dimmer sky\'s exposure (0.7) too', rowsE.every((r) => r.d <= 4), rowsE.map((r) => `${r.k} Δ${r.d}`).join(', '));
  // the ?canvasquads=1 fallback (xrpanels.makePanel): its CanvasTexture carried no colorSpace
  const mc = await measure(null, 'canvasquads');
  const rowsC = mc.names.map((k, i) => ({ k, d: Math.max(...mc.got[i].map((v, j) => Math.abs(v - hexRgb(mc.want[i])[j]))) }));
  console.log(`  · canvasquads fallback: ${mc.names.map((k, i) => `${k} ${mc.want[i]}→#${mc.got[i].map((v) => v.toString(16).padStart(2, '0')).join('')}`).join(', ')}`);
  check('colour: the ?canvasquads fallback quad shows the token colours too', rowsC.every((r) => r.d <= 4), rowsC.map((r) => `${r.k} Δ${r.d}`).join(', '));
  // the REAL settings and world quads (their own material, as domquad builds them) through the output pass, for the eye
  for (const id of ['settings', 'world']) {
    const url = await ev(async (id) => {
      const { THREE, renderer } = await import('./lib/core.js');
      const D = await import('./lib/domquad.js');
      const rig = new THREE.Scene(); D.domQuadsEnter(rig); D.domQuadShow(id, true);   // staged again (the session is over) to draw it
      await new Promise((r) => setTimeout(r, 800));
      const mesh = rig.children.find((o) => o.material?.map === D.domQuadTexture(id));
      rig.children.forEach((o) => { o.visible = o === mesh; });
      mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(mesh); const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
      const g = renderer.domElement; const asp = g.width / g.height; const hw = Math.max(w / 2, h / 2 * asp), hh = hw / asp;
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 10); cam.position.z = 1;
      rig.background = new THREE.Color(0x000000);
      let out = null;
      for (let k = 0; k < 6; k++) { renderer.render(rig, cam); await new Promise((r) => setTimeout(r, 120)); }
      renderer.render(rig, cam); const tmp = document.createElement('canvas'); tmp.width = g.width; tmp.height = g.height; tmp.getContext('2d').drawImage(g, 0, 0); out = tmp.toDataURL('image/png');
      D.domQuadsExit(rig);
      return out;
    }, id);
    save(`quad-rendered-${id}`, url);
  }
  if (hadGrade) {   // the VR grade: default and both extremes, against the pure-math twin (tools/quadcolour-test.mjs tests the twin)
    const { gradeSRGB, GRADE_DEFAULT, GRADE_RANGE } = await import('../client/lib/quadgrade.js').catch(() => ({}));
    for (const [tag, g] of [['default', GRADE_DEFAULT], ['low', { saturation: GRADE_RANGE.saturation[0], contrast: GRADE_RANGE.contrast[0] }], ['high', { saturation: GRADE_RANGE.saturation[1], contrast: GRADE_RANGE.contrast[1] }]]) {
      await setGrade(g);
      const mg = await measure(); save(`quad-output-grade-${tag}`, mg.url);
      const errsG = mg.names.map((k, i) => { const want = gradeSRGB(hexRgb(mg.want[i]).map((v) => v / 255), g).map((v) => Math.round(v * 255)); return { k, want, got: mg.got[i], d: Math.max(...want.map((v, j) => Math.abs(v - mg.got[i][j]))) }; });
      console.log(`  · grade ${tag} ${JSON.stringify(g)}: ${errsG.map((r) => `${r.k} want(${r.want}) got(${r.got}) Δ${r.d}`).join('; ')}`);
      check(`grade ${tag}: the quad shows the graded token colours (max Δ ≤ 4)`, errsG.every((r) => r.d <= 4), errsG.map((r) => `${r.k} Δ${r.d}`).join(', '));
    }
    await setGrade(GRADE_DEFAULT);
  }
  if (hadGrade) {   // Settings › VR carries the two sliders, and moving one moves the quads' grade (and persists)
    const vr = await ev(async () => {
      document.getElementById('sec-vr-tab')?.click(); await new Promise((r) => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('#sec-vr .row')].filter((r) => /panel (sat|contr)/.test(r.querySelector('.nm')?.textContent ?? ''));
      const sat = rows.find((r) => /sat/.test(r.textContent))?.querySelector('input[type=range]');
      if (!sat) return { rows: rows.length };
      sat.value = '1.6'; sat.dispatchEvent(new Event('input'));
      const Q = await import('./lib/quadcolour.js');
      const out = { rows: rows.length, grade: Q.currentGrade(), stored: localStorage.getItem('ew-xr-panel-grade') };
      Q.setGrade(Q.GRADE_DEFAULT);
      return out;
    });
    check('Settings › VR: the panel saturation/contrast sliders drive the quads\' grade and persist', vr.rows === 2 && Math.abs(vr.grade?.saturation - 1.6) < 1e-6 && /1\.6/.test(vr.stored ?? ''), JSON.stringify(vr));
  }
  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { check('probe ran', false, e.stack || e.message); }
finally {
  try { await browser.close(); } catch {}
  try { await world.close(); } catch {}
}
done();
