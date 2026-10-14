// buoyancy — how a body floats on the water surface (shared/waves.js), for swimmers now and floating
// ragdolls and objects next: the same law, per body or per part.
//
// A body is a COLUMN of height H that floats at rest with SWIM_AT·H of itself under water (the chest at
// the surface). Buoyancy pushes in proportion to how much is submerged, gravity pulls, and water drag damps
// the vertical motion — critically-ish (ζ ≈ 0.6). So a long, gentle swell lifts it nearly all the way, but
// a short or steep wave arrives faster than the body can rise: the water climbs up the body before it
// bobs up, and the body is still rising after the crest has passed. The surface is sampled over the
// body's footprint, not at a point, so chop averages out instead of jolting it.

import { SWIM_AT } from './terrainshape.js';

const G = 9.8;
export const FLOAT_ZETA = 0.6;      // damping ratio: settles in about one bob, without a long ring
export const FOOTPRINT = 0.35;      // metres: the surface is averaged over the body's own width

/** Mean surface height over a body's footprint at (x, z): `surfaceAt(x, z)` is the surface there. */
export function footprintSurface(surfaceAt, x, z, r = FOOTPRINT) {
  return (surfaceAt(x, z) * 2 + surfaceAt(x + r, z) + surfaceAt(x - r, z) + surfaceAt(x, z + r) + surfaceAt(x, z - r)) / 6;
}

/** Advance a floating column by `dt` seconds: `s` is {y, vy} — y the body's feet (its column's foot) —
 *  under a surface at `surfaceY`, for a body of height `H`; `floor` keeps it off the bed. Mutates and
 *  returns `s`. Substepped, so a 10 Hz agent tick and a 60 Hz browser frame trace the same bob. */
export function floatStep(s, surfaceY, H, dt, floor = -Infinity) {
  const sub0 = SWIM_AT * H;
  const c = 2 * FLOAT_ZETA * Math.sqrt(G / sub0);
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const sub = Math.min(H, Math.max(0, surfaceY - s.y));
    const a = G * (sub / sub0 - 1) - c * s.vy;
    s.vy += a * h;
    s.y += s.vy * h;
    if (s.y < floor) { s.y = floor; if (s.vy < 0) s.vy = 0; }
  }
  return s;
}
