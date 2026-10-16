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
// say on screen exactly once. Also pinned (review of #243): a spoken row that
// logChat moved by t0 does not scramble the fill, the reader's view holds
// still when rows land above it, and a reconnect's new hole gets filled.
//
// Each scenario gets a FRESH chat.js (cache-busted specifier): the paging
// cursor is module state, and one scenario's walk must not leak into another.

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

const { setLog } = await import("./chat-history-stub.mjs");
const { frameStub } = await import("./chat-frames-stub.mjs");
const { emptyState, foldEntry } = await import("../shared/fold.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

let n = 0;
async function freshChat() {
  frameStub.el?.remove();
  const mod = await import(`../client/lib/chat.js?scenario=${++n}`);
  mod.initChat({ send: () => {}, whisper: () => {}, people: () => [{ id: "me", me: true }] });
  const logEl = frameStub.body!.querySelector("#chatlog") as HTMLElement;
  return { ...mod, logEl };
}

const rowsOf = (logEl: HTMLElement) => [...logEl.children].filter((c) => !c.classList.contains("sys")) as HTMLElement[];
const shownIn = (logEl: HTMLElement) => rowsOf(logEl).map((c) => c.querySelector(".body")?.textContent ?? "");
const num = (t: string) => +t.slice(1);
const isSorted = (xs: string[]) => xs.every((x, i) => !i || num(xs[i - 1]) < num(x));
const settle = () => Bun.sleep(20);   // the stub answers at once; let the async pass finish
const scrollUp = async (logEl: HTMLElement) => { logEl.dispatchEvent(new Event("scroll")); await settle(); };
const scrollToTop = async (logEl: HTMLElement) => {
  for (let i = 0; i < 30 && !logEl.textContent!.includes("beginning of this world"); i++) await scrollUp(logEl);
};
const say = (seq: number, actor: string, ts: number) => ({ seq, ts, actor, verb: "say", args: { text: `#${seq}` } });
const windowOf = (entries: any[]) => {
  const st = emptyState();
  for (const e of entries) foldEntry(st, e);
  return st.recentChat as { actor: string; text: string; ts: number; seq: number }[];
};
// no row grouped ("cont", name hidden) under a different speaker
const groupedOk = (rows: HTMLElement[]) => rows.every((c, i) =>
  !c.classList.contains("cont") || rows[i - 1]?.dataset.author === c.dataset.author);

// Yesterday a visitor said two things, with one regular's line between them;
// today the regulars talked a lot. The window keeps both visitor lines (now
// adjacent, so the second is grouped under the first's name) and trims the
// regular's line out from between them. 200 says, text = "#<seq>".
const day: any[] = [];
{
  const t0 = Date.now() - 86_400_000;
  const speak = (actor: string) => day.push(say(day.length + 1, actor, t0 + (day.length + 1) * 30_000));
  for (let i = 0; i < 20; i++) speak(i % 2 ? "cairn" : "mythos");
  speak("visitor"); speak("cairn"); speak("visitor");
  for (let i = 0; i < 177; i++) speak(["cairn", "mythos", "apricot"][i % 3]);
}
const all = day.map((e) => e.args.text);

console.log("scrollback over a fair-trimmed window");
{
  const { logChat, logEl } = await freshChat();
  const win = windowOf(day);
  const seqs = win.map((m) => m.seq);
  let contiguousFrom = seqs[seqs.length - 1];
  while (seqs.includes(contiguousFrom - 1)) contiguousFrom--;
  check("precondition: the fold's window has a hole (visitor kept, regulars trimmed)",
    seqs.includes(21) && seqs.includes(23) && !seqs.includes(22) && contiguousFrom > 24, seqs.join(","));
  setLog(day);
  for (const m of win) logChat(m.actor, m.text, "", { seq: m.seq, ts: m.ts });
  const windowCont = logEl.querySelectorAll(".line.cont").length;

  await scrollUp(logEl);
  const afterOne = shownIn(logEl);
  check("first scroll-up brings back the newest trimmed line",
    afterOne.includes(`#${contiguousFrom - 1}`), `missing #${contiguousFrom - 1}`);
  check("…and does not leap past the hole to the beginning", !afterOne.includes("#1"), "jumped to #1");
  check("lines stay in seq order after a gap fill", isSorted(afterOne), afterOne.join(" "));

  await scrollToTop(logEl);
  const final = shownIn(logEl);
  check("scrolling to the top reaches the beginning", logEl.textContent!.includes("beginning of this world"));
  check("every say is on screen exactly once",
    final.length === all.length && new Set(final).size === all.length,
    `${final.length} shown, ${new Set(final).size} distinct, want ${all.length}`);
  check("…in world order", final.join(" ") === all.join(" "));
  check("precondition: the window had grouped lines to displace", windowCont > 0, `${windowCont}`);
  check("no grouped line sits under a different speaker", groupedOk(rowsOf(logEl)));
}

console.log("a spoken row moved by t0 does not scramble the fill");
{
  // window rows #90 #95 #100 (5s apart per seq, all recent), the rest trimmed;
  // then a live spoken #101 whose speech BEGAN before #95 — logChat slots it
  // above #95 and #100, so the screen reads 90, 101, 95, 100
  const { logChat, logEl } = await freshChat();
  const now = Date.now();
  const tsOf = (s: number) => now - (101 - s) * 5_000;
  const log = [];
  for (let s = 80; s <= 100; s++) log.push(say(s, s % 2 ? "cairn" : "mythos", tsOf(s)));
  log.push(say(101, "apricot", now));
  setLog(log);
  for (const s of [90, 95, 100]) logChat(log[s - 80].actor, `#${s}`, "", { seq: s, ts: tsOf(s) });
  logChat("apricot", "#101", "agent", { seq: 101, ts: now, spoken: true, utt: 1, t0: tsOf(93) });
  check("precondition: the spoken row sits above older rows",
    shownIn(logEl).join(" ") === "#90 #101 #95 #100", shownIn(logEl).join(" "));
  await scrollToTop(logEl);
  const rest = shownIn(logEl).filter((t) => t !== "#101");
  check("every non-spoken row is in seq order around it", isSorted(rest), shownIn(logEl).join(" "));
  check("…and all of 80–100 arrived once", rest.length === 21 && new Set(rest).size === 21, `${rest.length}`);
}

console.log("the reader's view holds still while rows land above it");
{
  // happy-dom has no layout, so give it one: every row 20px tall, stacked in
  // DOM order, the log a 200px window at viewport y=100 scrolled by scrollTop.
  // offsetTop stays 0 (as in happy-dom) — measuring with it is the bug.
  const { logChat, logEl } = await freshChat();
  let scroll = 0;
  Object.defineProperty(logEl, "scrollTop", { get: () => scroll, set: (v) => { scroll = v; }, configurable: true });
  const LOG_TOP = 100, ROW = 20;
  // and a height: happy-dom's 0/0 would read as "following the bottom"
  Object.defineProperty(logEl, "scrollHeight", { get: () => logEl.children.length * ROW, configurable: true });
  Object.defineProperty(logEl, "clientHeight", { get: () => 200, configurable: true });
  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this === logEl) return { top: LOG_TOP, bottom: LOG_TOP + 200, height: 200 } as DOMRect;
    if (this.parentElement === logEl) {
      const i = [...logEl.children].indexOf(this);
      const top = LOG_TOP + i * ROW - scroll;
      return { top, bottom: top + ROW, height: ROW } as DOMRect;
    }
    return realRect.call(this);
  };
  try {
    const win = windowOf(day);
    setLog(day);
    for (const m of win) logChat(m.actor, m.text, "", { seq: m.seq, ts: m.ts });
    // scrolled a little: rows #21 and #23 are above the view, the reader is
    // looking at the third row; the first page lands between #23 and it
    scroll = 50;
    const reading = rowsOf(logEl)[2];
    const was = reading.getBoundingClientRect().top;
    await scrollUp(logEl);
    const added = shownIn(logEl).length - win.length;
    check("precondition: the fill landed above the row being read",
      added > 0 && [...logEl.children].indexOf(reading) > 2, `${added} added`);
    check("the row being read did not move on screen",
      reading.getBoundingClientRect().top === was, `${was} → ${reading.getBoundingClientRect().top}`);
  } finally { Element.prototype.getBoundingClientRect = realRect; }
}

