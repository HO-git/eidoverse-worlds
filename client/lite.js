// lite.js — the entry point for a device that cannot hold the world.
//
// Why a separate entry point and not a flag: main.js statically imports
// { THREE, scene, camera, renderer } at its line 10, and index.html modulepreloads
// three.webgpu and three-vrm besides. Static imports and preloads are fetched and
// parsed before any of our code gets a say, so a runtime `if (lite)` would render
// nothing and still pay the whole ~2.1MB on a phone. The choice is made in the HTML,
// ahead of the module graph; see the decision script there.
//
// What this is: chat, the emote row, and who's here. No scene, no camera, no renderer,
// no bodies. You can talk to people in the eidoverse from a phone that cannot draw it.
//
// What it is NOT: a viewer. There is deliberately no canvas.
//
// It runs the REAL net.js. The wire protocol is not forked — net.js takes its
// participant registry, asset ledger and snapshot renderer by injection now, so this
// file supplies renderer-free ones and the protocol has exactly one implementation.
import { CONFIG, bus, report, setToken } from './lib/base.js';
// NOT ui.js. That module is the DESKTOP shell: since #185 it imports videopanel.js and
// profile.js, which reach the engine through core.js, mybody.js and colliders.js, and it
// owns the settings sections and world panels besides. None of that belongs on a phone
// that cannot draw a world, so lite builds its surface from the primitives that are
// actually renderer-free. Sharing ui.js would mean gutting it; this costs less and
// leaves the desktop shell untouched.
import { makeFrame } from './lib/frames.js';
import { initChat, logChat } from './lib/chat.js';
import {
  net, connect, initIdentity, wireNet, sendVerb, sendWhisper, sendTyping, sendPoseExact,
  loginUrl,
} from './lib/net.js';
import { initBoot, markPhase, finishBoot } from './lib/boot.js';
import * as participants from './lib/participants_lite.js';
import { initLiteEmotes } from './lib/emotebar_lite.js';
// Turns live world entries into chat lines — including your own 'say' coming back from
// the server. Without it a lite client could SEND a message and never see it: the text
// only appeared on reload, when history replayed through social.js instead. It is the
// same narrator the full client uses, which is why it also reports builds and grants.
import { initCauses } from './lib/realize/causes.js';
import { initRecentChat } from './lib/realize/recentchat.js';

// The boot watchdog in index.html fails the splash after 20s unless __ewEngineUp is
// set, and core.js only sets it after renderer.init(). There is no renderer here and
// never will be, so we claim the flag ourselves. What the watchdog actually guards
// against still works: if this module never runs, nothing sets it.
globalThis.__ewEngineUp = true;

// Why this session is lite, decided in index.html. 'crash' is the one that has to SAY
// so: being silently demoted after your browser died, with no explanation and no way
// back, is worse than the crash was.
const WHY = globalThis.__ewLiteWhy ?? 'url';
const WHY_TEXT = {
  crash: "last time this device opened the full world it didn't come back \u2014 this is the light version",
  ram: 'this device reports too little memory for the full world \u2014 this is the light version',
  'no-gpu': 'this browser has no 3D support \u2014 this is the light version',
  saved: 'lite mode \u2014 chat, emotes, and who\u2019s here',
  url: 'lite mode \u2014 chat, emotes, and who\u2019s here',
  default: 'lite mode \u2014 chat, emotes, and who\u2019s here',
};

/** The way out. A URL and not a saved preference on purpose: ?lite=0 is rule (1) in the
 *  decision script, so it wins for THIS load only. If the full client dies again, the
 *  tripwire it arms sends the next plain visit straight back here — one attempt, not a
 *  loop, and the escape stays a link the person can keep. */
export function tryFullWorld() {
  try { localStorage.removeItem('ew-lite'); } catch { /* nothing to clear */ }
  const u = new URL(location.href);
  u.searchParams.set('lite', '0');
  location.assign(u);
}

/** Stay here and stop asking. Saved, because this one IS a preference — and a proven
 *  crash still overrides it, which is what keeps a saved 'full' from being a trap. */
