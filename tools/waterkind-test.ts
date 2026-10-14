// waterkind — reading still water, rivers and the sea from the shape of what a water level fills.
//   bun tools/waterkind-test.ts
import { analyzeWater, compass } from "../shared/waterkind.js";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(ok ? `  \x1b[32m✓\x1b[0m ${label}` : `  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`);
  if (!ok) failures++;
};
const SIZE = 160, SEG = 160;
const bell = (d: number, r: number) => (d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

console.log("\na pond in a bowl");
{
  const ground = (x: number, z: number) => 1 - 6 * bell(Math.hypot(x, z), 30);
  const A = analyzeWater(ground, SIZE, { level: -2 }, SEG);
  check("one body", A.bodies.length === 1, `${A.bodies.length}`);
  check("...and it is still water", A.bodies[0].kind === "still", A.bodies[0].kind);
  check("dry ground is no water", A.sample(60, 60) === null);
  check("the middle is deep, and has no flow", A.sample(0, 0)!.depth > 2 && A.sample(0, 0)!.flow === null);
}

console.log("\na river across the world");
{
  // a winding channel edge to edge, its bed deepening toward +x — the only thing that can say downstream
  const ground = (x: number, z: number) => {
    const c = 10 * Math.sin(x / 20), bed = 2 + (x + 80) / 160 * 1.5;
    return 1 - (1 + bed) * bell(Math.abs(z - c), 5);
  };
  const A = analyzeWater(ground, SIZE, { level: -0.5 }, SEG);
  const rivers = A.bodies.filter((b) => b.kind === "river");
  check("the channel reads as a river", rivers.length === 1, A.bodies.map((b) => `${b.kind} ${b.length.toFixed(0)}×${b.width.toFixed(1)}`).join(", "));
  const r = rivers[0];
  check(`...long for its width (${r?.length.toFixed(0)} m × ${r?.width.toFixed(1)} m)`, r && r.length > 5 * r.width);
  const mid = A.sample(0, 10 * Math.sin(0))!;
  check("it flows toward the deeper end (+x)", mid.flow![0] > 0.8, JSON.stringify(mid.flow));
  const bend = A.sample(31, 10 * Math.sin(31 / 20))!;   // where the channel curves
  const tangent = [1, 0.5 * Math.cos(31 / 20)], tl = Math.hypot(tangent[0], tangent[1]);
  const along = (bend.flow![0] * tangent[0] + bend.flow![1] * tangent[1]) / tl;
  check("...and follows its bends", along > 0.85, `cos ${along.toFixed(2)}`);
  check("rivers move", mid.speed > 0.4);
  const forced = analyzeWater(ground, SIZE, { level: -0.5, flow: [-1, 0] }, SEG).sample(0, 0)!;
  check("water.flow overrides the direction", forced.flow![0] < -0.8, JSON.stringify(forced.flow));
}

console.log("\na shore and the sea");
{
  // land to the west, sloping down under the sea to the east
  const ground = (x: number) => 4 - (x + 80) / 160 * 18;
  const A = analyzeWater(ground, SIZE, { level: 0 }, SEG);
  check("the open water off the edge is the sea", A.bodies.length === 1 && A.bodies[0].kind === "ocean", A.bodies.map((b) => b.kind).join());
  const off = A.sample(50, 0)!;
  check("its waves run in toward the shore (−x)", off.toShore![0] < -0.9, JSON.stringify(off.toShore));
  check("the sea does not flow like a river", off.flow === null);
}

console.log("\nthe ground's guess can be overridden");
{
  const ground = (x: number, z: number) => 1 - 6 * bell(Math.hypot(x, z), 30);
  check("water.kind forces every body", analyzeWater(ground, SIZE, { level: -2, kind: "ocean" }, SEG).bodies[0].kind === "ocean");
  check("an unknown kind is ignored", analyzeWater(ground, SIZE, { level: -2, kind: "lava" }, SEG).bodies[0].kind === "still");
}

console.log("\ncompass words (−z is north, as look reads bearings)");
check("+x is east, +z is south", compass(1, 0) === "east" && compass(0, 1) === "south" && compass(0, -1) === "north" && compass(-1, -1) === "northwest");

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m` : "\n\x1b[32mall passed\x1b[0m");
process.exit(failures ? 1 : 0);
