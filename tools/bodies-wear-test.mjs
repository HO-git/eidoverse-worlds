// bodies-wear-test — the Profile must offer a way BACK to a body that failed to load (#196 review B1).
//
// `getMyAvatarName()` is INTENT and survives a failed load, so gating the row's `wear` action on it
// left the body that just failed marked active with no action — the one body a first-time user owns.
// This drives the REAL client/lib/bodies.js `fields()`.
//
// Run: BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/bodies-wear-test.mjs
//
// Mutations that must turn a named check red:
//   bodies.js: `const onMe = n === cur && !!getMe() && !getMe()?.isCapsule;` → `n === cur`
//   bodies.js: drop the `!getMe()?.isCapsule` clause
//   mybody.js: restore the unconditional same-path early return in wireAvatarSwitch
import { plugin } from 'bun';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const dir = dirname(fileURLToPath(import.meta.url));

// The body state the Profile reads. `me` is what is ACTUALLY on screen; `name` is what we intended.
const state = (globalThis.__bodyState ||= { me: null, name: null });

// bodies.js reads the worn list from localStorage AT IMPORT, so it must exist before the dynamic
// import below — otherwise `mine` is empty, every row is undefined, and the checks below would be
// asserting over absent rows (a green from an empty measurement is the failure this repo keeps
// scarring on). A real browser has this key the moment you have ever worn anything.
const store = new Map([['ew-worn', JSON.stringify(['claude'])]]);
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

plugin({
  name: 'bodies-stubs',
  setup(b) {
    b.onResolve({ filter: /^\.\/mybody\.js$/ }, () => ({ path: here('./bodies-mybody-stub.mjs') }));
    b.onResolve({ filter: /^\.\/palette\.js$/ }, () => ({ path: here('./bodies-inert-stub.mjs') }));
    b.onResolve({ filter: /^\.\/net\.js$/ }, () => ({ path: here('./bodies-net-stub.mjs') }));
    b.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
    b.onResolve({ filter: /^\.\/base\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
    b.onResolve({ filter: /^\.\/panels\.js$/ }, () => ({ path: here('./bodies-inert-stub.mjs') }));
  },
});

const { bodiesFields } = await import('../client/lib/bodies.js');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
};
const rowsOf = (f) => f.find((x) => x.t === 'list')?.rows ?? [];
const wearing = (f) => f.find((x) => x.label === 'wearing')?.value;
const hasWear = (row) => (row?.actions ?? []).some((a) => a.k === 'wear');

// ---------------------------------------------------------------- a body that loaded
state.name = 'claude';
state.me = { isCapsule: false };
let f = bodiesFields();
let row = rowsOf(f).find((r) => r.id === 'claude');
// Guard the SUBJECT before asserting about it: with no row, every `row?.active !== true` below is
// vacuously true and the suite reports green over nothing.
check('the list actually contains the body under test (not an empty measurement)', !!row);
check('the worn body is marked active', row?.active === true);
check('the worn body offers no redundant wear action', !hasWear(row));
check('the wearing row names it', wearing(f) === 'claude');

// ---------------------------------------------------------------- the body FAILED: capsule on screen
state.me = { isCapsule: true };          // intent unchanged: `name` is still 'claude'
f = bodiesFields();
row = rowsOf(f).find((r) => r.id === 'claude');
check('the wearing row tells the truth when the capsule is on screen',
  /capsule/i.test(String(wearing(f))), `got "${wearing(f)}"`);
check('the failed body is NOT marked active (nothing is worn)', row?.active !== true);
check('the failed body offers a wear action — the door back out',
  hasWear(row), 'a first-time user with one body cannot retry it');

// ---------------------------------------------------------------- no body at all
state.me = null;
f = bodiesFields();
row = rowsOf(f).find((r) => r.id === 'claude');
check('with no body, the wearing row says None', wearing(f) === 'None');
check('with no body, nothing is active', row?.active !== true);
check('with no body, the row is still wearable', hasWear(row));

// ---------------------------------------------------------------- the switch must not no-op
// The last link: even with the button restored, switchAvatar's same-path early return would make
// clicking it do nothing. A button that no-ops is worse than no button.
const mybody = readFileSync(join(dir, '../client/lib/mybody.js'), 'utf8');
check('the same-path early return exempts the capsule',
  /if \(path === myAvatarPath && !me\?\.isCapsule\) return;/.test(mybody),
  'clicking wear on the failed body would silently do nothing');

// ---------------------------------------------------------------- THIS BODY: size and nameplate (R, 2026-09-30)
// The worn body's own section: fields (so the profile quad renders the same sliders in VR), shown only for a real
// body, writing through mybody's setMyBodyPref, with a reset only when there is something to reset.
const { bodiesDispatch } = await import('../client/lib/bodies.js');
const byK = (f, k) => f.find((x) => x.k === k);
state.me = { isCapsule: false }; state.prefs = { scale: 1, plateY: 0 }; state.writes = 0;
f = bodiesFields();
const size = byK(f, 'body-scale'), plate = byK(f, 'plate-y');
check('this body: a size slider, 50–200 %', size?.t === 'range' && size.min === 50 && size.max === 200 && size.value === 100, JSON.stringify(size));
check('this body: a nameplate slider, −30…+80 cm', plate?.t === 'range' && plate.min === -30 && plate.max === 80 && plate.value === 0, JSON.stringify(plate));
check('this body: the resulting height in m (roster 1.60 m at 100%)', f.some((x) => x.label === 'height' && /^1\.60 m/.test(x.value)), JSON.stringify(f.find((x) => x.label === 'height')));
check('this body: at default, no reset buttons', !byK(f, 'body-scale-reset') && !byK(f, 'plate-y-reset'));
bodiesDispatch('body-scale', 150);
bodiesDispatch('plate-y', 30);
check('the sliders write through to the worn body\'s prefs (percent → ×, cm → m)', state.prefs.scale === 1.5 && state.prefs.plateY === 0.3, JSON.stringify(state.prefs));
f = bodiesFields();
check('...the height reads 2.40 m (1.60 m at 100%)', f.some((x) => x.label === 'height' && /^2\.40 m \(1\.60 m at 100%\)/.test(x.value)), JSON.stringify(f.find((x) => x.label === 'height')));
check('...and both resets appear', !!byK(f, 'body-scale-reset') && !!byK(f, 'plate-y-reset'));
bodiesDispatch('plate-y-reset');
check('nameplate reset → auto (0), size kept', state.prefs.plateY === 0 && state.prefs.scale === 1.5, JSON.stringify(state.prefs));
bodiesDispatch('body-scale-reset');
check('size reset → 100 %', state.prefs.scale === 1, JSON.stringify(state.prefs));
state.me = { isCapsule: true };
check('no section for the capsule (there is no body to size)', !byK(bodiesFields(), 'body-scale'));
state.me = null;
check('no section with no body', !byK(bodiesFields(), 'body-scale'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
