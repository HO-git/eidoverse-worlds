// name-snowball-test — renderer/spectator names must not grow their transport
// prefix (#221), headless.
//
//   bun tools/name-snowball-test.ts
//
// The join ack is where a client's stored name came to grow: nameFromJoinAck
// (net.js onSnapshot) strips the prefix sendJoin put on the wire id, but
// never from a verified identity. Pinned here: the function itself; the loop,
// five reloads of a renderer and a spectator, wire id out and ack back,
// leaving the stored name where it started; and the real net.js onSnapshot →
// sendJoin, so reverting the nameFromJoinAck call there fails by name (the
// function's own checks would not notice).

import { join } from "node:path";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const ROOT = join(import.meta.dir, "..");

// ---- the join ack -------------------------------------------------------------------
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

// ---- net.js onSnapshot, the call itself ----------------------------------------------------
// The checks above pin nameFromJoinAck as a function; this pins that onSnapshot
// USES it, the one place that stops a spectator storing "retina-helen" (and
// joining under it on their next visit as a person) or a renderer that
// reconnects without reloading from joining as "renderer-renderer-helen".
// Real net.js + base.js, fresh process per page load; only the DOM-touching UI
// modules are stubbed.
console.log("net.js onSnapshot");
type Step = { ack: string; sub?: string } | "join";
function pageLoad(search: string, stored: string, steps: Step[]) {
  const L = join(ROOT, "client/lib") + "/";
  const code = `
    const mem = new Map([["ew-name", ${JSON.stringify(stored)}]]);
    globalThis.location = { search: ${JSON.stringify(search)}, host: "x", pathname: "/", protocol: "http:" };
    globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const { mock } = await import("bun:test");
    const L = ${JSON.stringify(L)};
    mock.module(L + "presence.js", () => ({ presence: {} }));
    mock.module(L + "chat.js", () => ({ logChat() {}, logWhisper() {}, noteTyping() {}, noteHistoryContext() {}, resyncChatAfter() {} }));
    mock.module(L + "boot.js", () => ({ markPhase() {} }));
    const net = await import(L + "net.js");
    const { CONFIG } = await import(L + "base.js");
    const joins = [];
    net.net.ws = { send: (s) => { const m = JSON.parse(s); if (m.type === "join") joins.push(m.id); }, readyState: 1 };
    for (const s of ${JSON.stringify(steps)}) {
      if (s === "join") net.sendJoin();
      else await net._dispatch({ type: "snapshot", you: s.ack, yourSub: s.sub, present: [], entries: [], state: {} });
    }
    console.log(JSON.stringify({ name: CONFIG.name, stored: mem.get("ew-name"), joins }));`;
  const r = Bun.spawnSync(["bun", "-e", code], { stdout: "pipe", stderr: "pipe" });
  try { return JSON.parse(r.stdout.toString().trim().split("\n").pop()!) as { name: string; stored: string; joins: string[] }; }
  catch { return { name: `ERROR ${r.stderr.toString().slice(0, 300)}`, stored: "", joins: [] as string[] }; }
}
{
  // the person case: spectate once, then come back as a person
  const spec = pageLoad("?spectate", "helen", ["join", { ack: "retina-helen" }]);
  check("spectator: joins as retina-helen", spec.joins[0] === "retina-helen", JSON.stringify(spec));
  check("spectator: the retina-helen ack leaves CONFIG.name and ew-name at helen",
    spec.name === "helen" && spec.stored === "helen", JSON.stringify(spec));
  const back = pageLoad("", spec.stored, ["join"]);
  check("…and the next visit, as a person, joins as helen", back.joins[0] === "helen", JSON.stringify(back));

  // the renderer case: reconnect without a reload
  const rend = pageLoad("?renderer", "helen", ["join", { ack: "renderer-helen" }, "join", { ack: "renderer-helen" }, "join"]);
  check("renderer: reconnects keep joining as renderer-helen",
    rend.joins.length === 3 && rend.joins.every((j) => j === "renderer-helen"), JSON.stringify(rend));
  check("renderer: CONFIG.name and ew-name stay helen", rend.name === "helen" && rend.stored === "helen", JSON.stringify(rend));

  // a name poisoned before the fix stops growing: it stays as stored, for its owner to rename
  const old = pageLoad("?renderer", "renderer-renderer-helen", ["join", { ack: "renderer-renderer-renderer-helen" }, "join"]);
  check("a renderer stored as renderer-renderer-helen keeps that name across a rejoin",
    old.name === "renderer-renderer-helen" && old.stored === "renderer-renderer-helen"
      && old.joins.every((j) => j === "renderer-renderer-renderer-helen"), JSON.stringify(old));

  // and the exemption reaches the call: a verified identity is taken whole
  const ver = pageLoad("?spectate", "x", ["join", { ack: "retina-helen", sub: "agent:retina-helen@guest" }]);
  check("verified spectator ack is adopted whole by onSnapshot", ver.name === "retina-helen" && ver.stored === "retina-helen", JSON.stringify(ver));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
