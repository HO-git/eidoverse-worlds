// bun tools/governor-xr-test.ts — in a headset the frame governor never moves the pixel ratio (#32 split vision: in XR
// the ratio scales each EYE'S VIEWPORT, not the resolution). Three guards in governor.js: the 'pixels' lever's shed and
// restore, and the dead-band 'cruise' step. The REAL governor.js runs over tools/lod-client-stub.mjs (its renderer is a
// plain object, so presenting is a flag here). Each case drives the governor's own 1 Hz input (governPerformance) and
// reads its own history + the pixel ratio it set. Controls: the same drive on the desktop DOES move pixels.
import { plugin } from 'bun';
import { fileURLToPath } from 'node:url';
const STUB = fileURLToPath(new URL('./lod-client-stub.mjs', import.meta.url));
plugin({ name: 'governor-xr-stub', setup(b) {
  // the same cone lod-client-test stubs: governor.js and the REAL realize/models.js it imports stay real
  for (const f of ['^\\./core\\.js$', '^\\./warmqueue\\.js$', '^\\./loadwork\\.js$', '^\\./lightrig\\.js$', '^\\./emitters\\.js$',
    '^\\./terrain\\.js$', '^\\./remotes\\.js$', '^\\./frame\\.js$', '^\\./ui\\.js$',
    '^\\.\\./core\\.js$', '^\\.\\./assets\\.js$', '^\\.\\./colliders\\.js$', '^\\.\\./lightrig\\.js$', '^\\.\\./lights\\.js$', '^\\.\\./world\\.js$'])
    b.onResolve({ filter: new RegExp(f) }, () => ({ path: STUB }));
} });
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d: unknown = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${JSON.stringify(d)}`}`); };

const stub: any = await import(STUB);
const ratios: number[] = [];
stub.renderer.setPixelRatio = (r: number) => { ratios.push(r); };
stub.renderer.xr = { isPresenting: false };
const G: any = await import('../client/lib/governor.js');
const hist = () => (G.governorDebug().history as string[]);
const pixelMoves = () => hist().filter((h) => /pixels/.test(h)).length;

// 1. SLOW seconds in a headset: the ladder must skip 'pixels' (shed returns false) and never touch the ratio
stub.renderer.xr.isPresenting = true;
const r0 = ratios.length, p0 = pixelMoves();
for (let i = 0; i < 40; i++) G.governPerformance(12);
check('headset, slow: no pixel-ratio write and no "pixels" rung', ratios.length === r0 && pixelMoves() === p0, { writes: ratios.slice(r0), hist: hist().slice(-4) });
check('…but the ladder still acts on something else (it moved on, not stalled)', hist().some((h) => h.startsWith('−') && !/pixels/.test(h)), hist().slice(-4));

// 2. MID (dead-band) seconds in a headset: the cruise step must not fire either
const r1 = ratios.length, p1 = pixelMoves();
for (let i = 0; i < 40; i++) G.governPerformance(40);
check('headset, sustained mid fps (cruise regime): no pixel-ratio write', ratios.length === r1 && pixelMoves() === p1, { writes: ratios.slice(r1), hist: hist().slice(-4) });

// 3. FAST seconds in a headset, starting BELOW base (shed on the desktop first — otherwise restore has nothing to raise
//    and the check could never fail): restore must not raise the ratio while presenting
stub.renderer.xr.isPresenting = false;
for (let i = 0; i < 60 && G.governorDebug().pixelRatio >= 1; i++) G.governPerformance(12);
const shedTo = G.governorDebug().pixelRatio;
stub.renderer.xr.isPresenting = true;
const r2 = ratios.length;
for (let i = 0; i < 60; i++) G.governPerformance(72);
check('headset, fast, ratio below base: restore does NOT raise it', shedTo < 1 && ratios.length === r2 && G.governorDebug().pixelRatio === shedTo, { shedTo, writes: ratios.slice(r2), now: G.governorDebug().pixelRatio });
stub.renderer.xr.isPresenting = false;
for (let i = 0; i < 80; i++) G.governPerformance(72);
check('control — desktop, fast: the SAME state DOES restore the ratio', G.governorDebug().pixelRatio > shedTo, { shedTo, now: G.governorDebug().pixelRatio });

// CONTROL: the same slow drive on the desktop DOES shed pixels (the measurement has a subject)
stub.renderer.xr.isPresenting = false;
const r3 = ratios.length;
for (let i = 0; i < 60; i++) G.governPerformance(12);
check('control — desktop, slow: the governor DOES move the pixel ratio', ratios.length > r3 && hist().some((h) => /− pixels/.test(h)), { writes: ratios.slice(r3), hist: hist().slice(-4) });

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
