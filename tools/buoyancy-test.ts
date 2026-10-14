// buoyancy + waves — a floating column on the water surface, and the clock the surface runs on.
//   bun tools/buoyancy-test.ts
import { floatStep, footprintSurface } from "../shared/buoyancy.js";
import { surfaceOffset, waveClock, WAVE_PERIOD, OCEAN } from "../shared/waves.js";
import { SWIM_AT } from "../shared/terrainshape.js";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(ok ? `  \x1b[32m✓\x1b[0m ${label}` : `  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`);
  if (!ok) failures++;
};
const H = 1.74;
const run = (surface: (t: number) => number, seconds: number, dt: number, s0 = { y: -SWIM_AT * H, vy: 0 }) => {
  const s = { ...s0 }, trace: { t: number; y: number; surf: number }[] = [];
  for (let t = 0; t < seconds; t += dt) { floatStep(s, surface(t), H, dt); trace.push({ t, y: s.y, surf: surface(t) }); }
  return trace;
};

console.log("\nfloating");
{
  const tr = run(() => 0, 20, 1 / 60, { y: 0, vy: 0 });     // dropped in with its feet at the surface
  const end = tr.at(-1)!;
  check(`settles with its chest at the surface (feet at −${(SWIM_AT * H).toFixed(2)} m)`, Math.abs(end.y + SWIM_AT * H) < 0.01, `y ${end.y.toFixed(3)}`);
  const dip = Math.min(...tr.map((p) => p.y));
  check("...after one damped bob, not a long ring", dip > -SWIM_AT * H - 0.5 && tr.filter((p) => p.t > 6).every((p) => Math.abs(p.y + SWIM_AT * H) < 0.03), `lowest ${dip.toFixed(2)}`);
}
console.log("\nriding waves");
{
  const response = (A: number, w: number) => {
    const tr = run((t) => A * Math.sin(w * t), 40, 1 / 60).filter((p) => p.t > 20);
    return (Math.max(...tr.map((p) => p.y)) - Math.min(...tr.map((p) => p.y))) / (2 * A);
  };
  const swell = response(0.6, 0.5), steep = response(0.3, 4.5);
  check(`a long swell lifts it nearly all the way (${(swell * 100).toFixed(0)}% of the wave's height)`, swell > 0.85 && swell < 1.3, `${swell}`);
  check(`a short steep wave mostly passes over it (${(steep * 100).toFixed(0)}%) — the water climbs the body`, steep < 0.5, `${steep}`);
  const ocean = response(0.6, OCEAN.w1);
  check(`the sea's own swell (${OCEAN.w1.toFixed(2)} rad/s) lifts it most of the way, with a lag (${(ocean * 100).toFixed(0)}%)`, ocean > 0.5 && ocean < 1.4, `${ocean}`);
  const fast = run((t) => 0.6 * Math.sin(OCEAN.w1 * t), 20, 1 / 60).at(-1)!.y;
  const slow = run((t) => 0.6 * Math.sin(OCEAN.w1 * t), 20, 0.1).at(-1)!.y;
  check("a 10 Hz agent tick bobs where a 60 Hz browser frame does", Math.abs(fast - slow) < 0.03, `${fast.toFixed(3)} vs ${slow.toFixed(3)}`);
}
console.log("\nthe surface and its clock");
{
  check("the wave clock wraps every period", Math.abs(waveClock(WAVE_PERIOD * 1000 + 1500) - 1.5) < 1e-9 && waveClock(-500) > 0);
  const w = { kind: "ocean", depth: 6, toShore: [-1, 0] as [number, number] };
  const before = surfaceOffset(w, 12, 3, WAVE_PERIOD - 1e-6), after = surfaceOffset(w, 12, 3, 0);
  check("…and nothing jumps at the wrap (every frequency is a whole number of cycles a period)", Math.abs(before - after) < 1e-4, `${before} vs ${after}`);
  const amp = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(surfaceOffset(w, i * 0.4, 0, 0))));
  check(`offshore the sea stands up to ~0.9 m (${amp.toFixed(2)})`, amp > 0.6 && amp < 1.0);
  const shallow = { ...w, depth: -0.5 };
  const ampS = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(surfaceOffset(shallow, i * 0.4, 0, 0))));
  check(`at the shore its swash is smaller (${ampS.toFixed(2)})`, ampS < amp * 0.5);
  check("dry ground has no surface offset", surfaceOffset(null, 1, 2, 3) === 0);
  const flat = footprintSurface(() => 0.4, 0, 0);
  check("the footprint mean of a flat surface is the surface", Math.abs(flat - 0.4) < 1e-12);
}

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m` : "\n\x1b[32mall passed\x1b[0m");
process.exit(failures ? 1 : 0);
