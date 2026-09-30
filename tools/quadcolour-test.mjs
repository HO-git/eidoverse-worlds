// The VR panel grade as pure numbers (client/lib/quadgrade.js): gradeSRGB is the JS twin of the shader grade in
// quadcolour.js, and tools/xr-quad-colour-probe.mjs holds the GPU to it at the default and both extremes. This file
// holds the twin to what the grade must mean. Also the persisted choice: garbage and out-of-range come back sane.
//   bun tools/quadcolour-test.mjs
import { gradeSRGB, GRADE_DEFAULT, GRADE_RANGE, loadGrade, LUMA } from '../client/lib/quadgrade.js';
let pass = 0, fail = 0;
const check = (name, ok, note = '') => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${note ? `  -- ${note}` : ''}`); } };
const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= e);
const luma = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
const brand = [0x8f / 255, 0xe8 / 255, 0xc8 / 255], panel = [5 / 255, 20 / 255, 20 / 255], grey = [0.3, 0.3, 0.3];
const spread = (c) => Math.max(...c) - Math.min(...c);

console.log('VR PANEL GRADE (pure)');
check('neutral (1, 1) is the identity', [brand, panel, grey, [0, 0, 0], [1, 1, 1]].every((c) => near(gradeSRGB(c, { saturation: 1, contrast: 1 }), c)));
check('saturation leaves a grey grey', near(gradeSRGB(grey, { saturation: 1.8, contrast: 1 }), grey));
check('saturation keeps luma (unclamped colour)', Math.abs(luma(gradeSRGB(brand, { saturation: 1.15, contrast: 1 })) - luma(brand)) < 1e-9);
check('saturation > 1 spreads the channels, < 1 closes them', spread(gradeSRGB(brand, { saturation: 1.5 })) > spread(brand) && spread(gradeSRGB(brand, { saturation: 0.5 })) < spread(brand));
check('saturation 0 is its luma grey', (() => { const g = gradeSRGB(brand, { saturation: 0 }); return near(g, [luma(brand), luma(brand), luma(brand)]); })());
check('contrast pivots on mid-grey', near(gradeSRGB([0.5, 0.5, 0.5], { contrast: 1.7 }), [0.5, 0.5, 0.5]));
check('contrast > 1 pushes dark down and light up', (() => { const d = gradeSRGB(panel, { contrast: 1.2 }), l = gradeSRGB([0.8, 0.8, 0.8], { contrast: 1.2 }); return d[1] < panel[1] && l[0] > 0.8; })());
check('the result stays in [0, 1] at the extremes', [brand, panel, [1, 0, 0], [0, 0, 1]].every((c) => gradeSRGB(c, { saturation: GRADE_RANGE.saturation[1], contrast: GRADE_RANGE.contrast[1] }).every((v) => v >= 0 && v <= 1)));
check('the default is a MODEST boost (both > 1, both ≤ 1.2)', GRADE_DEFAULT.saturation > 1 && GRADE_DEFAULT.saturation <= 1.2 && GRADE_DEFAULT.contrast > 1 && GRADE_DEFAULT.contrast <= 1.2, JSON.stringify(GRADE_DEFAULT));
check('the default sits inside its ranges', GRADE_DEFAULT.saturation >= GRADE_RANGE.saturation[0] && GRADE_DEFAULT.saturation <= GRADE_RANGE.saturation[1] && GRADE_DEFAULT.contrast >= GRADE_RANGE.contrast[0] && GRADE_DEFAULT.contrast <= GRADE_RANGE.contrast[1]);

// the persisted choice
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
check('nothing stored → the default', near(Object.values(loadGrade()), [GRADE_DEFAULT.saturation, GRADE_DEFAULT.contrast]));
store.set('ew-xr-panel-grade', '{not json'); check('garbage → the default', near(Object.values(loadGrade()), [GRADE_DEFAULT.saturation, GRADE_DEFAULT.contrast]));
store.set('ew-xr-panel-grade', JSON.stringify({ saturation: 99, contrast: -3 })); check('out of range → clamped to the range', near(Object.values(loadGrade()), [GRADE_RANGE.saturation[1], GRADE_RANGE.contrast[0]]));
store.set('ew-xr-panel-grade', JSON.stringify({ saturation: 1.4, contrast: 'x' })); check('a good key kept, a bad one defaulted', near(Object.values(loadGrade()), [1.4, GRADE_DEFAULT.contrast]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
