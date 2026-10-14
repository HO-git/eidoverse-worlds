// chat scrollback — paging history into an arrival window that has holes.
//
//   bun tools/chat-scrollback-test.ts
//
// The join window is what trimRecentChat (shared/fold.js) left, and it is
// fair rather than contiguous: the loudest voice loses its oldest lines
// first, so a quiet visitor's last line from yesterday can sit above hours of
// trimmed conversation. Scrollback used to page from the oldest line SHOWN —
// i.e. from below that visitor's line — so it jumped straight over the hole
// and the trimmed talk was never reachable from the browser. The contract
// now: scrolling up walks history from the present, fills the holes in seq
// order, never renders a line twice, and reaches the beginning with every
// say on screen exactly once.

import { plugin } from "bun";
const here = (f: string) => new URL(f, import.meta.url).pathname;
plugin({
  name: "chat-stubs",
  setup(b) {
    b.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: here("./chat-core-stub.mjs") }));
    b.onResolve({ filter: /^\.\/base\.js$/ }, () => ({ path: here("./chat-base-stub.mjs") }));
    b.onResolve({ filter: /^\.\/frames\.js$/ }, () => ({ path: here("./chat-frames-stub.mjs") }));
    b.onResolve({ filter: /^\.\/net\.js$/ }, () => ({ path: here("./chat-history-stub.mjs") }));
  },
});

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

const { logChat, initChat } = await import("../client/lib/chat.js");
const { setLog } = await import("./chat-history-stub.mjs");
const { emptyState, foldEntry } = await import("../shared/fold.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

initChat({ send: () => {}, whisper: () => {}, people: () => [{ id: "me", me: true }] });
const logEl = () => document.getElementById("chatlog")!;
const shown = () => [...logEl().children]
  .filter((c) => !c.classList.contains("sys"))
  .map((c) => c.querySelector(".body")?.textContent ?? "");

// Yesterday a visitor said two things, with one regular's line between them;
// today the regulars talked a lot. The window keeps both visitor lines (now
// adjacent, so the second is grouped under the first's name) and trims the
// regular's line out from between them. 200 says, seq = position, text = "#<seq>" so order is legible.
const t0 = Date.now() - 86_400_000;
const entries: any[] = [];
const speak = (actor: string) => {
  const seq = entries.length + 1;
  entries.push({ seq, ts: t0 + seq * 30_000, actor, verb: "say", args: { text: `#${seq}` } });
};
for (let i = 0; i < 20; i++) speak(i % 2 ? "cairn" : "mythos");
speak("visitor"); speak("cairn"); speak("visitor");
for (let i = 0; i < 177; i++) speak(["cairn", "mythos", "apricot"][i % 3]);
const all = entries.map((e) => e.args.text);

// the window a joiner is actually handed: the real fold, not a hand-made one
const st = emptyState();
for (const e of entries) foldEntry(st, e);
const window = st.recentChat.map((m: any) => m.seq);
const contiguousFrom = (() => {           // oldest seq of the unbroken run at the end
  let s = window[window.length - 1];
  while (window.includes(s - 1)) s--;
  return s;
})();
check("precondition: the fold's window has a hole (visitor kept, regulars trimmed)",
  window.includes(21) && window.includes(23) && !window.includes(22) && contiguousFrom > 24, `window=${window.join(",")}`);

setLog(entries);
for (const m of st.recentChat) logChat(m.actor, m.text, "", { seq: m.seq, ts: m.ts });
const windowCont = logEl().querySelectorAll(".line.cont").length;

const scrollUp = async () => {
  logEl().dispatchEvent(new Event("scroll"));
  await Bun.sleep(20);   // the stub answers at once; let loadOlder finish its pass
};

// --- first scroll fills the hole nearest the present, not older days
await scrollUp();
const afterOne = shown();
const holeEdge = `#${contiguousFrom - 1}`;   // the newest line the trim took
check("first scroll-up brings back the newest trimmed line",
  afterOne.includes(holeEdge), `missing ${holeEdge}`);
check("…and does not leap past the hole to the beginning",
  !afterOne.includes("#1"), "jumped to #1");
const isSorted = (xs: string[]) => xs.every((x, i) => !i || +xs[i - 1].slice(1) < +x.slice(1));
check("lines stay in seq order after a gap fill", isSorted(afterOne), afterOne.join(" "));

// --- keep scrolling: everything, once, in order
for (let i = 0; i < 20 && !logEl().textContent!.includes("beginning of this world"); i++) await scrollUp();
const final = shown();
check("scrolling to the top reaches the beginning", logEl().textContent!.includes("beginning of this world"));
check("every say is on screen exactly once",
  final.length === all.length && new Set(final).size === all.length,
  `${final.length} shown, ${new Set(final).size} distinct, want ${all.length}`);
check("…in world order", final.join(" ") === all.join(" "));

// --- grouping survives the fill: a grouped line ("cont", name hidden) that
// gets a different speaker slotted in front of it must reprint its name, or
// those words read as the newcomer's
const groupedOk = (els: Element[]) => els.every((c, i) =>
  !c.classList.contains("cont") || (els[i - 1] as HTMLElement | undefined)?.dataset.author === (c as HTMLElement).dataset.author);
check("precondition: the window had grouped lines to displace", windowCont > 0, `${windowCont}`);
const rowsEls = [...logEl().children].filter((c) => !c.classList.contains("sys"));
check("no grouped line sits under a different speaker", groupedOk(rowsEls));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
