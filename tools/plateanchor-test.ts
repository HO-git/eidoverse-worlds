// plateanchor — where a nameplate hangs (client/lib/plateanchor.js, the functions avatar.js calls; this drives those very
// functions, then avatar.js's own _measurePlateRest/_placePlate/_measureOwnClear against a real THREE rig).
//
//   BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/plateanchor-test.ts
//
// What must hold (FEATURE-WISHLIST "Nameplate height", steps 1–4; Basis's constants):
//   the crown — eye + 1.35·(eye − head); no eyes → head + 0.45·(head − hips); the mesh top counts, capped at
//     head + 1.8·(that span); no head/hips → nothing;
//   the gap — 5% of height, 3–15 cm;
//   standing / sitting — over the live hips at the rest hips→crown height; sitting lowers it with the hips; a head
//     raised above where the hips say wins; ground-sitting is not lying;
//   lying — under 50% of rest head height it blends over the head (head + head span + gap), fully by 30%, continuously;
//   smoothing — Y chases at 1 − exp(−dt/τ) with a 2 cm dead zone, frame-rate independent, never overshoots;
//   the real Avatar methods — the rest crown measured in model units, scaled live, written in the ROOT's frame (turned,
//     moved, scaled), the old 1.95 with nothing to measure, and the own-body clearance measured from the new anchor.

import { plugin } from 'bun';
import { fileURLToPath } from 'node:url';
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
plugin({
  name: 'client-stubs',
  setup(b) {
    b.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
    b.onResolve({ filter: /^\.\/assets\.js$/ }, () => ({ path: here('./assets-stub.mjs') }));
    b.onResolve({ filter: /^\.\/loadwork\.js$/ }, () => ({ path: here('./loadwork-stub.mjs') }));
  },
});

const PA: any = await import('../client/lib/plateanchor.js');
const { crownEstimate, plateGap, plateAnchor, lieAmount, smoothY, TAU, DEAD } = PA;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const J = (x: any) => JSON.stringify(x, (_k, v) => typeof v === 'number' ? +v.toFixed(4) : v);

console.log('crown:');
{
  // a 1.7 m-ish human: hips 0.95, head bone 1.50, eyes 1.58 → eye crown 1.58 + 1.35·0.08 = 1.688
  const c = crownEstimate({ hips: 0.95, head: 1.5, eye: 1.58 });
  check('eyes: crown = eye + 1.35·(eye − head)', !!c && near(c.crown, 1.688), J(c));
  check('...headSpan = crown − head, hipsToCrown = crown − hips', !!c && near(c.headSpan, 0.188) && near(c.hipsToCrown, 0.738), J(c));
  const n = crownEstimate({ hips: 0.95, head: 1.5 });
  check('no eyes: crown = head + 0.45·(head − hips)', !!n && near(n.crown, 1.5 + 0.45 * 0.55), J(n));
  const under = crownEstimate({ hips: 0.95, head: 1.5, eye: 1.45 });
  check('eyes at/under the head bone are ignored (the no-eye fallback)', !!under && near(under.crown, n.crown), J(under));
  const low = crownEstimate({ hips: 0.95, head: 1.5, eye: 1.58, boundsTop: 1.65 });
  check('a mesh top under the eye crown does not lower it', !!low && near(low.crown, 1.688), J(low));
  const hair = crownEstimate({ hips: 0.95, head: 1.5, eye: 1.58, boundsTop: 1.78 });
  check('big hair within the cap raises it to the mesh top', !!hair && near(hair.crown, 1.78), J(hair));
  // cap = head + 1.8·(1.688 − 1.5) = 1.8384
  const tent = crownEstimate({ hips: 0.95, head: 1.5, eye: 1.58, boundsTop: 2.4 });
  check('a crown of tentacles is capped at head + 1.8·span', !!tent && near(tent.crown, 1.5 + 1.8 * 0.188), J(tent));
  check('no hips / no head / head under hips → null', crownEstimate({ hips: null, head: 1.5 }) === null
    && crownEstimate({ hips: 0.9, head: undefined }) === null && crownEstimate({ hips: 1, head: 0.5 }) === null);
}

console.log('gap:');
check('5% of a 1.7 m body = 8.5 cm', near(plateGap(1.7), 0.085));
check('a 40 cm body gets the 3 cm floor', near(plateGap(0.4), 0.03));
check('a 5 m body gets the 15 cm ceiling', near(plateGap(5), 0.15));

const rest = { ...crownEstimate({ hips: 0.95, head: 1.5, eye: 1.58 }), restHeadAboveFeet: 1.5 - 0.08 };
const gap = plateGap(1.688);

