// capnotice — one persistent, dismissible card when this browser is on a reduced
// path. Toasts fade in seconds; a capability is for the whole visit.
import { backendName } from './core.js';
import { bus } from './base.js';
import { getFrame } from './frames.js';
import { takeGpuRecovered } from './gpulost.js';

const LS = 'ew-capnotice-dismissed';
export const AUTO_MS = 30000;
export const WEBGL = {
  title: 'Running on WebGL 2',
  body: 'This browser is using its WebGL 2 backend instead of WebGPU — usually a phone, an older browser, or VR on a browser without WebGPU flags. ' +
        'The world may render a little differently. Chrome or Edge 113+, or Firefox with WebGPU enabled, get the full version.',
};

let card = null;
let setAnchor = null;   // the matchMedia handler, live only while a card exists
let unwatch = null;     // its teardown, run when the last item is dismissed
let placeTop = null;    // top-centre, over everything (owner, 09-27)
function dismissed() { try { return new Set(JSON.parse(localStorage.getItem(LS) || '[]')); } catch { return new Set(); } }

// a card that is the ONLY explanation for a dead canvas can't be silenced for good (review 12a L1): the page stopped
// reloading and draws nothing, so a remembered 'don't show again' would leave it black and unexplained
const ESSENTIAL = new Set(['gpu-stop']);
function show(key, title, body) {
  const seen = dismissed();
  if (seen.has(key) && !ESSENTIAL.has(key)) return;
  if (!card) {
    card = document.createElement('div'); card.className = 'panel capnotice';
    // DECLARE THE ANCHOR, driven by the SAME breakpoint the stylesheet uses. The card
    // is right-anchored (`right:10px`) above 900px and STRETCHED below it (`left:50px;
    // right:8px`), and computed style cannot tell those apart — both report used
    // pixels. matchMedia keeps ONE condition rather than a second copy of the number,
    // so index.html stays the source of truth for where the breakpoint is.
    const mq = matchMedia('(max-width: 900px)');
    // GUARD, AND A TEARDOWN. `setAnchor` closes over the module-level `card`, which
    // close() sets to null when the last item goes — so a viewport crossing after a
    // dismissal threw `Cannot read properties of null (reading 'dataset')` in the live
    // page (agent review round 1; reproduced in Chromium: show at 1280, dismiss, 700).
    // The subscription also outlived its card — every show() built a fresh one and
    // subscribed again, leaking one listener per show/dismiss cycle.
    setAnchor = () => { if (card) card.dataset.anchor = mq.matches ? 'stretch' : 'right'; };

    // ONE DIRECTION, by the owner's rule (15:04): "Compute emote bar first relative to
    // the dock. capnotice lands under the emote bar (or just over it, tbh, because you
    // can dismiss it)."
    //
    // This replaces a CYCLE. An earlier attempt computed the card's top from every
    // obstacle above it, the bar included — while emotebar.js's roomFor() computes the
    // bar's width from every obstacle in its band, the card included. Each fed the
    // other: 361 on one run, 95 on the next, no stable answer.
    //
    // emotebar.js had already written down what moving the card into that band would
    // do: "clearRight becomes ~innerWidth and room goes negative (measured -6, which
    // fed snapTo a negative width and reflowed the 9-across bar to a 48x350 column)."
    // That is exactly what reached a phone — nine tiles in one 48px column down the
    // right edge. The card is now removed from that list and placed SECOND instead.
    // TOP-CENTRE, OVER EVERYTHING, UNTIL DISMISSED (owner, 09-27). This used to measure the rail, the emote bar and
    // every frame button in its span and drop below them (#185 B2: 'dismissibility is not reachability'). With the
    // layouts people actually build, the card wandered: mid-screen over the body, half across a panel. The owner's
    // rule replaces it: a notice with a visible, clickable dismiss button may cover anything until it's dismissed, and
    // each item also dismisses itself for this visit after AUTO_MS (paused while the pointer is on it), so nothing
    // stays covered for long even if nobody clicks. boot-check tests exactly that rule.
    placeTop = () => { if (card) card.style.top = '8px'; };
    document.body.appendChild(card);   // IN THE DOM BEFORE THE FIRST MEASURE: a detached card's rect is all zeros, every occupant test misses, and the card is born over the emote bar (pre-review B1)
    const repaint = () => { setAnchor(); placeTop(); };
    repaint();
    mq.addEventListener('change', repaint);
    addEventListener('resize', repaint);
    addEventListener('dockmoved', repaint);
    unwatch = () => {
      mq.removeEventListener('change', repaint); removeEventListener('resize', repaint);
      removeEventListener('dockmoved', repaint);
      setAnchor = null; placeTop = null; unwatch = null;
    };
  }
  if (card.querySelector(`[data-key="${CSS.escape(key)}"]`)) return;
  const item = document.createElement('div');
  item.className = 'cn-item'; item.dataset.key = key;
  item.innerHTML = '<b></b><p></p><div class="cn-btns"><button class="cn-ok">got it</button><button class="cn-never">don’t show again</button></div>';
  item.querySelector('b').textContent = title;
  item.querySelector('p').textContent = body;
  let auto = 0;
  const close = () => { clearTimeout(auto); item.remove(); if (card && !card.childElementCount) { card.remove(); card = null; unwatch?.(); } };
  // the fallback: gone for this visit after AUTO_MS unless the pointer is on it (not 'don't show again')
  const arm = () => { clearTimeout(auto); auto = setTimeout(close, AUTO_MS); };
  item.addEventListener('mouseenter', () => clearTimeout(auto));
  item.addEventListener('mouseleave', arm);
  arm();
  item.querySelector('.cn-ok').onclick = close;
  if (ESSENTIAL.has(key)) item.querySelector('.cn-never').remove();
  else item.querySelector('.cn-never').onclick = () => { try { seen.add(key); localStorage.setItem(LS, JSON.stringify([...seen])); } catch {} close(); };
  card.appendChild(item);
  placeTop?.();   // the card just grew
}

export function initCapNotice() {
  if (backendName() === 'webgl') show('webgl', WEBGL.title, WEBGL.body);
  const lost = takeGpuRecovered();
  if (lost) show('gpu-recovered', 'Graphics reset', `Your GPU dropped this page's graphics (${lost}), so it reloaded you back into the world. If it keeps happening, lower the sky or render quality in video settings.`);
  bus.on('gpu-lost-stop', ({ rule } = {}) => show('gpu-stop', 'Graphics lost again', `The GPU reset again (${rule ?? 'twice in two minutes'}), so the page stopped reloading on its own. Reload when you are ready, ideally with lower sky or render quality.`));
  bus.on('sky-degraded', ({ msg } = {}) => { if (msg) show('sky', 'Sky simplified', msg); });
}
