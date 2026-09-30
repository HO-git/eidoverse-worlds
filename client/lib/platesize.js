// platesize — how big a nameplate is and how visible, as a function of WORLD distance from the eye. Pure, so the
// test drives this very function (tools/platesize-test.ts); avatar.js applies it every frame.
//
// WHY this shape: nobody publishes a nameplate curve (BasisVR and Hubs keep plates world-fixed; VRChat hides names
// past 30 m), so the anchor is legibility. Microsoft's mixed-reality typography guidance puts the legible floor at
// ~0.4° of text height and comfortable reading at 0.6–0.75°. So: up close the plate is a world object (s = 1 — it
// doesn't balloon in your face); once its capitals would fall under 0.6° it holds 0.6° (grows with distance); past
// MAX_GROW it lets perspective shrink it again, so a far crowd recedes instead of becoming a wall of equal labels.
// depthTest stays off on the sprite (your own shoulder must not eat a label) — distance is what thins the crowd.

export const PLATE_W = 0.9;            // metres: the label sprite's width at s = 1 (512×64 canvas)
// Cap height of the 40 px name on the 64 px canvas, MEASURED (canvas measureText + raster rows of 'H' in headless
// Chromium, 09-30: 30 px; Segoe UI Semibold is ~28). 30 px of 64 at a sprite 0.9 × 64/512 m tall.
export const PLATE_CAP_H = 30 / 64 * (PLATE_W * 64 / 512);   // ≈ 0.0527 m
export const TEXT_DEG = 0.6;           // the comfortable-reading angle the caps hold at range
export const MAX_GROW = 3;             // the most a plate grows before perspective takes over again
export const PLATE_D0 = PLATE_CAP_H / Math.tan(TEXT_DEG * Math.PI / 180);   // ≈ 5.0 m: where 0.6° starts needing help
export const FADE_FULL = 20, FADE_GONE = 30;   // metres: full to 20, gone by 30 (VRChat's 30 m cut, softened)

/** d = world distance eye→body (m). → { s: size factor, lw: sprite width (m), vis: opacity 0..1 } */
export function plateSize(d) {
  const s = Math.min(MAX_GROW, Math.max(1, d / PLATE_D0));
  const vis = Math.min(1, Math.max(0, 1 - (d - FADE_FULL) / (FADE_GONE - FADE_FULL)));
  return { s, lw: PLATE_W * s, vis };
}
