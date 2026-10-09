import { WorldAgent } from "../mcpl/agent.ts";

let passed = 0;
function ok(cond: unknown, name: string) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`  PASS ${name}`); passed++;
}

const ag = new WorldAgent({ name: "look-test" });
ag.people.set("apricot", {
  id: "apricot", avatar: "", agent: false,
  pose: { p: [null as unknown as number, 0, null as unknown as number], yaw: 0, speed: 0, clip: "idle" },
});
let out = "";
try { out = ag.look(); } catch (e) { throw new Error(`look threw on null coordinates: ${e}`); }
ok(out.includes("apricot (just arrived, position unknown)"), "null-coordinate arrival is rostered as position unknown");
ok(!out.includes("NaN") && !out.includes("null"), "invalid coordinates do not leak into spatial prose");

ag.people.set("apricot", {
  id: "apricot", avatar: "", agent: false,
  pose: { p: [3, 0, -4], yaw: 0, speed: 0, clip: "idle" },
});
out = ag.look();
ok(out.includes("apricot: 5.0m"), "later finite pose restores ordinary spatial perception");
ok(out.includes("at (3.0, -4.0)"), "finite coordinates render normally");

// Heading (#225): every person line says which way they face, from pose.yaw
// (world yaw: 0 faces +z, which bearing() names S; +π/2 faces +x, E).
const lineFor = (id: string, text: string) => text.split("\n").find((l) => l.includes(`- ${id}:`)) ?? "";
for (const [yaw, want] of [[0, "S"], [Math.PI / 2, "E"], [Math.PI, "N"], [-Math.PI / 2, "W"], [Math.PI / 4, "SE"]] as const) {
  ag.people.set("apricot", { id: "apricot", avatar: "", agent: false, pose: { p: [3, 0, -4], yaw, speed: 0, clip: "idle" } });
  ok(lineFor("apricot", ag.look()).includes(`standing, facing ${want}`), `yaw ${yaw.toFixed(2)} reads as facing ${want}`);
}
// the same formatter as our own line: a body facing the same way reads the same
ag.people.set("apricot", { id: "apricot", avatar: "", agent: false, pose: { p: [3, 0, -4], yaw: 0.6, speed: 0, clip: "idle" } });
ag.yaw = 0.6;
out = ag.look();
const own = out.match(/You are .*?facing (\S+?)[.,( ]/)?.[1];
ok(own && lineFor("apricot", out).includes(`facing ${own}`), "a person facing our way reads with our own facing word");
// missing / non-finite yaw: say nothing rather than a wrong direction
for (const yaw of [NaN, Infinity, undefined as unknown as number]) {
  ag.people.set("apricot", { id: "apricot", avatar: "", agent: false, pose: { p: [3, 0, -4], yaw, speed: 0, clip: "idle" } });
  const l = lineFor("apricot", ag.look());
  ok(l.includes("apricot: 5.0m") && !l.includes("facing") && !l.includes("NaN"), `yaw ${String(yaw)} omits facing`);
}
// riders: the root follows the seat socket, so its yaw is not where they face
ag.people.set("apricot", { id: "apricot", avatar: "", agent: false, pose: { p: [3, 0, -4], yaw: Math.PI / 2, speed: 0, clip: "sitchair" } });
ag.mounts.set("apricot", { to: "bench-1", slot: "seat" });
const rider = lineFor("apricot", ag.look());
ok(rider.includes("on bench-1") && !rider.includes("facing"), "a rider's line omits facing");
ag.mounts.delete("apricot");
ok(lineFor("apricot", ag.look()).includes("facing E"), "dismounted, facing returns");

console.log(`\n${passed} passed, 0 failed`);
process.exit(0);   // the agent keeps a timer alive; the checks are done
