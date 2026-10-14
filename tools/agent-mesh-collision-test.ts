// bun tools/agent-mesh-collision-test.ts — an agent's body collides against
// the same fitted colliders a browser's does.
//
// Agents used to stand on terrain and walk straight lines through everything
// placed: a raised floor buried them to the shins, a table stood in them, a
// wall was no obstacle and an upstairs did not exist. Now the agent fits
// client/lib/colliders.js from each model's own triangles
// (server/geometry.ts collisionTriangles, decoded from the bytes /library
// serves) and steps its feet the way client/lib/controller.js steps a
// person's. This checks:
//   1. collisionTriangles: node transforms applied, orphans excluded, and a
//      draco-compressed copy (what /library usually serves) decodes to the
//      same triangles;
//   2. against an isolated sequencer, a real WorldAgent in a two-storey
//      building — standing on a raised floor, climbing a stair to the upper
//      floor and back down, staying downstairs under the upper floor,
//      standing up and rejoining upstairs, and stopping (saying so) at
//      something solid that appears in its way. Routing round things is
//      navgrid-test's subject.
process.env.AGENT_BODY_ENGINE = "verlet";
process.env.WORLD_TOKEN = "";
const { collisionTriangles } = await import("../server/geometry.ts");
const { FLOOR, UPPER, boxes, buildGlb, boxMesh } = await import("./two-storey-fixture.ts");
const { Document, NodeIO } = await import("@gltf-transform/core");
const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
type Box = [number, number, number, number, number, number];
const { scratchSequencer, mkCheck, sleep } = await import("./harness.ts");
const { check, tally } = mkCheck();

const bounds = (p: Float32Array) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[i + a]); mx[a] = Math.max(mx[a], p[i + a]); }
  return [mn, mx];
};

console.log("collisionTriangles:");
{
  const raw = await collisionTriangles(await buildGlb(boxes, { lift: 2, shift: 0.5 }));
  check("reads a GLB into one triangle soup", !!raw && raw.indices.length === boxes.length * 36);
  const [mn, mx] = bounds(raw!.positions);
  check("applies the node chain's world matrix (parent lifted 2m, child shifted 0.5m along x)",
    Math.abs(mn[1] - 2) < 1e-6 && Math.abs(mx[1] - 8.3) < 1e-6 && Math.abs(mn[0] + 2.5) < 1e-6 && Math.abs(mx[0] - 3.5) < 1e-6,
    `y ${mn[1]}..${mx[1]}`);
  check("leaves out mesh nodes no scene reaches", mx[0] < 10, `max x ${mx[0]}`);
  const dr = await collisionTriangles(await buildGlb(boxes, { draco: true }));
  const [dmn, dmx] = dr ? bounds(dr.positions) : [[NaN], [NaN]];
  check("decodes a draco-compressed copy to the same triangles",
    !!dr && dr.indices.length === raw!.indices.length && Math.abs(dmn[1]) < 0.01 && Math.abs(dmx[1] - 6.3) < 0.01,
    dr ? `${dr.indices.length / 3} tris, y ${dmn[1]}..${dmx[1]}` : "null");
  check("answers null for bytes that are not a GLB", (await collisionTriangles(new Uint8Array([1, 2, 3]))) === null);
  {
    // a second scene the browser never shows: its wall must not become solid
    const doc = new Document(), buf = doc.createBuffer();
    const mk = (l: Box[]) => { const { pos, idx } = boxMesh(l); return doc.createMesh().addPrimitive(doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buf))); };
    const shown = doc.createScene("shown").addChild(doc.createNode("floor").setMesh(mk([[-2, 0, -2, 2, 0.2, 2]])));
    doc.createScene("hidden").addChild(doc.createNode("wall").setMesh(mk([[40, 0, 40, 41, 3, 41]])));
    doc.getRoot().setDefaultScene(shown);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const t = await collisionTriangles(await io.writeBinary(doc));
    const [, tmx] = t ? bounds(t.positions) : [[0], [99]];
    check("only the scene a browser shows becomes solid (a second scene's wall does not)", !!t && tmx[0] < 10, `max x ${tmx[0]}`);
  }
}