console.log("a reconnect's new window does not leave a hole");
{
  // the reader scrolled all the way back, the socket dropped after #200, and
  // 60 more says happened before the re-join. The new window is trimmed the
  // same fair way, so some of #201–#260 are not in it.
  const { logChat, logEl, resyncChatAfter } = await freshChat();
  setLog(day);
  for (const m of windowOf(day)) logChat(m.actor, m.text, "", { seq: m.seq, ts: m.ts });
  await scrollToTop(logEl);
  const later = [...day];
  const t1 = Date.now();
  for (let s = 201; s <= 260; s++) later.push(say(s, s % 4 ? "cairn" : "visitor2", t1 + s * 1000));
  setLog(later);
  const win2 = windowOf(later);
  const missing = later.filter((e) => e.seq > 200 && !win2.some((m) => m.seq === e.seq)).length;
  check("precondition: the re-join window misses some of what was said", missing > 0, `${missing}`);
  // what net.js does on a re-join: resync from the last delivered seq, then
  // the realizer replays the new window (order between them is not promised)
  const pending = resyncChatAfter(200);
  for (const m of win2) logChat(m.actor, m.text, "", { seq: m.seq, ts: m.ts });
  await pending; await settle();
  const final = shownIn(logEl);
  const want = later.map((e) => e.args.text);
  check("every say, old and new, is on screen exactly once",
    final.length === want.length && new Set(final).size === want.length, `${final.length} of ${want.length}`);
  check("…in world order", final.join(" ") === want.join(" "));
  check("a first join (nothing on screen) resyncs nothing", await (async () => {
    const { logEl: el2, resyncChatAfter: r2 } = await freshChat();
    await r2(5); await settle();
    return shownIn(el2).length === 0;
  })());
}

