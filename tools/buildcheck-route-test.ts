// bun tools/buildcheck-route-test.ts — the build check as a server and an
// agent meet it: an upload answers at once with where its check will be (and
// is never refused for what the check finds), GET /check serves the report
// (cached after the first run), and the check_model tool reads it out.
process.env.AGENT_BODY_ENGINE = "verlet";
process.env.WORLD_TOKEN = "";
const { boxes, buildGlb } = await import("./two-storey-fixture.ts");
const { scratchSequencer, mkCheck, sleep } = await import("./harness.ts");
const { check, tally } = mkCheck();

const ROOF = [-3.2, 6.3, -3.2, 3.2, 6.5, 3.2];
const h = await scratchSequencer("buildcheck-route", { serverEnv: { SKIP_OPT_SWEEP: "1" }, portFrom: 9540 });
const { WorldAgent } = await import("../mcpl/agent.ts");
const { handleTool } = await import("../mcpl/tools.ts");
const a: any = new WorldAgent({ name: "inspector", world: "checks", url: h.BASE.replace("http", "ws") + "/ws" });
const ctx = { agent: a, canPush: () => false, heldActivity: [], cursor: { caughtUpTo: null } };
const tool = async (name: string, args: Record<string, any>) => ((await handleTool(ctx as any, name, args)) as any).content.map((c: any) => c.text).join("\n");
try {
  await a.connect();
  const t0 = performance.now();
  const up = await (await fetch(`${h.BASE}/upload?name=checked-tower`, { method: "POST", body: await buildGlb([...boxes, ROOF] as any) })).json() as any;
  const upMs = performance.now() - t0;
  check("an upload answers at once, with where its check will be", typeof up.path === "string" && up.check === `/check?lib=${encodeURIComponent(up.path)}` && upMs < 3000, `${JSON.stringify(up)} in ${upMs.toFixed(0)}ms`);
  // a model with a problem is stored all the same — the check is advice
  const narrowBoxes = [...boxes.filter((b: number[]) => !(b[2] === 2.8 && b[5] === 3)), [-3, 0.3, 2.8, -0.25, 6.3, 3], [0.25, 0.3, 2.8, 3, 6.3, 3], [-0.25, 2.4, 2.8, 0.25, 6.3, 3], ROOF];
  const bad = await (await fetch(`${h.BASE}/upload?name=narrow-tower`, { method: "POST", body: await buildGlb(narrowBoxes as any) })).json() as any;
  check("an upload the check will find fault with is still accepted", typeof bad.path === "string" && bad.path !== up.path, JSON.stringify(bad));

  const r = await (await fetch(`${h.BASE}${up.check}`)).json() as any;
  check("GET /check serves the report: no problems, two floors, a room on each, a door and a stair",
    r.ok === true && r.levels.length === 2 && r.suggested.rooms.length === 2 && r.suggested.doors.length >= 1 && r.suggested.stairs.length === 1,
    JSON.stringify({ ok: r.ok, warnings: r.warnings, levels: r.levels, rooms: r.suggested?.rooms?.length }));
  const t1 = performance.now();
  const again = await (await fetch(`${h.BASE}${up.check}`)).json() as any;
  check("a second ask is answered from the cache", JSON.stringify(again) === JSON.stringify(r) && performance.now() - t1 < 500, `${(performance.now() - t1).toFixed(0)}ms`);
  const rb = await (await fetch(`${h.BASE}${bad.check}`)).json() as any;
  check("the faulty one's report names the narrow doorway", rb.warnings?.some((w: any) => w.kind === "narrow"), JSON.stringify(rb.warnings));
  check("an unknown asset is a 404 with a reason", (await fetch(`${h.BASE}/check?lib=store/nope.glb`)).status === 404);

  a.verb("spawn", { id: "tower", lib: up.path, pos: [0, a.heightAt(0, 0), 0], yaw: 0 });
  for (let i = 0; i < 40 && !a.entities.get("tower"); i++) await sleep(50);
  const said = await tool("check_model", { id: "tower" });
  check("check_model reads it out for a placed thing: walk-in, floors, no problems, suggestions and the comp to name them",
    /\[tower\].*walk-in; 2 floors/.test(said) && /No problems found/.test(said) && /Suggested places/.test(said) && /comp \{id: "tower", type: "places"/.test(said), said);
  const saidBad = await tool("check_model", { lib: bad.path });
  check("...and the problems, for a library path", /Problems:\n  - .*narrower than a body/.test(saidBad), saidBad.slice(0, 400));
} finally {
  try { a.close(); } catch { /* gone */ }
  await h.cleanup(tally.failed || process.exitCode ? 1 : 0);
}
console.log(`${tally.passed} passed, ${tally.failed} failed`);
process.exit(tally.failed ? 1 : 0);
