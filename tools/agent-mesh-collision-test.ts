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
//      floor and back down, staying downstairs under the upper floor, and
//      stopping (and saying so) at a wall instead of walking through it.
process.env.AGENT_BODY_ENGINE = "verlet";
process.env.WORLD_TOKEN = "";
const { Document, NodeIO } = await import("@gltf-transform/core");
const { KHRDracoMeshCompression, ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
const draco3d = (await import("draco3dgltf")).default;
const { collisionTriangles } = await import("../server/geometry.ts");
const { scratchSequencer, mkCheck, sleep } = await import("./harness.ts");
const { check, tally } = mkCheck();

// ---- a two-storey building, as boxes ------------------------------------------
// Model frame, Y up, door on +Z. Ground floor top 0.30 (a raised floor: the
// sinking case). A straight stair of 15 solid treads (rise 0.1875, going 0.25)
// climbs the east side toward -Z onto an upper floor at 3.30; the well is
// open above the stair and railed on its west edge.
const FLOOR = 0.3, UPPER = 3.3, RISE = 0.1875, GOING = 0.25;
type Box = [number, number, number, number, number, number];   // minX minY minZ maxX maxY maxZ
const boxes: Box[] = [
  [-3, 0, -3, 3, FLOOR, 3],                                   // raised ground floor
  [-3, FLOOR, -3, -2.8, 6.3, 3], [2.8, FLOOR, -3, 3, 6.3, 3],  // west, east walls
  [-3, FLOOR, -3, 3, 6.3, -2.8],                              // back wall
  [-3, FLOOR, 2.8, -0.6, 6.3, 3], [0.6, FLOOR, 2.8, 3, 6.3, 3], [-0.6, 2.4, 2.8, 0.6, 6.3, 3], // front, door gap
  [-2.8, 3.1, -2.8, 1.6, UPPER, 2.8],                         // upper floor west of the well
  [1.6, 3.1, -2.8, 2.8, UPPER, -2.0],                         // ...and the strip the stair arrives on
  [1.55, UPPER, -2.0, 1.6, UPPER + 1.0, 1.5],                 // railing along the well
];
for (let i = 1; i <= 15; i++) boxes.push([1.6, FLOOR, 1.5 - i * GOING, 2.8, FLOOR + i * RISE, 1.5 - (i - 1) * GOING]);

function boxMesh(list: Box[]) {
  const pos: number[] = [], idx: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    const b = pos.length / 3;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pos.push(x, y, z);
    // corners: index = xi*4 + yi*2 + zi
    for (const f of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]])
      idx.push(b + f[0], b + f[1], b + f[2], b + f[0], b + f[2], b + f[3]);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

/** A GLB whose one mesh sits under a translated parent node (so the world
 *  matrix matters), with an orphan mesh node outside the scene. */
async function buildGlb(list: Box[], { draco = false, lift = 0, shift = 0 } = {}) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const make = (l: Box[]) => {
    const { pos, idx } = boxMesh(l);
    return doc.createMesh().addPrimitive(doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buf)));
  };
  const parent = doc.createNode("lift").setTranslation([0, lift, 0]);
  parent.addChild(doc.createNode("building").setMesh(make(list)).setTranslation([shift, 0, 0]));
  doc.createScene("s").addChild(parent);
  doc.createNode("orphan").setMesh(make([[50, 0, 50, 51, 1, 51]]));
  if (draco) doc.createExtension(KHRDracoMeshCompression).setRequired(true)
    .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.SEQUENTIAL });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(), "draco3d.encoder": await draco3d.createEncoderModule() });
  return io.writeBinary(doc);
}

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

