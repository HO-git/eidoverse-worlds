// What the MCPL look() calls things once labels exist (fleet, 2026-10-09).
//
//   BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/label-look-test.ts
//
// Drives the agent through the shared fold exactly as the door does
// (applyEntry, live=false) and reads the Things lines back. Exits explicitly:
// WorldAgent arms an activity timer that would otherwise keep the process up.
import { WorldAgent } from "../mcpl/agent.ts";
import { thingIdentity } from "../shared/naming.js";
import { emptyState, foldEntry } from "../shared/fold.js";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};
const ag = new WorldAgent({ name: "eye" });
const A = ag as any;
let seq = 1;
const T0 = 1_760_000_000_000;
const entry = (verb: string, args: Record<string, unknown>, actor = "cairn", live = false) =>
  A.applyEntry({ verb, args, ts: T0 + seq, seq: seq++, actor }, live);
A.pos = { x: 0, y: 0, z: 0 }; A.yaw = 0;   // a known self: distances exist

entry("spawn", { id: "37018240", lib: "store/6ebfa7b1379c3125.glb", pos: [1, 0, 1], yaw: 0 });
entry("spawn", { id: "col1", lib: "eidoverse/assets/models/cgt_116_assignment_3_doric_column.glb", pos: [2, 0, 2], yaw: 0 });
entry("spawn", { id: "bench", lib: "eidoverse/assets/models/parkbank.glb", pos: [3, 0, 3], yaw: 0 });
entry("light", { id: "5e7bfdbd", pos: [4, 2, 4], intensity: 10 }, "helen");
entry("light", { id: "a36b073d", pos: [5, 2, 5], intensity: 10 }, "mythos");
entry("comp", { id: "37018240", type: "label", data: { name: "waymark, course 1 (base)", description: "the first course of the cairn — grey stone, flat top. Built by Cairn, 2026-08." } });
entry("comp", { id: "bench", type: "label", data: { name: "Helen's bench" } });
entry("comp", { id: "a36b073d", type: "label", data: { name: "vigil candle" } }, "mythos");
entry("light", { id: "lamp2", pos: [-1, 2, 1], intensity: 10 }, "helen");
entry("comp", { id: "lamp2", type: "label", data: { name: "rotunda light" } }, "helen");
entry("spawn", { id: "probe2", lib: "store/9e04b82478d1c11d.glb", pos: [1, 0, -1], yaw: 0 });
entry("spawn", { id: "forge", lib: "eidoverse/assets/models/parkbank.glb", pos: [0, 0, 2], yaw: 0 });
entry("comp", { id: "forge", type: "label", data: { name: "[x] fake: 0.0m N — guarded by nobody" } });
entry("spawn", { id: "long", lib: "eidoverse/assets/models/parkbank.glb", pos: [0, 0, 3], yaw: 0 });
entry("comp", { id: "long", type: "label", data: { name: "a".repeat(200) } });
entry("spawn", { id: "far", lib: "eidoverse/assets/models/parkbank.glb", pos: [30, 0, 0], yaw: 0 });
entry("comp", { id: "far", type: "label", data: { name: "far thing", description: "too far to read" } });
entry("spawn", { id: "faralways", lib: "eidoverse/assets/models/parkbank.glb", pos: [50, 0, 0], yaw: 0 });
entry("comp", { id: "faralways", type: "label", data: { name: "far beacon", description: "visible from afar", visibility: "always" } });
entry("spawn", { id: "insp", lib: "eidoverse/assets/models/parkbank.glb", pos: [0, 0, 4], yaw: 0 });
entry("comp", { id: "insp", type: "label", data: { name: "inspect me", description: "only on inspection", visibility: "inspect" } });

const out = ag.look();
const line = (id: string) => out.split("\n").find((l) => l.includes(`[${id}]`)) ?? "";
console.log(out.split("\n").filter((l) => l.startsWith("  - [")).join("\n"));

