// Integration test for the MCPL typing bridge: the host's typing signal
// (channels/typing) must surface as an in-world typing signal, kept up while
// the host says the agent is composing and let go at `stop`. Starts its own
// world + MCPL servers on temp ports, connects a raw MCP websocket host, sends
// typing notifications, and a raw world-WS watcher confirms what the world
// broadcasts as `{type:"typing", id:<agent>}`.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WPORT = 8955, MPORT = 8956;
const worldsDir = mkdtempSync(join(tmpdir(), "eido-typing-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}${ok ? "" : "  " + extra}`);
  ok ? pass++ : fail++;
};

// process.execPath, not "bun": the PATH "bun" is an npm .cmd shim on Windows
// whose pid dies immediately, orphaning both of these on their ports where
// they poison the next run.
const world = Bun.spawn([process.execPath, "server/server.ts"], {
  env: { ...process.env, PORT: String(WPORT), WORLDS_DIR: worldsDir },
  stdout: "ignore", stderr: "ignore",
});
// 🔴 post-hardening (anima merge): the token registry REJECTS any key that
// appears in the tracked example — and "dev-token" is in the example, so it
// can never authorize on any machine. Upstream's copy of this suite still
// uses it and is structurally red (flagged for them). A scratch registry
// with a test-only token is the honest fixture.
const tokensPath = join(worldsDir, "tokens.json");
await Bun.write(tokensPath, JSON.stringify({
  "typing-test-token": { id: "claude", name: "Claude", world: "commons" },
}));
const mcpl = Bun.spawn([process.execPath, "mcpl/net-server.ts"], {
  env: { ...process.env, MCPL_PORT: String(MPORT), WORLD_URL: `ws://127.0.0.1:${WPORT}/ws`,
         MCPL_TOKENS: tokensPath },
  stdout: "ignore", stderr: "ignore",
});

try {
  await sleep(2500);

  // A raw world-WS watcher, present in the world, listening for typing relays.
  const seen: any[] = [];
  const watcher = new WebSocket(`ws://127.0.0.1:${WPORT}/ws`);
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("watcher join timeout")), 6000);
    watcher.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); seen.push(m);
      if (m.type === "snapshot") { clearTimeout(t); res(); } };
    watcher.onopen = () => watcher.send(JSON.stringify({ type: "join", world: "commons", id: "watcher", avatar: "a.vrm" }));
  });

  // A raw MCP host connecting to the MCPL door as the "claude" agent (dev-token).
  const host = new WebSocket(`ws://127.0.0.1:${MPORT}/?token=typing-test-token`);
  const rpc = (obj: any) => host.send(JSON.stringify(obj));
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("mcpl init timeout")), 6000);
    host.onopen = () => rpc({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: { experimental: { mcpl: {} } }, clientInfo: { name: "test", version: "0" } } });
    host.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id === 1) { rpc({ jsonrpc: "2.0", method: "notifications/initialized" }); clearTimeout(t); res(); }
    };
  });

  // give the agent body time to actually join the world
  await sleep(1500);

  const typingSeen = () => seen.filter((m) => m.type === "typing" && m.id === "claude").length;
  const typingFor = (channelId: string, op?: "start" | "stop") =>
    rpc({ jsonrpc: "2.0", method: "channels/typing", params: { channelId, ...(op ? { op } : {}) } });

  // The host says the agent has begun composing for this world.
  typingFor("world:commons", "start");
  await sleep(400);
  check("the host's typing start surfaces as an in-world typing signal", typingSeen() >= 1,
    `saw types: ${[...new Set(seen.map((m) => m.type))].join(",")}`);

  // The world's dots last 4 s and the host repeats start only every 7 s, so
  // the door must keep them up in between on its own.
  seen.length = 0;
  await sleep(5200);
  check("the dots are kept up between the host's starts", typingSeen() >= 2, `typing signals in 5.2 s: ${typingSeen()}`);

  // stop lets them go: no signal after it.
  typingFor("world:commons", "stop");
  await sleep(300);
  seen.length = 0;
  await sleep(3200);
  check("stop ends the dots", typingSeen() === 0, `typing signals after stop: ${typingSeen()}`);

  // A start with no op is a start.
  typingFor("world:commons");
  await sleep(400);
  check("a typing signal with no op starts the dots", typingSeen() >= 1);
  typingFor("world:commons", "stop");
  await sleep(300);

  // Typing for a DIFFERENT channel must not light up this world.
  seen.length = 0;
  typingFor("dm:someone", "start");
  await sleep(400);
  check("typing for another channel does not type in this world", typingSeen() === 0);
  typingFor("dm:someone", "stop");

  // The generation stream no longer draws the dots: a host may hold it back
  // until it publishes, and dots then would mean "published".
  seen.length = 0;
  rpc({ jsonrpc: "2.0", method: "channels/outgoing/chunk",
    params: { inferenceId: "inf1", conversationId: "c1", channelId: "world:commons", index: 0, delta: "Hel" } });
  await sleep(400);
  check("a chunk of the generation stream no longer types in this world", typingSeen() === 0);

  watcher.close(); host.close();
} catch (e) {
  fail++;
  console.log(`\x1b[31mFATAL\x1b[0m ${(e as Error).message}\n${(e as Error).stack}`);
} finally {
  world.kill(); mcpl.kill();
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