export function stayLite() {
  try { localStorage.setItem('ew-lite', '1'); } catch { /* best effort */ }
}

// A lite client still ARRIVES: the server announces it and everyone else builds a body
// for it, whether or not we ever say where that body is. So the choice was never "appear
// or not" - it is "appear as the resident the world remembers, or as a default".
//
// THE RESTORE IS HELD VERBATIM AND SENT BACK VERBATIM. It is the server's own settled
// pose for this body - position, facing, clip, pitch, wings, held bones, pins, and
// anything added to that vocabulary later. A pose is the resident's WHOLE public body,
// not a delta, so re-composing one from what this client happens to know is how a wave
// stood someone up out of a sit, unfolded their wings and dropped their held pose
// (#188 B2). We add the one-shot and change nothing else.
//
// An emote is not a verb, either: the verb set is closed by design, and asking for one
// earns "verb not allowed: emote". It rides the presence pose, which is why a client
// with no body still has to have something to say about where that body is.
let restored = null;

/** The body the world remembers. Before any restore lands - a first-ever visit - the
 *  origin is all we can honestly claim, and sanePose() requires a finite `p`. */
const rememberedBody = () => restored ?? { p: [0, 0, 0], yaw: 0 };

/** One emote: the remembered body, unchanged, carrying a one-shot. */
function emote(name) {
  if (!sendPoseExact({ ...rememberedBody(), emote: name })) {
    toast('not connected - emote not sent', 'warn');
  }
}

/** The roster in the shape chat.js wants for @-completion and its people pane.
 *  `dist` is always null: distance is a property of a world we are not drawing. */
function people() {
  const list = [{ id: CONFIG.name, me: true, dist: null }];
  for (const r of participants.remotes.values()) {
    list.push({ id: r.id, me: false, agent: !!r.agent, dist: null });
  }
  return list;
}

/** The few lines of ui.js that lite actually needed. Deliberately not a shared module:
 *  if this grows past a screenful it wants to BE one, and the growth is the signal. */
function toast(message, kind = 'info', ttl = 5000) {
  const host = document.getElementById('toasts') ?? document.body;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.remove(), ttl);
}

function liteDock(entries) {
  const dock = document.createElement('nav');
  dock.id = 'lite-dock';
  for (const e of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = e.id;
    b.title = e.title ?? e.id;
    // a label is shown only where the dock has room (index.html hides .ld-text on a narrow phone);
    // the banner's button is the way in that never depends on dock space
    b.innerHTML = '<span class="ld-icon"></span><span class="ld-text"></span>';
    b.querySelector('.ld-icon').textContent = e.icon ?? e.label;
    if (e.text) b.querySelector('.ld-text').textContent = ` ${e.text}`; else b.querySelector('.ld-text').remove();
    b.setAttribute('aria-label', e.title ?? e.id);
    b.addEventListener('click', e.act);
    dock.appendChild(b);
  }
  document.body.appendChild(dock);
  return dock;
}