console.log("\nmodel downloads, governed:");
{
  const { WorldAgent, meshGovernor } = await import("../mcpl/agent.ts");
  const glb = await buildGlb([[-1, 0, -1, 1, 1, 1]]);
  const huge = new Uint8Array(49 * 1024 * 1024);
  let open = 0, most = 0, served = 0;
  const srv = Bun.serve({ port: 0, async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/library/huge.glb") return new Response(huge);
    open++; most = Math.max(most, open); served++;
    await Bun.sleep(150);
    open--;
    return new Response(glb);
  } });
  const g: any = new WorldAgent({ name: "governed", world: "gov", url: `ws://127.0.0.1:${srv.port}/ws` });
  const t0 = performance.now();
  const meshes = await Promise.all(Array.from({ length: 64 }, (_, i) => g.meshFor(`m${i}.glb`)));
  check("64 unique models replayed at once download a few at a time, and all decode",
    most <= 3 && meshGovernor.maxActive <= 3 && served === 64 && meshes.every((m: any) => m?.indices?.length > 0),
    `at most ${most} at once (governor ${meshGovernor.maxActive}), ${served} served, ${(performance.now() - t0).toFixed(0)}ms`);
  check("...and nothing is left queued", meshGovernor.active === 0 && meshGovernor.queued === 0, JSON.stringify({ active: meshGovernor.active, queued: meshGovernor.queued }));
  const big = await g.meshFor("huge.glb");
  const why = [...meshGovernor.fallbacks].find(([k]) => k.endsWith("huge.glb"))?.[1];
  check("a model over the size limit is not decoded: its /geom summary stands in, and says why", big === null && /over the 50MB exact-collision limit/.test(why ?? ""), String(why));
  srv.stop(true);
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
  const walk = async (x: number, z: number) => { const ok = await a.walkTo(x, z, false, 30_000); return ok; };

  check("starts outside, on the terrain", await walk(0, 5) && near(a.pos.y, a.heightAt(0, 5)), `y ${a.pos.y}`);
  check("walks in through the doorway onto the raised floor — feet ON it, not 0.3m under",
    await walk(0, 2) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)} want ${(gy + FLOOR).toFixed(3)}`);
  check("crosses the hall beneath the upper floor and stays downstairs",
    await walk(-1.5, -1.5) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)}`);
  await walk(0, 2);
  check("reaches the foot of the stair", await walk(2.2, 1.9) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)}`);
  check("climbs the stair to the upper floor", await walk(2.2, -2.4) && near(a.pos.y, gy + UPPER), `y ${a.pos.y.toFixed(3)} want ${(gy + UPPER).toFixed(3)}`);
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
  check("is held back by the railing at the well's edge (no walking off it)",
    !(await walk(2.2, 0)) && a.pos.x < 1.6 && near(a.pos.y, gy + UPPER), `at (${a.pos.x.toFixed(2)}, ${a.pos.y.toFixed(2)}, ${a.pos.z.toFixed(2)})`);
  check("...and the walk says why it stopped", /blocked at .* something solid/.test(a.walkStall ?? ""), String(a.walkStall));
  await walk(0, -2.4);
  check("goes back down the stair", await walk(2.2, -2.4) && await walk(2.2, 1.9) && near(a.pos.y, gy + FLOOR), `y ${a.pos.y.toFixed(3)}`);
  check("and out the door to the terrain", await walk(0, 2) && await walk(0, 5) && near(a.pos.y, a.heightAt(0, 5)), `y ${a.pos.y.toFixed(3)}`);
  await walk(-6, 5); await walk(-6, 0);
  const t0 = Date.now();
  const through = await walk(0, 0);
  check("a straight walk at the west wall from outside stops at the wall instead of passing through it",
    !through && a.pos.x < -3 + 0.1, `ended at x ${a.pos.x.toFixed(2)}`);
  // 2.68m of open ground at 1.55 m/s, then the stall window: seconds, not the 30s timeout
  check("...promptly, not at the walk timeout", Date.now() - t0 < 5_000, `${Date.now() - t0}ms`);

  console.log("\nwalking while a placed thing's shape is still loading:");
  {
    const { forgetMeshCache } = await import("../mcpl/agent.ts");
    // a thin wall across the way, its model download held up 2.5s
    const wallUp = await fetch(`${h.BASE}/upload?name=wall`, { method: "POST", body: await buildGlb([[-0.1, 0, -3, 0.1, 3, 3]]) });
    const wallLib = ((await wallUp.json()) as { path: string }).path;
    const realFetch = globalThis.fetch;
    let delayed = 0;
    globalThis.fetch = (async (u: any, o?: any) => {
      if (String(u).includes(`/library/${wallLib}`)) { delayed++; await sleep(2500); }
      return realFetch(u, o);
    }) as typeof fetch;
    try {
      // round the tower to the test ground east of it
      const there = await walk(-6, 0) && await walk(-6, 10) && await walk(19, 10);
      check("(at the test ground, x 19)", there && Math.abs(a.pos.x - 19) < 0.05, `at (${a.pos.x.toFixed(2)}, ${a.pos.z.toFixed(2)})`);
      const wy = a.heightAt(20, 10);
      a.verb("spawn", { id: "wall", lib: wallLib, pos: [20, wy, 10], yaw: 0, collide: "exact" });
      for (let i = 0; i < 40 && !a.entities.get("wall"); i++) await sleep(25);
      const crossed = await walk(21, 10);
      check("a wall spawned just now, its shape still downloading: a walk at it waits, then stops at it — never passes through",
        !crossed && a.pos.x > 19 - 0.1 && a.pos.x < 19.9 && delayed > 0, `ended at x ${a.pos.x.toFixed(2)}, ${delayed} delayed fetch(es), ${a.walkStall ?? a.walkRefusal}`);

      // a cold join: a body that left beside the wall comes back, and its
      // first walk is through the wall while the wall's shape is downloading
      await sleep(1500);                                // the server's settled memory catches the pose
      a.close(); await sleep(500);
      forgetMeshCache();
      delayed = 0;
      a = new WorldAgent({ name: "walker", world: "meshcollide", url: URL_ });
      await a.connect();
      const pending = a.supportPending.size, from = a.pos.x;
      const back = await walk(21, 10);
      check("rejoining beside it and walking at it at once: blocked by it too",
        Math.abs(from - 19.3) < 0.7 && !back && a.pos.x < 19.9 && delayed > 0, `ended at x ${a.pos.x.toFixed(2)}, ${pending} syncs pending at the first walk, ${delayed} delayed`);
    } finally { globalThis.fetch = realFetch; }
  }
} finally {
  try { a.close(); } catch { /* gone */ }
  await h.cleanup(tally.failed || process.exitCode ? 1 : 0);
}
console.log(`${tally.passed} passed, ${tally.failed} failed`);
process.exit(tally.failed ? 1 : 0);
