// gpulost's decisions, headless: reload once, never loop; the XR boot flag is dropped. `node tools/gpulost-test.mjs`
import { gpuLostAction, recoveryUrl, GPU_LOST_WINDOW_MS } from '../client/lib/gpulost.js';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`  FAIL ${n} ${d}`); } };
const now = 1_000_000;
ok('first loss reloads', gpuLostAction(now, []).reload === true);
ok('…and records it', JSON.stringify(gpuLostAction(now, []).recent) === `[${now}]`);
ok('a second loss inside the window does NOT reload (no loop)', gpuLostAction(now, [now - 5000]).reload === false);
ok('a loss outside the window reloads again', gpuLostAction(now, [now - GPU_LOST_WINDOW_MS - 1]).reload === true);
ok('stale and junk history is dropped', JSON.stringify(gpuLostAction(now, [now - GPU_LOST_WINDOW_MS - 1, 'x', null, now + 99999]).recent) === `[${now}]`);
ok('recovery drops ?xr and ?why, keeps world/name/key', recoveryUrl('https://h:1/?world=commons&name=Ada&key=K&xr=1&why=vr-webgl&vrprobe=1') === 'https://h:1/?world=commons&name=Ada&key=K&vrprobe=1');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