// A DEMOTION says so where it can't scroll away. The chat line above is logged before the
// join snapshot replays the room's history, so on a busy world it is gone before anyone
// reads it — and a desktop that lands here after a hung load (the tripwire can't tell a
// reload-mid-hang from a crash) otherwise looks like it simply booted the wrong client.
// Only for the reasons we inferred; someone who ASKED for lite (url, saved) already knows.
const BANNER_TEXT = {
  crash: "Your last visit to this world didn't finish loading, so you're in the light version: chat, emotes and who's here.",
  ram: "This device reports too little memory for the full world, so you're in the light version: chat, emotes and who's here.",
  'no-gpu': "This browser has no 3D support, so you're in the light version.",
  // ASKED for lite (a link, or a saved choice) still gets the card: a saved choice outlives the memory of making
  // it, and nobody should need to know about ?lite=0 to get back (owner, 10-01: "adding a string to a URL bar?")
  saved: "You're in the light version: chat, emotes and who's here.",
  url: "You're in the light version: chat, emotes and who's here.",
};
// a reason that rules the 3D world out offers no way into it
const NO_WAY_IN = new Set(['no-gpu']);
// The same card as the full client's capability notice (capnotice.js: .panel.capnotice >
// .cn-item > b, p, .cn-btns) so the two reduced paths read as one family. Built here, not
// imported: capnotice.js pulls core.js, and core.js is the engine lite exists to avoid.
export function liteBanner(why) {
  const text = BANNER_TEXT[why];
  if (!text || document.getElementById('lite-banner')) return null;
  const card = document.createElement('div');
  card.id = 'lite-banner';
  card.className = 'panel capnotice';
  card.setAttribute('role', 'status');
  const item = document.createElement('div');
  item.className = 'cn-item';
  item.innerHTML = '<b></b><p></p><div class="cn-btns"><button type="button" class="cn-go">Enter the 3D world</button><button type="button" class="cn-ok">stay here</button></div>';
  if (NO_WAY_IN.has(why)) { item.querySelector('.cn-go').remove(); item.querySelector('.cn-ok').textContent = 'got it'; }
  else item.querySelector('.cn-go').addEventListener('click', () => tryFullWorld());
  item.querySelector('b').textContent = 'Light version';
  item.querySelector('p').textContent = text;
  let ro = null;
  item.querySelector('.cn-ok').addEventListener('click', () => { ro?.disconnect(); card.remove(); });
  card.appendChild(item);
  document.body.appendChild(card);
  // Under the emote row, never over it: that row is fixed to the top and its height
  // depends on how many emotes wrap, so follow it instead of guessing a number.
  const host = document.getElementById('lite-emote-host');
  const place = () => { card.style.top = `${Math.round((host?.getBoundingClientRect().bottom ?? 0) + 8)}px`; };
  place();
  if (host && globalThis.ResizeObserver) (ro = new ResizeObserver(place)).observe(host);
  return card;
}

/** The key door, renderer-free.
 *
 *  A key-gated world refuses an unknown visitor with close code 4003, and net.js turns
 *  that into `bad-key`. The full client answers it by reopening openDoor - which lives in
 *  ui.js, needs a roster of avatars to show, and arrives with the engine attached. None
 *  of that is available here, and "try the full world" is not a door for someone whose
 *  phone the full world kills (#188 B3). So: an input, on the page that is already up.
 *
 *  Idempotent - a refused key re-emits `bad-key`, and that should refill the same door
 *  rather than stack another. */
function keyDoor() {
  let host = document.getElementById('lite-door');
  if (host) { host.querySelector('.lite-door-msg').textContent = 'that key was refused'; return; }

  host = document.createElement('div');
  host.id = 'lite-door';
  host.innerHTML = `
    <div class="lite-door-card">
      <div class="lite-door-title">this world needs a key</div>
      <div class="lite-door-msg">enter the door key to come in</div>
      <input class="lite-door-key" type="password" autocomplete="off" spellcheck="false"
             placeholder="door key" aria-label="door key">
      <button class="lite-door-go" type="button">enter</button>
    </div>`;
  document.body.appendChild(host);

  const input = host.querySelector('.lite-door-key');
  const msg = host.querySelector('.lite-door-msg');
  const submit = () => {
    const key = input.value.trim();
    if (!key) { msg.textContent = 'a key is needed to come in'; return; }
    setToken(key);          // CONFIG.token + the 'ew-key' the early socket reads next time
    msg.textContent = 'trying that key\u2026';
    host.remove();
    connect();
  };
  host.querySelector('.lite-door-go').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  // A deployment that wants a login rather than a key already redirects through authcfg;
  // where one is offered, show it too, because a key box is no use to someone who has an
  // account instead.
  const url = loginUrl?.();
  if (url) {
    const a = document.createElement('a');
    a.className = 'lite-door-login';
    a.href = url;
    a.textContent = 'or sign in';
    host.querySelector('.lite-door-card').appendChild(a);
  }
  input.focus();
}