console.log("lines the log trimmed off the top come back when paging");
{
  // 600 says arrive live (#601–#1200); the log keeps 400 rows, so #601–#800
  // are trimmed from the top. They are history now, not "already shown":
  // scrolling up must page them back in, in order, between #600 and #801.
  // A visitor spoke once at #650; the fair window keeps that line, so a
  // re-join's window replay offers #650 again after it was trimmed.
  const { logChat, logEl } = await freshChat();
  const t0 = Date.now() - 3_600_000;
  const log: any[] = [];
  for (let s = 1; s <= 1200; s++) log.push(say(s, s === 650 ? "visitor" : s % 2 ? "cairn" : "mythos", t0 + s * 1000));
  setLog(log);
  for (const e of log.slice(600)) logChat(e.actor, e.args.text, "", { seq: e.seq, ts: e.ts });
  check("precondition: the log trimmed to #801–#1200", shownIn(logEl)[0] === "#801" && rowsOf(logEl).length === 400,
    `${shownIn(logEl)[0]}, ${rowsOf(logEl).length} rows`);
  const win = windowOf(log);
  check("precondition: the re-join window holds the trimmed #650", win.some((m) => m.seq === 650));
  for (const m of win) logChat(m.actor, m.text, "", { seq: m.seq, ts: m.ts });
  check("a trimmed line replayed by a re-join window is not appended at the bottom",
    shownIn(logEl).at(-1) === "#1200" && !shownIn(logEl).includes("#650"), shownIn(logEl).slice(-3).join(" "));
  await scrollUp(logEl);
  const afterOne = shownIn(logEl);
  check("the first scroll-up brings back the newest trimmed line", afterOne.includes("#800"), afterOne.slice(0, 3).join(" "));
  check("…and nothing older than the trimmed lines", !afterOne.includes("#600"), afterOne.slice(0, 3).join(" "));
  await scrollToTop(logEl);
  const final = shownIn(logEl);
  const want = log.map((e) => e.args.text);
  check("every say comes back exactly once, in world order",
    final.length === want.length && final.join(" ") === want.join(" "),
    `${final.length} of ${want.length}; ${final.slice(598, 603).join(" ")}`);
}

console.log("a trim after paging does not strand the walk below a new hole");
{
  // the reader paged back to the beginning, then live talk trimmed the log
  // down to 400 again — taking the paged rows with it. The walk's cursor
  // sits at the beginning; the next scroll-up must start over from the
  // present rather than declare the world exhausted.
  const { logChat, logEl } = await freshChat();
  const t0 = Date.now() - 3_600_000;
  const log: any[] = [];
  for (let s = 1; s <= 450; s++) log.push(say(s, s % 2 ? "cairn" : "mythos", t0 + s * 1000));
  setLog(log);
  for (const e of log.slice(400)) logChat(e.actor, e.args.text, "", { seq: e.seq, ts: e.ts });
  await scrollToTop(logEl);
  check("precondition: paged to the beginning", shownIn(logEl).length === 450);
  const more: any[] = [];
  for (let s = 451; s <= 470; s++) more.push(say(s, "cairn", t0 + s * 1000));
  setLog([...log, ...more]);
  for (const e of more) logChat(e.actor, e.args.text, "", { seq: e.seq, ts: e.ts });
  check("precondition: the live lines trimmed the paged rows away", shownIn(logEl)[0] === "#71", shownIn(logEl)[0]);
  await scrollToTop(logEl);
  const final = shownIn(logEl);
  check("scrolling up again refills them, once each, in order",
    final.length === 470 && isSorted(final) && final[0] === "#1", `${final.length}, first ${final[0]}`);
}