console.log("\nan agent in a two-storey building (isolated sequencer):");
const h = await scratchSequencer("agent-mesh-collision", { serverEnv: { SKIP_OPT_SWEEP: "1" }, portFrom: 9420 });
const { WorldAgent } = await import("../mcpl/agent.ts");
const URL_ = h.BASE.replace("http", "ws") + "/ws";
let a: any = new WorldAgent({ name: "walker", world: "meshcollide", url: URL_ });
const near = (v: number, want: number, tol = 0.03) => Math.abs(v - want) <= tol;
try {
  await a.connect();
  const up = await fetch(`${h.BASE}/upload?name=two-storey`, { method: "POST", body: await buildGlb(boxes) });
  const { path } = await up.json() as { path: string };
  // the building sits on the ground under its own origin, wherever that is
  const gy = a.heightAt(0, 0);
  a.verb("spawn", { id: "tower", lib: path, pos: [0, gy, 0], yaw: 0 });
  for (let i = 0; i < 100 && !a.supportIds?.get("tower"); i++) await sleep(50);
  await a.supportReady();
  await sleep(300);                                     // the fit itself is a detached registration
  // y: which floor at the destination, where it has more than one (navgrid)
  const walk = async (x: number, z: number, y?: number) => a.walkTo(x, z, false, 30_000, 0.01, y);

  check("starts outside, on the terrain", await walk(0, 5) && near(a.pos.y, a.heightAt(0, 5)), `y ${a.pos.y}`);
  check("walks in through the doorway onto the raised floor — feet ON it, not 0.3m under",
    await walk(0, 2) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)} want ${(gy + FLOOR).toFixed(3)}`);
  check("crosses the hall beneath the upper floor and stays downstairs",
    await walk(-1.5, -1.5) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)}`);
  await walk(0, 2);
  check("reaches the foot of the stair", await walk(2.2, 2.4) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)}`);
  check("climbs the stair to the upper floor", await walk(2.2, -2.4, gy + UPPER) && near(a.pos.y, gy + UPPER), `y ${a.pos.y.toFixed(3)} want ${(gy + UPPER).toFixed(3)}`);
  check("walks across the upper floor, still upstairs", await walk(0, -2.4) && near(a.pos.y, gy + UPPER), `y ${a.pos.y.toFixed(3)}`);
  a.setPosture("idle");
  check("standing still upstairs does not drop it to the ground floor", near(a.pos.y, gy + UPPER), `y ${a.pos.y.toFixed(3)}`);
  a.verb("comp", { id: "tower", type: "sockets", data: { bench: { pos: [-0.8, UPPER + 0.45, -2.4], yaw: 0, pose: "sitchair" } } });
  await sleep(200);
  a.verb("mount", { id: "walker", to: "tower", slot: "bench" });
  for (let i = 0; i < 40 && !a.mounts.has("walker"); i++) await sleep(50);
  await sleep(500);                                     // seated for a few ticks
  check("sits on an upstairs seat", a.mounts.has("walker"));
  check("stands up from it upstairs, not on the ground floor beneath",
    await walk(-0.2, -2.4) && near(a.pos.y, gy + UPPER), `y ${a.pos.y.toFixed(3)}`);
  // leave upstairs, come back: the body wakes where it was, at that height,
  // and holds it until the building's collider is fitted again — not on the
  // terrain under the building, which is all a fresh process knows at first
  await sleep(1500);                                    // the server's settled memory catches the pose
  a.close();
  await sleep(500);
  a = new WorldAgent({ name: "walker", world: "meshcollide", url: URL_ });
  await a.connect();
  await a.supportReady();
  await sleep(500);
  check("rejoins upstairs, standing on the upper floor it left from",
    near(a.pos.y, gy + UPPER) && Math.hypot(a.pos.x + 0.2, a.pos.z + 2.4) < 0.1, `at (${a.pos.x.toFixed(2)}, ${a.pos.y.toFixed(3)}, ${a.pos.z.toFixed(2)})`);
  {
    // lying upstairs after a fall, the ragdoll's root is ~0.68m BELOW the
    // floor holding it up; getting up must find that floor, not the one under it
    a.clip = "ragdoll"; a.pos.y = gy + UPPER - 0.68;
    a.setPose(null);
    check("getting up from a ragdoll lying upstairs stands upstairs", near(a.pos.y, gy + UPPER), `y ${a.pos.y.toFixed(3)}`);
  }
  {
    // another world in the same process, nothing built in it: the tower's
    // walls and floors must not exist there
    const other: any = new WorldAgent({ name: "elsewhere", world: "meshcollide-empty", url: URL_ });
    await other.connect();
    await other.walkTo(0, 5, true);
    const through = await other.walkTo(0, -2, true, 20_000);
    check("an agent in another world walks straight through where this world's building stands, on its own terrain",
      through && Math.abs(other.pos.z + 2) < 0.05 && near(other.pos.y, other.heightAt(0, -2)), `at (${other.pos.x.toFixed(2)}, ${other.pos.y.toFixed(3)}, ${other.pos.z.toFixed(2)})`);
    other.close();
  }
  // Something solid that arrives AFTER the walk was planned: a barrier
  // spawned across the upper floor while the body is on its way. The feet
  // meet it (its collider is fitted like any other), and the walk ends
  // promptly, saying where — the route planner is not the only thing
  // standing between a body and a wall.
  const bar = await (await fetch(`${h.BASE}/upload?name=barrier`, { method: "POST",
    body: await buildGlb([[-1.4, 0, -0.1, 1.4, 1.4, 0.1]]) })).json() as { path: string };
  const crossing = walk(0, 1.8);
  await sleep(300);
  a.verb("spawn", { id: "barrier", lib: bar.path, pos: [-1.3, gy + UPPER, -0.6], yaw: 0, collide: "box" });
  const t0 = Date.now();
  check("a walk that something solid blocks after it set off stops at it",
    !(await crossing) && a.pos.z < -0.6 - 0.1 && near(a.pos.y, gy + UPPER), `at (${a.pos.x.toFixed(2)}, ${a.pos.y.toFixed(2)}, ${a.pos.z.toFixed(2)})`);
  check("...says why it stopped", /blocked at .* something solid/.test(a.walkStall ?? ""), String(a.walkStall));
  check("...and promptly, not at the walk timeout", Date.now() - t0 < 4_000, `${Date.now() - t0}ms`);
  a.verb("remove", { id: "barrier" });
  await sleep(300);
  await walk(0, -2.4);
  check("goes back down the stair", await walk(2.2, -2.4) && await walk(2.2, 2.4) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)}`);
  check("and out the door to the terrain", await walk(0, 2) && await walk(0, 5) && near(a.pos.y, a.heightAt(0, 5)), `y ${a.pos.y.toFixed(3)}`);
} finally {
  try { a.close(); } catch { /* gone */ }
  await h.cleanup(tally.failed || process.exitCode ? 1 : 0);
}
console.log(`${tally.passed} passed, ${tally.failed} failed`);
process.exit(tally.failed ? 1 : 0);
