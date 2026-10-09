// name-snowball-test — renderer/spectator names must not grow their transport
// prefix (#221), headless.
//
//   bun tools/name-snowball-test.ts
//
// Three places decide a client's stored name, and each is pinned here:
//   1. base.js at load — heals a poisoned ew-name (any leading prefix on a
//      renderer/spectator, only a stacked one for a person).
//   2. nameFromJoinAck (net.js onSnapshot) — strips the prefix sendJoin put
//      on the wire id, but never from a verified identity.
//   3. index.html's early socket — must not join with a poisoned name (it
//      runs before base.js heals, and on a new world would make the poisoned
//      name the owner).
// Plus the loop itself: five reloads of a renderer and a spectator, wire id
// out and ack back, must leave the stored name where it started.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = join(import.meta.dir, "..");

// ---- 1. base.js load-time heal (fresh process per case: base.js reads its globals once) ----
console.log("base.js heal at load");
function loadBase(search: string, stored: string | null) {
  const code = `
    const mem = new Map(${JSON.stringify(stored === null ? [] : [["ew-name", stored]])});
    globalThis.location = { search: ${JSON.stringify(search)}, host: "x", pathname: "/" };
    globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const b = await import(${JSON.stringify(join(ROOT, "client/lib/base.js"))});
    console.log(JSON.stringify({ name: b.CONFIG.name, stored: mem.get("ew-name") }));`;
  const r = Bun.spawnSync(["bun", "-e", code], { stdout: "pipe", stderr: "pipe" });
  try { return JSON.parse(r.stdout.toString().trim().split("\n").pop()!); }
  catch { return { name: `ERROR ${r.stderr.toString().slice(0, 200)}`, stored: null }; }
}
for (const [mode, search, stored, want] of [
  ["renderer", "?renderer", "renderer-renderer-helen", "helen"],
  ["renderer", "?renderer", "renderer-helen", "helen"],
  ["spectate", "?spectate", "retina-retina-retina-helen", "helen"],
  ["person", "", "retina-retina-helen", "helen"],
  ["person", "", "renderer-fan", "renderer-fan"],   // one prefix on a person is a real name
  ["renderer", "?renderer", "helen", "helen"],
] as const) {
  const got = loadBase(search, stored);
  check(`${mode}: stored ${stored} → ${want}`, got.name === want && got.stored === want, JSON.stringify(got));
}

// ---- 2. the join ack ----------------------------------------------------------------
console.log("nameFromJoinAck");
const { nameFromJoinAck } = await import("../client/lib/base.js");
check("renderer ack strips renderer-", nameFromJoinAck("renderer-helen", { renderer: true }) === "helen");
check("spectator ack strips retina-", nameFromJoinAck("retina-helen", { spectate: true }) === "helen");
check("a person's ack is taken whole", nameFromJoinAck("retina-fan", {}) === "retina-fan");
check("a dedupe-suffixed ack keeps its suffix", nameFromJoinAck("retina-helen~2", { spectate: true }) === "helen~2");
check("a VERIFIED spectator called retina-helen keeps the name", nameFromJoinAck("retina-helen", { spectate: true, verified: true }) === "retina-helen");
check("a verified renderer ack is taken whole", nameFromJoinAck("renderer-bot", { renderer: true, verified: true }) === "renderer-bot");
check("empty / missing ack passes through", nameFromJoinAck("", { spectate: true }) === "" && nameFromJoinAck(undefined as unknown as string, {}) === undefined);

// ---- the loop: reload → join under a prefixed wire id → ack → store ----------------------
console.log("five reloads");
for (const [mode, prefix] of [["renderer", "renderer-"], ["spectate", "retina-"]] as const) {
  let stored = "helen";
  for (let i = 0; i < 5; i++) {
    const wireId = `${prefix}${stored}`;                          // sendJoin
    const ack = wireId;                                           // unverified: the server echoes it
    stored = nameFromJoinAck(ack, { renderer: mode === "renderer", spectate: mode === "spectate" });
  }
  check(`${mode}: the stored name is still "helen" after 5 reloads`, stored === "helen", stored);
}

// ---- 3. index.html's early socket -------------------------------------------------------
console.log("early socket");
const html = readFileSync(join(ROOT, "client/index.html"), "utf8");
const scriptBody = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("__ewEarlySocket = stash"));
check("the early-socket script is found", !!scriptBody);
function earlyJoin(stored: string) {
  const mem = new Map<string, string>([["ew-name-set", "1"], ["ew-name", stored]]);
  const fakeGlobal: Record<string, unknown> = {};
  let joinedAs: string | null = null;
  class FakeWS { onopen: any; onmessage: any; onclose: any; onerror: any; readyState = 0;
    constructor() { setTimeout(() => this.onopen?.(), 0); }
    send(s: string) { joinedAs = JSON.parse(s).id; } close() {} addEventListener() {} }
  new Function("location", "localStorage", "WebSocket", "globalThis", scriptBody!)(
    { search: "?world=brand-new", protocol: "http:", host: "x" },
    { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) },
    FakeWS, fakeGlobal);
  return new Promise<{ opened: boolean; joinedAs: string | null }>((res) => setTimeout(() => res({ opened: !!fakeGlobal.__ewEarlySocket, joinedAs }), 20));
}
let e = await earlyJoin("helen");
check("a clean saved name still joins early", e.opened && e.joinedAs === "helen", JSON.stringify(e));
e = await earlyJoin("retina-retina-helen");
check("a poisoned saved name does NOT join early (base.js heals it first)", !e.opened && e.joinedAs === null, JSON.stringify(e));
e = await earlyJoin("renderer-fan");
check("a single-prefix person name still joins early", e.opened && e.joinedAs === "renderer-fan", JSON.stringify(e));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
