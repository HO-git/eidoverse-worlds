// The door's typing relay (mcpl/typing-relay.ts), on a short clock: it signals
// at `start`, keeps signalling while the host keeps saying `start`, stops at
// `stop`, and stops by itself when the host's refresh is overdue, so a lost
// `stop` can't leave the dots up. The wire is covered by typing-mcpl.test.ts.

import { TypingRelay } from "../mcpl/typing-relay.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}${ok ? "" : "  " + extra}`);
  ok ? pass++ : fail++;
};

const REASSERT = 40, OVERDUE = 200;
const relay = () => {
  const r = { signals: 0, relay: null as unknown as TypingRelay };
  r.relay = new TypingRelay(() => { r.signals++; }, REASSERT, OVERDUE);
  return r;
};

{
  const r = relay();
  r.relay.start();
  check("start signals at once", r.signals === 1, `signals=${r.signals}`);
  await sleep(REASSERT * 3 + 20);
  check("it keeps signalling while the host's start is fresh", r.signals >= 3, `signals=${r.signals}`);
  r.relay.stop();
  const atStop = r.signals;
  await sleep(REASSERT * 3);
  check("stop ends the signals", r.signals === atStop && !r.relay.active, `signals ${atStop} -> ${r.signals}`);
}

{
  const r = relay();
  r.relay.start();
  await sleep(OVERDUE + REASSERT * 3);
  check("with no refresh, it stops by itself once the refresh is overdue", !r.relay.active);
  const after = r.signals;
  await sleep(REASSERT * 3);
  check("and signals no more", r.signals === after, `signals ${after} -> ${r.signals}`);
  check("it signalled about once per interval until then", after >= OVERDUE / REASSERT - 1 && after <= OVERDUE / REASSERT + 3, `signals=${after}`);
}

{
  const r = relay();
  r.relay.start();
  const until = Date.now() + OVERDUE * 2;
  while (Date.now() < until) { await sleep(OVERDUE / 2); r.relay.start(); }
  check("a host that keeps refreshing keeps it up past the overdue window", r.relay.active);
  // Each start signals once, and one timer re-asserts; a second timer would
  // roughly double the count.
  const expected = (OVERDUE * 2) / REASSERT + (OVERDUE * 2) / (OVERDUE / 2) + 1;
  check("a start while it runs adds no second timer", r.signals <= expected + 3, `signals=${r.signals}, expected about ${expected}`);
  r.relay.stop();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