console.log('standing / sitting:');
{
  const a = plateAnchor({ hips: [0.1, 0.95, -0.2], head: [0.1, 1.5, -0.18], feetY: 0.08, rest, s: 1, gap });
  check('standing at rest: y = crown + gap', near(a.p[1], 1.688 + gap), J(a));
  check('...x/z are the HIPS\', not the head\'s', near(a.p[0], 0.1) && near(a.p[2], -0.2), J(a));
  check('...and it is not lying', a.lie === 0);
  const bob = plateAnchor({ hips: [0, 0.95, 0], head: [0.03, 1.47, 0.04], feetY: 0.08, rest, s: 1, gap });
  check('a nod (head down/forward, hips still) does not move it', near(bob.p[1], a.p[1]) && near(bob.p[0], 0) && near(bob.p[2], 0), J(bob));
  // ground-sitting (sitting_on_ground): hips ~0.2, head ~0.8 above the floor; feet on the floor
  const sit = plateAnchor({ hips: [0, 0.2, 0.05], head: [0, 0.78, 0.1], feetY: 0.06, rest, s: 1, gap });
  // the legs fold, so the hips drop 0.75 but the head only 0.72: here the head term (head + span) is the higher by 3 cm
  check('sitting on the ground: comes down with the body (max(hips + hips→crown, head + span) + gap)',
    near(sit.p[1], Math.max(0.2 + rest.hipsToCrown, 0.78 + rest.headSpan) + gap) && sit.p[1] < 1.1, J(sit));
  check('...and ground-sitting is NOT lying (head ~51% of rest height)', sit.lie === 0, J(sit));
  const reach = plateAnchor({ hips: [0, 0.95, 0], head: [0, 1.75, 0], feetY: 0.08, rest, s: 1, gap });
  check('a head raised above where the hips put it wins (head + span + gap)', near(reach.p[1], 1.75 + rest.headSpan + gap), J(reach));
  const big = plateAnchor({ hips: [0, 1.9, 0], head: [0, 3.0, 0], feetY: 0.16, rest, s: 2, gap: plateGap(1.688 * 2) });
  check('scale 2: every rest length doubles', near(big.p[1], 1.9 + 2 * rest.hipsToCrown + plateGap(3.376)), J(big));
}

console.log('lying:');
{
  // lying on the back along +x: head at x=0.7, 0.18 above the floor; hips at x=0, 0.15
  const lie = plateAnchor({ hips: [0, 0.15, 0], head: [0.7, 0.18, 0.02], feetY: 0.1, rest, s: 1, gap });
  check('lying (head 6% of rest): fully over the head', lie.lie === 1 && near(lie.p[0], 0.7) && near(lie.p[2], 0.02), J(lie));
  check('...at head + head span + gap, not a torso-length above', near(lie.p[1], 0.18 + rest.headSpan + gap), J(lie));
  check('...which is well under the Basis answer (hips + hips→crown)', lie.p[1] < 0.15 + rest.hipsToCrown + gap - 0.3, J(lie));
  check('lieAmount: 0 at ≥50%, 1 at ≤30%, between in between', lieAmount(0.5, 1) === 0 && lieAmount(0.3, 1) === 1
    && lieAmount(0.4, 1) > 0.4 && lieAmount(0.4, 1) < 0.6 && lieAmount(0.9, 1) === 0 && lieAmount(0, 1) === 1);
  // MEASURED on sitting_on_ground (plateanchor-shot-probe, 09-30): the head sits at ~40% of its rest height above the
  // feet — inside the head-height band — but the torso is upright (head over hips ~0.9 of rest)
  const gsit = plateAnchor({ hips: [0, 0.1, 0.05], head: [0, 0.58, 0.1], feetY: 0.06, rest, s: 1, gap });
  check('sitting on the ground with the head at 37% of rest is NOT lying (the torso is upright)', gsit.lie === 0 && near(gsit.p[0], 0) && near(gsit.p[2], 0.05), J(gsit));
  const bow = plateAnchor({ hips: [0, 0.95, 0], head: [0.5, 1.0, 0], feetY: 0.08, rest, s: 1, gap });
  check('a deep bow (torso over, head still high) is not lying', bow.lie === 0, J(bow));
  check('lieAmount with the torso gate: low head + fallen torso = 1; low head + upright torso = 0',
    lieAmount(0.2, 1, 0.1, 0.55) === 1 && lieAmount(0.2, 1, 0.5, 0.55) === 0);
  // lying down as a continuous motion: head drops and slides out to x=0.7 while hips drop — the anchor must glide
  let prev: number[] | null = null, worst = 0, mono = true, lastLie = 0;
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const hips = [0, 0.95 - 0.8 * t, 0], head = [0.7 * t, 1.5 - 1.32 * t, 0];
    const a = plateAnchor({ hips, head, feetY: 0.08, rest, s: 1, gap });
    if (prev) worst = Math.max(worst, Math.hypot(a.p[0] - prev[0], a.p[1] - prev[1], a.p[2] - prev[2]));
    if (a.lie < lastLie - 1e-12) mono = false;
    prev = a.p; lastLie = a.lie;
  }
  // a hard switch at 50% would jump by the whole stand→lie difference at that frame (~0.3–0.4 m)
  const at50 = (lieState: number) => { const t = (1.5 - 0.08 - 0.5 * 1.42) / 1.32;
    const hips = [0, 0.95 - 0.8 * t, 0], head = [0.7 * t, 1.5 - 1.32 * t, 0];
    const st = Math.max(hips[1] + rest.hipsToCrown, head[1] + rest.headSpan) + gap, ly = head[1] + rest.headSpan + gap;
    return Math.hypot(head[0] - hips[0], ly - st) * lieState; };
  check('lying down is a glide: no step > 2 cm across 400 frames (a snap would be one big step)', worst < 0.02,
    `worst ${worst.toFixed(4)} m; a snap at 50% would step ${at50(1).toFixed(3)} m`);
  check('...and the blend only ever grows as the head goes down', mono);
}

