// platesize — the nameplate's size and fade against WORLD distance (client/lib/platesize.js, the function avatar.js
// calls every frame; this drives that very function, not a copy).
//
//   bun tools/platesize-test.ts
//
// What must hold (owner-approved recipe, 09-30): world-sized up close; the name's capitals held at 0.6° once they'd
// fall under it; growth capped at 3×; full opacity to 20 m, gone by 30 m. The angle is measured from the MEASURED
// cap height (PLATE_CAP_H) at the size the function returns — the check fails if either drifts from the other.

import { plateSize, PLATE_CAP_H, PLATE_W, TEXT_DEG, MAX_GROW } from "../client/lib/platesize.js";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};
// the angle the name's capitals subtend at distance d, at the width the function chose
const capDeg = (d: number) => 2 * Math.atan((PLATE_CAP_H * plateSize(d).lw / PLATE_W) / 2 / d) * 180 / Math.PI;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * b;

check("cap height is the measured one (30 px of 64 on a 0.1125 m sprite, ~0.053 m)", near(PLATE_CAP_H, 0.0527, 0.02), `${PLATE_CAP_H}`);
check("s = 1 at 2 m (world-sized up close)", plateSize(2).s === 1, JSON.stringify(plateSize(2)));
check("lw = 0.9 at 2 m", plateSize(2).lw === 0.9, JSON.stringify(plateSize(2)));
for (const d of [8, 12])
  check(`caps hold ${TEXT_DEG}° (±5%) at ${d} m`, near(capDeg(d), TEXT_DEG, 0.05), `${capDeg(d).toFixed(3)}°, s=${plateSize(d).s.toFixed(3)}`);
check(`s = ${MAX_GROW} at 20 m (capped)`, Math.abs(plateSize(20).s - MAX_GROW) < 1e-9, JSON.stringify(plateSize(20)));
check("past the cap it shrinks with perspective again (angle at 25 m < at 12 m)", capDeg(25) < capDeg(12) * 0.9,
  `${capDeg(25).toFixed(3)}° vs ${capDeg(12).toFixed(3)}°`);
check("size never falls as you walk away (monotone s)", [0, 1, 3, 5, 7, 10, 15, 20, 40].every((d, i, a) => i === 0 || plateSize(d).s >= plateSize(a[i - 1]).s));
check("vis = 1 at 19 m", plateSize(19).vis === 1, JSON.stringify(plateSize(19)));
check("vis = 1 at 20 m (full to 20)", plateSize(20).vis === 1, JSON.stringify(plateSize(20)));
check("vis between 0 and 1 at 25 m (fading)", plateSize(25).vis > 0.3 && plateSize(25).vis < 0.7, JSON.stringify(plateSize(25)));
check("vis = 0 at 30 m", plateSize(30).vis === 0, JSON.stringify(plateSize(30)));
check("vis = 0 at 60 m (stays gone)", plateSize(60).vis === 0, JSON.stringify(plateSize(60)));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
