// snap-timeout-test — SNAP_TIMEOUT_SEC and the [snap] drop logs (#222).
//
//   bun tools/snap-timeout-test.ts
//
// A scratch sequencer with SNAP_TIMEOUT_SEC=2, a body to follow, and a fake
// renderer leg whose reply delay each case sets. Checks: a reply inside the
// window → 200; a reply after it → 504 plus the timeout log and the late
// reply's "expired or unknown" drop log; a reply from a non-renderer client is
// dropped (logged) without consuming the pending snap; client-supplied ids are
// logged escaped (no forged log lines); and out-of-range / junk values for
// SNAP_TIMEOUT_SEC fall back to 12 with a warning. Takes ~10s.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

function spawnSeq(timeoutSec: string) {
  const port = 8000 + Math.floor(Math.random() * 900);
  const proc = Bun.spawn(["bun", "server/server.ts"], {
    env: { ...process.env, PORT: String(port), SNAP_TIMEOUT_SEC: timeoutSec, SKIP_OPT_SWEEP: "1",
      WORLDS_DIR: mkdtempSync(join(tmpdir(), "snap-timeout-")) },
    stdout: "pipe", stderr: "pipe",
  });
  const log: string[] = [];
  for (const s of [proc.stdout, proc.stderr]) (async () => { const d = new TextDecoder(); let buf = "";
    for await (const c of s as ReadableStream<Uint8Array>) { buf += d.decode(c); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) { log.push(buf.slice(0, nl)); buf = buf.slice(nl + 1); } } })();
  return { port, proc, log };
}
async function waitUp(port: number) {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/worlds`); return true; } catch { await Bun.sleep(200); } }
  return false;
}
function join_(port: number, msg: Record<string, unknown>) {
  return new Promise<WebSocket>((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.onopen = () => { ws.send(JSON.stringify({ type: "join", world: "snapt", ...msg })); setTimeout(() => res(ws), 300); };
  });
}
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---- the window ---------------------------------------------------------------
const A = spawnSeq("2");
const procs = [A.proc];
process.on("exit", () => procs.forEach((p) => p.kill()));
if (!(await waitUp(A.port))) { console.error("FATAL: scratch sequencer never came up (bun install in the repo root?)"); process.exit(2); }

const body = await join_(A.port, { id: "target" });
const renderer = await join_(A.port, { id: "renderer-fake", spectate: true, renderer: true });
const bystander = await join_(A.port, { id: "retina-bystander", spectate: true });
let delayMs = 0, holdIds: string[] = [];
renderer.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.type !== "snap") return;
  holdIds.push(m.id);
  if (delayMs >= 0) setTimeout(() => renderer.send(JSON.stringify({ type: "snap-result", id: m.id, dataUrl: PNG })), delayMs);
};
const snap = () => fetch(`http://127.0.0.1:${A.port}/snap?world=snapt&follow=target`);

console.log("window (SNAP_TIMEOUT_SEC=2)");
delayMs = 300;
let r = await snap();
check("reply inside the window → 200 PNG", r.status === 200 && r.headers.get("content-type") === "image/png", String(r.status));

delayMs = 3000;
const t0 = Date.now();
r = await snap();
const waited = Date.now() - t0;
check("reply after the window → 504", r.status === 504, String(r.status));
check("…answered at ~2s, not 12s", waited >= 1800 && waited < 4000, `${waited}ms`);
check("timeout is logged with the snap, follow and renderer", A.log.some((l) => l.includes("[snap]") && l.includes("follow=target") && l.includes("renderer-fake") && l.includes("in 2s")));
await Bun.sleep(1500);   // let the late frame land
check("the late frame's drop is logged as expired/unknown", A.log.some((l) => l.includes("[snap]") && l.includes("expired or unknown") && l.includes("renderer-fake")));

console.log("non-renderer replies");
delayMs = -1; holdIds = [];   // the renderer holds the next snap
const pendingSnap = snap();
await Bun.sleep(300);
const heldId = holdIds.at(-1)!;
bystander.send(JSON.stringify({ type: "snap-result", id: heldId, dataUrl: PNG }));
await Bun.sleep(200);
check("a non-renderer's reply is logged and dropped", A.log.some((l) => l.includes("not a renderer") && l.includes("retina-bystander")));
renderer.send(JSON.stringify({ type: "snap-result", id: heldId, dataUrl: PNG }));
check("…without consuming the pending snap (the renderer still answers it)", (await pendingSnap).status === 200);

console.log("log hygiene");
const before = A.log.length;
bystander.send(JSON.stringify({ type: "snap-result", id: "missing\n[perm] forged by a client\n", dataUrl: PNG }));
bystander.send(JSON.stringify({ type: "snap-result", id: { not: "a string" }, dataUrl: PNG }));
bystander.send(JSON.stringify({ type: "snap-result", id: "x".repeat(5000), dataUrl: PNG }));
await Bun.sleep(300);
const fresh = A.log.slice(before);
check("an id with newlines cannot start its own log line", !fresh.some((l) => l.startsWith("[perm]")) && fresh.some((l) => l.includes("\\n[perm] forged")), fresh.join(" | "));
check("a non-string id logs as (invalid id)", fresh.some((l) => l.includes("(invalid id)")));
check("a huge id is bounded in the log", fresh.every((l) => l.length < 400), String(Math.max(...fresh.map((l) => l.length))));
[body, renderer, bystander].forEach((w) => w.close());

// ---- config validation ----------------------------------------------------------
console.log("SNAP_TIMEOUT_SEC validation");
for (const bad of ["300", "abc", "0", "-5"]) {
  const B = spawnSeq(bad);
  procs.push(B.proc);
  await waitUp(B.port);
  check(`SNAP_TIMEOUT_SEC=${bad} falls back to 12 with a warning`, B.log.some((l) => l.includes(`SNAP_TIMEOUT_SEC=${JSON.stringify(bad)} is not valid — using 12`)), B.log.filter((l) => l.includes("config")).join(" | "));
  B.proc.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