console.log("a reader following the bottom keeps following through a re-join fill");
{
  // the same fixed layout as above, with scrollHeight/clientHeight and a
  // browser's clamping: a 60-row view (1200px) over 20px rows. The reader is
  // at the end when the socket drops; the re-join's resync lands rows BELOW
  // the first visible row, which the pin holds still — pushing the newest
  // lines below the fold. A reader who was following must still be.
  const { logChat, logEl, resyncChatAfter } = await freshChat();
  const LOG_TOP = 100, ROW = 20, VIEW = 1200;
  const height = () => logEl.children.length * ROW;
  let scroll = 0;
  Object.defineProperty(logEl, "scrollTop", { get: () => scroll,
    set: (v) => { scroll = Math.max(0, Math.min(v, height() - VIEW)); }, configurable: true });
  Object.defineProperty(logEl, "scrollHeight", { get: height, configurable: true });
  Object.defineProperty(logEl, "clientHeight", { get: () => VIEW, configurable: true });
  const realRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this === logEl) return { top: LOG_TOP, bottom: LOG_TOP + VIEW, height: VIEW } as DOMRect;
    if (this.parentElement === logEl) {
      const i = [...logEl.children].indexOf(this);
      const top = LOG_TOP + i * ROW - scroll;
      return { top, bottom: top + ROW, height: ROW } as DOMRect;
    }
    return realRect.call(this);
  };
  try {
    const t0 = Date.now() - 3_600_000;
    const log: any[] = [];
    for (let s = 1; s <= 300; s++) log.push(say(s, s % 2 ? "cairn" : "mythos", t0 + s * 1000));
    setLog(log);
    for (const e of log.slice(0, 200)) logChat(e.actor, e.args.text, "", { seq: e.seq, ts: e.ts });
    logEl.scrollTop = 1e9;                           // clamped: the reader is at the end
    const gap = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight;
    check("precondition: the reader is at the bottom", gap() === 0, `${gap()}px`);
    await resyncChatAfter(200); await settle();
    check("precondition: the fill landed below the view", shownIn(logEl).length === 300, `${shownIn(logEl).length}`);
    check("the reader is still at the bottom after the fill", gap() < 1, `${gap()}px above the end`);

    // …and a reader who had scrolled away is NOT yanked down
    const { logChat: lc2, logEl: el2, resyncChatAfter: r2 } = await freshChat();
    let scroll2 = 0;
    const h2 = () => el2.children.length * ROW;
    Object.defineProperty(el2, "scrollTop", { get: () => scroll2,
      set: (v) => { scroll2 = Math.max(0, Math.min(v, h2() - VIEW)); }, configurable: true });
    Object.defineProperty(el2, "scrollHeight", { get: h2, configurable: true });
    Object.defineProperty(el2, "clientHeight", { get: () => VIEW, configurable: true });
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === el2) return { top: LOG_TOP, bottom: LOG_TOP + VIEW, height: VIEW } as DOMRect;
      if (this.parentElement === el2) {
        const i = [...el2.children].indexOf(this);
        const top = LOG_TOP + i * ROW - scroll2;
        return { top, bottom: top + ROW, height: ROW } as DOMRect;
      }
      return realRect.call(this);
    };
    for (const e of log.slice(0, 200)) lc2(e.actor, e.args.text, "", { seq: e.seq, ts: e.ts });
    scroll2 = 1000;                                  // reading mid-log
    const reading = rowsOf(el2).find((c) => c.getBoundingClientRect().bottom > LOG_TOP)!;
    const was = reading.getBoundingClientRect().top;
    await r2(200); await settle();
    check("a reader scrolled up stays on the row they were reading",
      reading.getBoundingClientRect().top === was && scroll2 === 1000, `${was} → ${reading.getBoundingClientRect().top}`);
  } finally { Element.prototype.getBoundingClientRect = realRect; }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
