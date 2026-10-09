// bun tools/full-detail-test.ts — the resident's "keep full detail" switch (governor.js setFullDetail). While it is on
// the governor never sheds a lever and the dead-band cruise never steps pixels; turning it on hands back whatever was
// already shed, at once; the choice persists. The REAL governor.js runs over tools/lod-client-stub.mjs (same cone as
// governor-xr-test). Controls: the same drives with the switch off DO shed, so every "nothing moved" has a subject.
import { plugin } from 'bun';
import { fileURLToPath } from 'node:url';
const STUB = fileURLToPath(new URL('./lod-client-stub.mjs', import.meta.url));
plugin({ name: 'full-detail-stub', setup(b) {
  for (const f of ['^\\./core\\.js$', '^\\./warmqueue\\.js$', '^\\./loadwork\\.js$', '^\\./lightrig\\.js$', '^\\./emitters\\.js$',
    '^\\./terrain\\.js$', '^\\./remotes\\.js$', '^\\./frame\\.js$', '^\\./ui\\.js$', '^\\./statuschips\\.js$',
    '^\\.\\./core\\.js$', '^\\.\\./assets\\.js$', '^\\.\\./colliders\\.js$', '^\\.\\./lightrig\\.js$', '^\\.\\./lights\\.js$', '^\\.\\./world\\.js$'])
    b.onResolve({ filter: new RegExp(f) }, () => ({ path: STUB }));
} });
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d: unknown = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${n}${ok ? '' : `  ${JSON.stringify(d)}`}`); };

const stub: any = await import(STUB);
stub.renderer.setPixelRatio = () => {};
stub.renderer.xr = { isPresenting: false };
const G: any = await import('../client/lib/governor.js');
const dbg = () => G.governorDebug();
const sheds = () => (dbg().history as string[]).filter((h) => h.startsWith('−')).length;
const tick = (fps: number) => { G.governPerformance(fps); G.applyPendingPixelRatio(); };

check('default is off (the governor drives, as upstream)', G.getFullDetail() === false && dbg().fullDetail === false);

// CONTROL: switch off, sustained slow seconds shed down the ladder
for (let i = 0; i < 60; i++) tick(12);
const shedState = dbg();
check('control — off, slow: the ladder sheds (pixels below base, detail shed)', sheds() > 0 && shedState.pixelRatio < 1 && shedState.detailShed, shedState);

// switching on hands everything back at once — no 5s-smooth streaks needed
G.setFullDetail(true);
G.applyPendingPixelRatio();
const back = dbg();
check('on: pixel ratio back to base immediately', back.pixelRatio === 1, back);
check('on: detail (LOD bias + shadow map) restored immediately', back.detailShed === false, back);
check('on: persisted', mem.get('ew-full-detail') === '1', [...mem]);

// on, slow: nothing sheds
const s0 = sheds();
for (let i = 0; i < 60; i++) tick(12);
check('on, slow for 60s: no lever sheds', sheds() === s0 && dbg().pixelRatio === 1 && !dbg().detailShed, dbg());

// on, dead band: the cruise does not step pixels either
for (let i = 0; i < 60; i++) tick(40);
check('on, sustained mid fps: no cruise pixel step', sheds() === s0 && dbg().pixelRatio === 1, dbg());

// off again: the governor resumes (and the cruise with it)
G.setFullDetail(false);
check('off: persisted', mem.get('ew-full-detail') === '0');
for (let i = 0; i < 30; i++) tick(40);
check('control — off, sustained mid fps: the cruise DOES step pixels', dbg().pixelRatio < 1, dbg());
for (let i = 0; i < 80; i++) tick(72);
for (let i = 0; i < 60; i++) tick(12);
check('control — off, slow: the ladder sheds again', sheds() > s0, dbg().history.slice(-4));

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