console.log('smoothing:');
{
  check('first frame lands on the target', smoothY(null, 1.3, 1 / 60) === 1.3);
  check('inside the 2 cm dead zone it holds still', smoothY(1.0, 1.0 + DEAD * 0.9, 1 / 60) === 1.0 && smoothY(1.0, 1.0 - 0.019, 1 / 60) === 1.0);
  const one = smoothY(0, 1, TAU, { dead: 0 });
  check('one τ closes 1 − 1/e of the gap (dead 0)', near(one, 1 - Math.exp(-1), 1e-12), `${one}`);
  let y = 0; for (let i = 0; i < 10; i++) y = smoothY(y, 1, TAU / 10, { dead: 0 });
  check('frame-rate independent: 10 steps of τ/10 = one step of τ', near(y, one, 1e-12), `${y} vs ${one}`);
  let z = 0, over = false; for (let i = 0; i < 600; i++) { z = smoothY(z, -0.5, 1 / 60); if (z < -0.5) over = true; }
  check('never overshoots, and settles within the dead zone', !over && Math.abs(z + 0.5) <= DEAD + 1e-9, `${z}`);
  const edgeIn = smoothY(0, DEAD, 1 / 60), edgeOut = smoothY(0, DEAD + 1e-7, 1 / 60);
  check('continuous at the dead zone\'s edge (no pop)', near(edgeIn, edgeOut, 1e-6), `${edgeIn} ${edgeOut}`);
  let q = 1.688, frames = 0; while (Math.abs(q - 1.0) > 0.05 && frames < 600) { q = smoothY(q, 1.0, 1 / 90); frames++; }
  check('a sit (−0.69 m) is within 5 cm in under half a second', frames / 90 < 0.5, `${(frames / 90).toFixed(3)} s`);
}