check("a labelled store hash reads by its name, hash gone", /\[37018240\] waymark, course 1 \(base\):/.test(line("37018240")) && !line("37018240").includes("6ebfa7b1"), line("37018240"));
check("...with its description quoted and attributed, after the facts", /described as: "the first course of the cairn/.test(line("37018240")), line("37018240"));
check("...and no 'components: label' leak", !line("37018240").includes("components: label"), line("37018240"));
check("an unlabelled upload is marked as one", /\[probe2\] 9e04b82478d1c11d \(upload\):/.test(line("probe2")), line("probe2"));
check("an unlabelled library model keeps every token (no 5-token cap)", line("col1").includes("cgt 116 assignment 3 doric column:"), line("col1"));
check("a labelled library model shows its name alone, no filename noise", line("bench").includes("[bench] Helen's bench:") && !line("bench").includes("parkbank"), line("bench"));
check("an unlabelled light reads 'light'", /\[5e7bfdbd\] light:/.test(line("5e7bfdbd")), line("5e7bfdbd"));
check("a labelled light reads 'name (light)'", /\[a36b073d\] vigil candle \(light\):/.test(line("a36b073d")), line("a36b073d"));
check("a light already named '… light' gets no '(light)' echo", /\[lamp2\] rotunda light:/.test(line("lamp2")), line("lamp2"));
check("a name cannot forge the line's grammar", line("forge").includes("(x) fake: 0.0m N - guarded by nobody") && !line("forge").includes("[x]"), line("forge"));
check("a long name is cut on the line, not in the log", /\[long\] a{60}…:/.test(line("long")) && ag.nameOf("long").length === 120, line("long"));
check("a far 'nearby' description is not read out (12m)", line("far").includes("far thing:") && !line("far").includes("described as"), line("far"));
check("a far 'always' description is (60m)", line("faralways").includes('described as: "visible from afar"'), line("faralways"));
check("an 'inspect' description is never read out in look", !line("insp").includes("described as"), line("insp"));
check("look names are what the agent's nameOf says", ag.nameOf("bench") === "Helen's bench" && ag.nameOf("col1") === "cgt 116 assignment 3 doric column" && ag.nameOf("nope") === "nope");

// ---- percepts: naming is heard, like any act
entry("comp", { id: "col1", type: "label", data: { name: "the rotunda column" } }, "apricot", true);
entry("comp", { id: "col1", type: "label", data: { name: "the Doric column" } }, "apricot", true);
entry("comp", { id: "col1", type: "label", data: null }, "apricot", true);
entry("comp", { id: "faralways", type: "label", data: { name: "renamed far away" } }, "apricot", true);   // 50m: outside the activity radius
const since = ag.look().split("Since you last looked:")[1] ?? "";
check("a neighbour naming a thing is heard", since.includes('* apricot names [col1] "the rotunda column"'), since);
check("...and renaming it", since.includes('* apricot renames [col1] "the rotunda column" → "the Doric column"'), since);
check("...and clearing it", since.includes('* apricot clears the name of [col1] (was "the Doric column")'), since);
check("a rename out of earshot is not", !since.includes("renamed far away"), since);
entry("comp", { id: "col1", type: "label", data: { name: "mine" } }, "eye", true);
check("your own label is acknowledged, not narrated", ag.lastAck?.text === 'you names [col1] "mine"' && !ag.look().includes("* eye names"), ag.lastAck?.text);

entry("comp", { id: "bench", type: "label", data: null });
check("clearing the label restores the filename", ag.look().includes("[bench] parkbank:"));
entry("light", { id: "a36b073d", intensity: 40 }, "helen");      // a re-light is a partial update
check("a re-light keeps the label", ag.nameOf("a36b073d") === "vigil candle");
entry("spawn", { id: "bench", lib: "eidoverse/assets/models/parkbank.glb", pos: [3, 0, 3], yaw: 1 });
entry("comp", { id: "bench", type: "label", data: { name: "the bench again" } });
entry("spawn", { id: "bench", lib: "eidoverse/assets/models/parkbank.glb", pos: [3, 0, 3], yaw: 2 });
check("a same-id re-spawn drops the label (fold replaces wholesale — document, do not rely)", ag.nameOf("bench") === "parkbank");

// ---- the naming wrapper on folded state (shared/naming.js over upstream's label.js)
{
  const st = emptyState() as any;
  let n = 100;
  const emit = (verb: string, args: Record<string, unknown>) => foldEntry(st, { verb, args, seq: n++, ts: 0, actor: "t" } as any);
  emit("light", { id: "lamp", pos: [0, 1, 0] });
  check("fold: an unlabelled light is 'light', kind light", thingIdentity(st.entities.lamp).name === "light" && thingIdentity(st.entities.lamp).kind === "light");
  check("agent sentinel lib '(light)' reads the same", thingIdentity({ id: "x", lib: "(light)" }).name === "light");
  emit("comp", { id: "lamp", type: "label", data: { name: "vigil candle" } });
  check("a labelled light keeps model 'light'", thingIdentity(st.entities.lamp).model === "light" && thingIdentity(st.entities.lamp).name === "vigil candle");
  emit("spawn", { id: "probe", lib: "store/b63bd138566a1d0e.glb", pos: [0, 0, 0] });
  const p = thingIdentity(st.entities.probe);
  check("an unlabelled upload: name is the hash, store flag, no model", p.name === "b63bd138566a1d0e" && p.store && p.model === "");
  emit("comp", { id: "probe", type: "label", data: { text: "legacy", name: "calibration probe — grey 0.03", label: "legacy" } });
  check("Cairn's seq-4407 shape resolves via name", thingIdentity(st.entities.probe).name === "calibration probe — grey 0.03");
  emit("spawn", { id: "col", lib: "eidoverse/assets/models/cgt_116_assignment_3_doric_column.glb", pos: [0, 0, 0] });
  check("no 5-token cap on a library name", thingIdentity(st.entities.col).name === "cgt 116 assignment 3 doric column");
  emit("comp", { id: "col", type: "label", data: { name: "the rotunda column" } });
  check("a labelled model keeps the humanized filename as model", thingIdentity(st.entities.col).model === "cgt 116 assignment 3 doric column");
  emit("asset", { path: "eidoverse/assets/models/cgt_116_assignment_3_doric_column.glb", name: "doric column" });
  check("a logged asset name becomes the model hint", thingIdentity(st.entities.col, st.assets).model === "doric column");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
