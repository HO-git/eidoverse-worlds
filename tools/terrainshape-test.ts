// terrainshape — placed features and heightmaps over the terrain noise (shared/terrainshape.js), the sim's
// use of them (shared/terrainmath.js), and the server's image round trip (server/heightmap.ts).
//   bun tools/terrainshape-test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";

// the server half writes into OPT_DIR — point it at a scratch store BEFORE config.ts is imported
process.env.OPT_DIR = mkdtempSync(join(tmpdir(), "terrainshape-opt-"));
process.env.WORLDS_DIR = mkdtempSync(join(tmpdir(), "terrainshape-worlds-"));

const { shapeParams, shapeHeight, shapedHeightAt, encodeGrid, decodeGrid, registerGrid, MAX_FEATURES, waterParams, wadeAllowed, WADE_DEPTH } =
  await import("../shared/terrainshape.js");
const { terrainParams, makeHeightField } = await import("../shared/terrainmath.js");
const { ingestHeightmap, exportHeightmap } = await import("../server/heightmap.ts");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(ok ? `  \x1b[32m✓\x1b[0m ${label}` : `  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`);
  if (!ok) failures++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const flat = () => 0;

console.log("\nan unshaped world is untouched");
{
  const args = { seed: 7, size: 160, segments: 200, amplitude: 2.6, flatRadius: 16, layers: [{ color: "#5a6b3a" }] };
  check("no features, no heightmap → no shape", shapeParams(args) === null);
  check("the sim's params carry no shape key (its JSON is unchanged)", !("shape" in terrainParams(args)));
  const base = (x: number, z: number) => x + z;
  check("shapedHeightAt hands back the base function itself", shapedHeightAt(base, args) === base);
  check("an empty features list is still no shape", shapeParams({ ...args, features: [] }) === null);
}

console.log("\nfeatures");
{
  const S = shapeParams({ features: [{ type: "hill", x: 10, z: -5, radius: 8, height: 6 }] })!;
  const h = shapeHeight(flat, S, 100);
  check("a hill peaks at its height", near(h(10, -5), 6));
  check("...is gone at its radius", near(h(18, -5), 0));
  check("...and beyond", near(h(40, 40), 0));
  check("...and is round-topped (smooth, not a cone)", h(11, -5) > 5.8, `got ${h(11, -5)}`);
  const pit = shapeHeight(flat, shapeParams({ features: [{ type: "hill", x: 0, z: 0, radius: 5, height: -3 }] })!, 100);
  check("a negative hill is a pit", near(pit(0, 0), -3));
}
{
  const S = shapeParams({ features: [{ type: "ridge", x1: -20, z1: 0, x2: 20, z2: 0, radius: 4, height: 5 }] })!;
  const h = shapeHeight(flat, S, 100);
  check("a ridge holds its height all along its line", near(h(-20, 0), 5) && near(h(7, 0), 5) && near(h(20, 0), 5));
  check("...falls to nothing at its radius off the line", near(h(0, 4), 0));
  check("...and rounds off past its ends", near(h(24, 0), 0) && h(22, 0) > 0);
}
{
  const base = (x: number) => x * 0.5;
  const S = shapeParams({ features: [{ type: "flatten", x: 0, z: 0, radius: 6, height: 2, edge: 4 }] })!;
  const h = shapeHeight(base, S, 100);
  check("flatten sets an absolute height inside its radius", near(h(0, 0), 2) && near(h(5, 0), 2));
  check("...blends back to the ground over its edge", h(8, 0) > 2 && h(8, 0) < base(8));
  check("...and leaves the ground alone past radius+edge", near(h(10.5, 0), base(10.5)));
  const S2 = shapeParams({ features: [
    { type: "hill", x: 0, z: 0, radius: 20, height: 10 },
    { type: "flatten", x: 0, z: 0, radius: 5, height: 8 },
  ] })!;
  check("features apply in order: a plateau cut into a hill", near(shapeHeight(flat, S2, 100)(0, 0), 8));
}

console.log("\nvalidation");
{
  const S = shapeParams({ features: [
    { type: "volcano", x: 0, z: 0, radius: 5, height: 5 },
    { type: "hill", x: 0, z: 0, radius: 0, height: 5 },
    { type: "hill", x: "a", z: 0, radius: 5, height: 5 },
    { type: "ridge", x1: 0, z1: 0, radius: 5, height: 5 },
    { type: "hill", x: 1, z: 2, radius: 5, height: 1e9 },
  ] })!;
  check("unknown types, zero radius, bad numbers and half-given ridges are dropped", S.features.length === 1);
  check("an absurd height is clamped", S.features[0].height === 500);
  const many = Array.from({ length: 100 }, (_, i) => ({ type: "hill", x: i, z: 0, radius: 1, height: 1 }));
  check(`at most ${MAX_FEATURES} features`, shapeParams({ features: many })!.features.length === MAX_FEATURES);
  check("a heightmap must name a store grid", shapeParams({ heightmap: { grid: "../../etc/passwd", min: 0, max: 1 } }) === null);
}

console.log("\nthe sim grounds bodies on the shaped law");
{
  const args = { seed: 7, size: 160, amplitude: 2.6, flatRadius: 16, features: [{ type: "hill", x: 30, z: 30, radius: 10, height: 7 }] };
  const plain = makeHeightField(terrainParams({ ...args, features: undefined }));
  const shaped = makeHeightField(terrainParams(args));
  check("the hill is in the sim's field", near(shaped(30, 30), plain(30, 30) + 7));
  check("...and only there", near(shaped(-50, -50), plain(-50, -50)));
}