// ---- the real Avatar methods, on a real THREE rig -------------------------------------------------------------
console.log('avatar.js:');
{
  const { THREE } = await import('./core-stub.mjs');
  const { Avatar } = await import('../client/lib/avatar.js');
  // a missing method is a no-op, so against the parent (a plate fixed at 1.95, set once) every check below reports
  // its own red instead of the section dying on the first call
  const call = (o: any, m: string, ...a: any[]) => (typeof o[m] === 'function' ? o[m](...a) : undefined);
  const sprite = () => { const l = new THREE.Sprite(); l.position.y = 1.95; return l; };
  const rig = ({ eyes = true, hair = 1.8, hipsHead = true } = {}) => {
    const root = new THREE.Group(), scene = new THREE.Group();
    root.add(scene);
    const B = (y: number, parent: any) => { const b = new THREE.Bone(); b.position.y = y; parent.add(b); return b; };
    const hips = B(0.95, scene), spine = B(0.3, hips), head = B(0.25, spine);
    const le = B(0.08, head), re = B(0.08, head); le.position.x = 0.03; re.position.x = -0.03;
    const lf = B(-0.87, hips), rf = B(-0.87, hips); lf.position.x = 0.1; rf.position.x = -0.1;
    // a plain mesh as the body's top (a 'hair' box whose top is at `hair`)
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3));
    box.position.y = hair - 0.1; scene.add(box);
    const bones: any = hipsHead ? { hips, head, leftEye: eyes ? le : null, rightEye: eyes ? re : null, leftFoot: lf, rightFoot: rf } : {};
    const humanoid = { getRawBoneNode: (n: string) => bones[n] ?? null, getNormalizedBoneNode: () => null };
    const self: any = Object.assign(Object.create(Avatar.prototype), {
      vrm: { scene, humanoid }, root, label: sprite(), _plateOff: null,
    });
    self._plateRest = call(self, '_measurePlateRest');
    return { self, root, scene, hips, head, spine };
  };
  const { self, root, hips } = rig();
  const r = self._plateRest;
  // eyes at 1.58 → eye crown 1.688; hair box top 1.8 ≤ cap 1.8384 → crown 1.8
  check('rest crown from the real rig: the hair top (within the cap)', !!r && near(r.crown, 1.8, 1e-6), J(r));
  check('...rest head above feet = head − feet', !!r && near(r.restHeadAboveFeet, 1.5 - 0.08, 1e-6), J(r));
  call(self, '_placePlate', 1 / 60);
  const g = plateGap(1.8 - 0.08);
  check('standing: the plate hangs at crown + gap, over the hips', near(self.label.position.y, 1.8 + g, 1e-6) && near(self.label.position.x, 0, 1e-9), J(self.label.position));
  // walk the root away, turn it, scale it ×1.5: the plate stays in the root frame at the same local spot
  root.position.set(5, 2, -3); root.rotation.y = 1.1; root.scale.setScalar(1.5);
  self._plateOff = null; call(self, '_placePlate', 1 / 60);
  const gw = plateGap((1.8 - 0.08) * 1.5);
  check('root moved, turned, ×1.5: local y = crown + gap/1.5 (the gap is world metres)', near(self.label.position.y, 1.8 + gw / 1.5, 1e-6), J(self.label.position));
  check('...local x/z still over the hips', near(self.label.position.x, 0, 1e-6) && near(self.label.position.z, 0, 1e-6), J(self.label.position));
  root.position.set(0, 0, 0); root.rotation.y = 0; root.scale.setScalar(1); self._plateOff = null;
  // sit: hips drop 0.6 and shift forward 0.1; the plate eases there (not a snap), and a root move does NOT ease
  call(self, '_placePlate', 1 / 60);
  const standY = self.label.position.y;
  hips.position.set(0, 0.35, 0.1);
  call(self, '_placePlate', 1 / 90);
  check('sit: x/z follow at once, y eases (not a snap)', near(self.label.position.z, 0.1, 1e-6) && self.label.position.y < standY && self.label.position.y > standY - 0.3,
    J(self.label.position));
  for (let i = 0; i < 120; i++) call(self, '_placePlate', 1 / 90);
  check('...and settles to hips + hips→crown + gap (within the dead zone)', Math.abs(self.label.position.y - (0.35 + (1.8 - 0.95) + g)) <= DEAD + 1e-4, J(self.label.position));
  const settled = self.label.position.y;
  root.position.y = 3; call(self, '_placePlate', 1 / 90); root.position.y = 0;
  check('a root move (stairs, a lift) does not make it trail', near(self.label.position.y, settled, 1e-6), `${self.label.position.y} vs ${settled}`);
  // lie: the whole body lies flat along +x, 0.15 above the floor (hips turned −90° about z; legs go to −x)
  hips.position.set(0, 0.15, 0); hips.rotation.z = -Math.PI / 2;
  for (let i = 0; i < 200; i++) call(self, '_placePlate', 1 / 90);
  const headW = new THREE.Vector3(); self.vrm.humanoid.getRawBoneNode('head').getWorldPosition(headW);
  check('lying: over the head, at head + head span + gap', near(self.label.position.x, headW.x, 1e-6)
    && Math.abs(self.label.position.y - (headW.y + (1.8 - 1.5) + g)) <= DEAD + 1e-4 && headW.x > 0.5, `${J(self.label.position)} head ${J(headW)}`);
  // the own-body clearance is measured from where the plate hangs — its column, not the root's
  const clearRoot = (() => { self.label.position.set(0, 1.8 + g, 0); return self._measureOwnClear(); })();
  const clearOff = (() => { self.label.position.set(0.6, 1.8 + g, 0); return self._measureOwnClear(); })();
  check('own-body clearance is measured from the plate\'s own x/z (moved 0.6 m → the hair is farther)', clearOff > clearRoot + 0.2, `${clearRoot} → ${clearOff}`);

  const none = rig({ hipsHead: false });
  call(none.self, '_placePlate', 1 / 60);
  check('no hips/head bones: over the rest mesh top + gap', near(none.self.label.position.y, 1.8 + plateGap(1.8), 1e-6), J(none.self.label.position));
  const bare: any = Object.assign(Object.create(Avatar.prototype), { vrm: { scene: new THREE.Group() }, root: new THREE.Group(), label: sprite() });
  bare._plateRest = call(bare, '_measurePlateRest'); call(bare, '_placePlate', 1 / 60);
  check('nothing to measure at all: the old fixed 1.95', near(bare.label.position.y, 1.95), J(bare.label.position));
  const noeye = rig({ eyes: false, hair: 1.0 });
  check('no eye bones, mesh under the head: head + 0.45·(head − hips)', near(noeye.self._plateRest?.crown, 1.5 + 0.45 * 0.55, 1e-6), J(noeye.self._plateRest));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