async function main() {
  document.documentElement.classList.add('lite');
  // The splash is static markup that only boot.js takes down, and nothing here would
  // ever have called it — a lite client would have sat on 'waking the engine' forever
  // while a perfectly good chat window waited behind it. The engine and body phases are
  // marked done because in this client they are: there is no engine to wake and no body
  // to assemble, and a progress bar must never wait on something that will not happen.
  // Wired before connect(), because the refusal it answers arrives during connect().
  bus.on('bad-key', keyDoor);

  initBoot({ world: CONFIG.world, name: CONFIG.name });
  markPhase('engine', 1);
  markPhase('body', 1);

  // The renderer-free half of the client, handed to the real protocol.
  wireNet({
    participants,
    toast,                       // net.js takes a notifier rather than importing ui.js
    // The SAME avatar the inline early socket joined with, published by index.html before
    // any of its guards. net.js adopts that socket only when the join it would send
    // matches byte for byte; asking for '' here missed, so the early socket was dropped
    // and a second one opened - the server saw arrive -> leave -> arrive, and a held
    // whisper delivered to the first socket could be marked delivered and then thrown
    // away with it (#188 B1). We cannot DRAW the avatar; that was never what this
    // answers. Everyone else draws our body, and it should be the right one.
    myAvatarPath: () => globalThis.__ewWantAvatar ?? 'claude',
    // null, both of them, and deliberately: sendPose() SAMPLES a live body and returns
    // immediately without these. There is no body here to sample. The one pose this
    // client ever emits goes through sendPoseExact, which re-asserts what the server
    // already remembers instead of composing something new.
    me: () => null,
    myState: null,
    onRestore: (r) => { restored = r; },   // held whole; see rememberedBody()
  });

  await initIdentity();

  // EVERY CONSUMER OF SOCKET TRAFFIC IS BUILT BEFORE connect().
  //
  // This used to run the other way round and it lost messages. The early socket is
  // adopted inside connect(), which then drains what raced ahead of us - the join
  // snapshot, and any whisper the server held for us while we were away. The server
  // deletes its pending copy the moment it sends one. So a chat window that did not
  // exist yet meant logWhisper() threw inside the drain, connect() reported it and
  // carried on, and a private message that was successfully delivered was gone for
  // good (#188 round two). main.js has always had this order - initChat at module
  // scope, connect() later - and the reason is exactly this.
  //
  // The rule, stated so it is not re-learned: anything that can receive buffered
  // arrival traffic is installed here, above the connect, with no await between.
  initChat({
    send: (text) => sendVerb('say', { text }),
    whisper: sendWhisper,
    typing: (to) => sendTyping(to),   // no local avatar to show typing on
    people,
  });
  initCauses();        // live entries -> chat lines (says, builds, grants)
  initRecentChat();    // the room's history, replayed out of the join snapshot

  // Chrome. None of it consumes socket traffic, but it costs nothing to have it
  // standing before the first message lands either.
  const emoteHost = document.createElement('div');
  emoteHost.id = 'lite-emote-host';
  document.body.appendChild(emoteHost);
  initLiteEmotes(emoteHost, emote);
  liteDock([
    { id: 'full', label: '\u{1F30D}', icon: '\u{1F30D}', text: '3D world', title: 'enter the full 3D world', act: tryFullWorld },
  ]);
  globalThis.__ewTryFullWorld = tryFullWorld;   // also reachable from the console

  logChat('', WHY_TEXT[WHY] ?? WHY_TEXT.default, 'sys');
  liteBanner(WHY);

  // No door screen: openDoor lives in ui.js, and the door's job (pick a body, see who is
  // here before you commit) is mostly about a world this client does not render, so a
  // lite arrival steps straight in. A world that wants a KEY is handled - keyDoor() above
  // answers `bad-key` - and a deployment that wants a login redirects through authcfg.
  markPhase('connect', 1);
  await connect();
  markPhase('world', 1);
  finishBoot('lite');
  bus.emit('roster');
}

main().catch((e) => {
  report?.('lite boot', e);
  toast(`lite boot failed: ${e.message}`, 'err');
});