console.log("\nheightmap grids");
{
  const g = { w: 3, h: 2, data: new Uint16Array([0, 1000, 65535, 32768, 7, 40000]) };
  const back = decodeGrid(JSON.parse(JSON.stringify(encodeGrid(g))));
  check("encode/decode round-trips every sample", back.w === 3 && back.h === 2 && Array.from(back.data).join() === Array.from(g.data).join());
  registerGrid("store/heightmaps/0000000000000001.json", { w: 2, h: 2, data: new Uint16Array([0, 65535, 65535, 0]) });
  const S = shapeParams({ heightmap: { grid: "store/heightmaps/0000000000000001.json", min: -2, max: 8 } })!;
  const h = shapeHeight(flat, S, 10);
  check("black is min, white is max, at the corners", near(h(-5, -5), -2) && near(h(5, -5), 8) && near(h(-5, 5), 8) && near(h(5, 5), -2));
  check("between samples it is bilinear", near(h(0, 0), 3));
  check("outside the square the edge extends", near(h(-50, -5), -2));
}

console.log("\nexport → edit → import (server/heightmap.ts)");
{
  const args = { seed: 7, size: 120, amplitude: 4, flatRadius: 10,
    features: [{ type: "hill", x: 20, z: -15, radius: 14, height: 9 }, { type: "ridge", x1: -40, z1: 30, x2: 10, z2: 40, radius: 6, height: -4 }] };
  const truth = makeHeightField(terrainParams(args));
  const { png, meta } = exportHeightmap(args, 257, "t");
  const img = PNG.sync.read(Buffer.from(png), { skipRescale: true });
  check("export is a 257×257 16-bit grayscale PNG", img.width === 257 && img.height === 257 && img.data instanceof Uint16Array);
  check("...that spans the ground's real range", meta.max > meta.min && meta.size === 120);
  const up = ingestHeightmap(png, "00000000000000aa") as any;
  check("the export imports as-is, its range read back from the PNG", !up.error && near(up.meta.min, meta.min) && near(up.meta.max, meta.max), JSON.stringify(up).slice(0, 120));
  const back = makeHeightField(terrainParams({ size: 120, heightmap: { grid: up.grid, min: up.meta.min, max: up.meta.max } }));
  let worst = 0;
  for (let i = 0; i < 257; i += 16) for (let j = 0; j < 257; j += 16) {
    const x = (i / 256 - 0.5) * 120, z = (j / 256 - 0.5) * 120;
    worst = Math.max(worst, Math.abs(back(x, z) - truth(x, z)));
  }
  const step = (meta.max - meta.min) / 65535;
  check(`the round trip lands every sample back (within one 16-bit step, ${(step * 1000).toFixed(2)} mm)`, worst <= step, `worst ${(worst * 1000).toFixed(3)} mm`);
}
{
  const p = new PNG({ width: 4, height: 4, colorType: 0, inputColorType: 0, inputHasAlpha: false });
  p.data = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 17));
  const png8 = PNG.sync.write(p, { colorType: 0, inputColorType: 0, inputHasAlpha: false });
  const up = ingestHeightmap(new Uint8Array(png8), "00000000000000bb") as any;
  check("an 8-bit grayscale PNG imports too (in 256 steps)", !up.error && up.bits === 8 && up.meta === null);
  const g = decodeGrid(JSON.parse(await Bun.file(join(process.env.OPT_DIR!, up.grid)).text()));
  check("...scaled to the full 16-bit range", g.data[0] === 0 && g.data[15] === 65535);
  const big = ingestHeightmap(new Uint8Array(PNG.sync.write(new PNG({ width: 1100, height: 2 }))), "00000000000000cc") as any;
  check("an oversized image is refused with the size it wants", big.status === 413 && /1025/.test(big.error));
}

console.log("\nwater");
{
  check("no water key, no water", waterParams({ seed: 7 }) === null && waterParams({ water: null }) === null);
  const W = waterParams({ water: { level: -0.5 } })!;
  check("a level alone is enough, with a default colour and opacity", W.level === -0.5 && /^#/.test(W.color) && W.opacity > 0);
  check("a bad colour falls back, opacity is clamped", waterParams({ water: { level: 0, color: "red", opacity: 9 } })!.color !== "red"
    && waterParams({ water: { level: 0, opacity: 9 } })!.opacity === 1);
  check("a non-number level is no water", waterParams({ water: { level: "deep" } }) === null);
  check("water is not shaping: it never moves the ground", shapeParams({ water: { level: 3 } }) === null);
  check(`wading: a step into water ${WADE_DEPTH}m deep is fine`, wadeAllowed(0, 0.5, -WADE_DEPTH));
  check("...deeper than that is refused", !wadeAllowed(0, -0.5, -1.4));
  check("...unless it is no deeper than where you already stand (you can always walk out)", wadeAllowed(0, -2, -1.6));
  check("...a bigger body wades deeper", wadeAllowed(0, -0.5, -1.4, 1.5));
  check("...and no water, no rule", wadeAllowed(null, 0, -50));
}

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m` : "\n\x1b[32mall passed\x1b[0m");
process.exit(failures ? 1 : 0);
