// platecard — two quiet things beside a person's nameplate (owner, 09-30, about a mockup that put mic/ear marks ON the
// plate: "it looks messy. Maybe anyone muted near you can pop up a grayed out ear *next* to their name plate? Oh, or
// maybe hovering your cursor on their nameplate can pop that info beside their nameplate? … a little like an in-world
// tooltip").
//
// THE EAR: a person who is not hearing voices (their headphones off — `hear: false` on their presence packet,
// shared/presencewire.js) and is inside voice range of you (VOICE_SILENT_M, the rolloff's silent edge) wears grey
// crossed-out headphones beside their plate. It is avatar.js's sprite; this only decides who. Far away, nobody hears
// you anyway; a client too old to say leaves `hear` undefined and gets no ear — unknown is not "can't hear you".
//
// THE CARD: rest the pointer on a nameplate (or the head under it) for HOVER_MS and a small card opens beside the
// plate — name, presence, mic and hearing in words, distance / VR / agent, and the one per-person action the people
// column already offers (message → the DM tab, chat.js openConvo). It is DOM, projected to the plate each frame:
// crisp text at any distance, the house tokens and buttons for free, focusable, and it follows the plate while open.
// (A sprite would need its own text rendering, its own hit-testing for the button and a repaint per state change.)
// On a touch screen a TAP on a plate opens the same card; a tap elsewhere closes it. Esc closes it and goes no
// further (frames.js's Esc toggle yields to the claim). Leaving plate and card closes a hover-opened card.
// VR: the ear is a sprite and simply shows; the card is desktop/touch only and closes while presenting.
import * as THREE from 'three';
import { VOICE_SILENT_M } from './voiceconsent.js';
import { claimEscape } from './frames.js';
import { svg } from './icons.js';

export const HOVER_MS = 300;       // rest this long on a plate before the card opens
const LEAVE_MS = 250;              // grace to travel from plate to card
const EAR_EVERY_MS = 200;          // who wears an ear: re-decided at 5 Hz (the fade is per-frame, in avatar.js)
const HEAD_R = 0.14;               // metres: the head under the plate counts as the plate

let d = null;                      // injected: { camera, canvas, remotes, myPos, presenting, openConvo, colorFor }
let card = null, cardFor = null, openedBy = null, sig = '';
let ptr = null;                    // { x, y } in client px while a mouse is over the canvas, else null
let hoverId = null, hoverSince = 0, leftAt = 0, lastEar = 0;
let dismissed = null, dismissOff = 0;              // a card closed by hand (Esc, tap-out, its action) stays closed until the pointer leaves that plate
const _v = new THREE.Vector3(), _h = new THREE.Vector3();

export function initPlates(deps) {
  d = deps;
  card = document.createElement('div');
  card.id = 'platecard'; card.className = 'panel'; card.hidden = true;
  card.setAttribute('role', 'dialog');
  document.body.append(card);
  card.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-act]');
    if (!b || !cardFor) return;
    if (b.dataset.act === 'dm') { const who = cardFor; close(); d.openConvo?.(who); }
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    ptr = e.target === d.canvas && !document.pointerLockElement ? { x: e.clientX, y: e.clientY } : null;
    if (card.contains(e.target)) leftAt = 0;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { ptr = null; });
  // a TAP (touch/pen: short, still) on a plate opens its card; anywhere else but the card closes it
  let down = null;
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp, onCanvas: e.target === d.canvas };   // event time: a slow frame between down and up is not a long press
    // outside the card: close — unless it lands on a plate, whose tap (pointerup) re-aims the card instead
    if (!card.hidden && !card.contains(e.target) && !(down.onCanvas && hitAt(e.clientX, e.clientY))) close();
  }, { passive: true, capture: true });
  addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || !down) return;
    const tap = down.onCanvas && e.timeStamp - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12;
    down = null;
    if (!tap) return;
    const id = hitAt(e.clientX, e.clientY);
    if (id) open(id, 'tap');
  }, { passive: true });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) { e.preventDefault(); close(); }
  });
  claimEscape(() => (card.hidden ? null : 'platecard'));
}

/** Per frame (main.js registers it after gaze): the ear's who, the hover timer, the open card's place. */
export function updatePlates(now = performance.now()) {
  if (!d) return;
  if (now - lastEar >= EAR_EVERY_MS) { lastEar = now; decideEars(); }
  if (d.presenting()) { if (!card.hidden) close(); hoverId = null; return; }
  // hover: the same plate for HOVER_MS opens it; leaving plate AND card closes a hover-opened card
  const over = ptr ? hitAt(ptr.x, ptr.y) : null;
  if (over !== hoverId) { hoverId = over; hoverSince = now; }
  // a dismissal ends only once the pointer has been OFF that plate for a moment: a plate is a thin target, and a
  // one-frame miss (the camera breathing a few px) must not re-arm the card under a resting pointer
  if (dismissed && over === dismissed) dismissOff = 0;
  else if (dismissed && !dismissOff) dismissOff = now;
  else if (dismissed && now - dismissOff >= LEAVE_MS) { dismissed = null; dismissOff = 0; }
  if (over && over !== cardFor && over !== dismissed && now - hoverSince >= HOVER_MS && openedBy !== 'tap') open(over, 'hover');
  if (!card.hidden && openedBy === 'hover') {
    const onCard = card.matches(':hover');
    if (over === cardFor || onCard) leftAt = 0;
    else if (!leftAt) leftAt = now;
    else if (now - leftAt >= LEAVE_MS) close();
  }
  if (!card.hidden) follow();
}

function decideEars() {
  const me = d.myPos();
  for (const r of d.remotes.values()) {
    const av = r.avatar;
    if (!av?.setDeafMark || !av.root) continue;
    const near = !!me && av.root.position.distanceTo(me) <= VOICE_SILENT_M;
    av.setDeafMark(near && r.hear === false);
  }
}

// ---- where a plate is on screen ------------------------------------------------------------------------------
// The plate is a camera-facing sprite: its screen rect is its world anchor projected, sized by pixels-per-metre at
// its view depth. Returns null when it is not drawn (faded out, hidden, behind the camera).
function plateRect(av, box) {
  const lab = av?.label;
  if (!lab?.visible || lab.material.opacity < 0.1) return null;
  const cam = d.camera, W = d.canvas.clientWidth, H = d.canvas.clientHeight;
  lab.getWorldPosition(_v);
  _h.copy(_v).applyMatrix4(cam.matrixWorldInverse);
  const depth = -_h.z;
  if (depth <= cam.near) return null;
  const ppm = (H / 2) / (Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * depth);
  _v.project(cam);
  const cx = box.left + (_v.x + 1) / 2 * W, cy = box.top + (1 - _v.y) / 2 * H;
  const lw = lab.scale.x;
  const hw = lw * (lab.userData.pill ?? 0.5) / 2 * ppm, hh = lw * 52 / 1024 * ppm;
  // the ear, when shown, belongs to the plate too (its right edge is where the card starts): it sits beside the pill,
  // one gap and its own width further right, at the plate's depth (avatar.js)
  const ear = av.ear?.visible ? (av.ear.position.distanceTo(lab.position) + av.ear.scale.x / 2) * ppm - hw : 0;
  let head = null;
  if (av.head) {
    av.head.getWorldPosition(_v);
    _h.copy(_v).applyMatrix4(cam.matrixWorldInverse);
    if (-_h.z > cam.near) { _v.project(cam); head = _rectHead; head.x = box.left + (_v.x + 1) / 2 * W; head.y = box.top + (1 - _v.y) / 2 * H; head.r = HEAD_R * ppm; }
  }
  const o = _rect;
  o.l = cx - hw; o.r = cx + hw + Math.max(0, ear); o.t = cy - hh; o.b = cy + hh; o.cx = cx; o.cy = cy; o.depth = depth; o.head = head;
  return o;
}
// plateRect's answer, reused: it runs per remote on every pointer move and every frame the card follows, and every
// caller reads it before the next call
const _rect = { l: 0, r: 0, t: 0, b: 0, cx: 0, cy: 0, depth: 0, head: null }, _rectHead = { x: 0, y: 0, r: 0 };

function hitAt(x, y) {
  let best = null, bestDepth = Infinity;
  const box = d.canvas.getBoundingClientRect();
  for (const r of d.remotes.values()) {
    const p = plateRect(r.avatar, box);
    if (!p) continue;
    const onPlate = x >= p.l - 3 && x <= p.r + 3 && y >= p.t - 4 && y <= p.b + 4;   // a little slack: the plate is thin
    const onHead = p.head && Math.hypot(x - p.head.x, y - p.head.y) <= p.head.r;
    if ((onPlate || onHead) && p.depth < bestDepth) { best = r.id; bestDepth = p.depth; }
  }
  return best;
}

// ---- the card --------------------------------------------------------------------------------------------------
function open(id, how) {
  if (!d.remotes.get(id)) return;
  cardFor = id; openedBy = how; leftAt = 0; sig = '';
  card.hidden = false;
  card.dataset.for = id;
  paint();
  follow();
}
export function close() {
  if (!card || card.hidden) return;
  dismissed = cardFor; dismissOff = 0;
  card.hidden = true; cardFor = null; openedBy = null; sig = '';
  delete card.dataset.for;
}

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function paint() {
  const r = d.remotes.get(cardFor);
  if (!r) return;
  const me = d.myPos();
  const dist = me && r.avatar?.root ? r.avatar.root.position.distanceTo(me) : null;
  const near = dist != null && dist <= VOICE_SILENT_M;
  const pres = r.presence ?? 'present';
  const known = typeof r.mic === 'boolean' || typeof r.hear === 'boolean';
  const s = [pres, r.mic, r.hear, near, dist == null ? '' : Math.round(dist), !!r.xrOn, !!r.agent].join('|');
  if (s === sig) return;
  sig = s;
  const rows = [];
  if (known) {
    rows.push(`<div class="pc-row" data-k="mic" data-on="${r.mic === true}">${svg(r.mic === true ? 'mic' : 'micOff', 14)}<span>${
      r.mic === true ? 'mic on' : r.mic === false ? 'mic off' : 'mic: not shared'}</span></div>`);
    rows.push(`<div class="pc-row" data-k="hear" data-on="${r.hear === true}">${svg(r.hear === false ? 'headphonesOff' : 'headphones', 14)}<span>${
      r.hear === true ? 'hearing voices' : r.hear === false ? (near ? 'voices off — can’t hear you' : 'voices off') : 'hearing: not shared'}</span></div>`);
  } else {
    rows.push(`<div class="pc-row" data-k="voice"><span>voice state not shared</span></div>`);
  }
  // the header's right end: what kind of body and how far — 'present' is the default and says nothing, so only away /
  // busy are named, in their presence colour, after the name
  const where = [r.agent ? 'agent' : null, r.xrOn ? 'in VR' : null,
    dist == null ? null : `${dist < 10 ? dist.toFixed(1) : Math.round(dist)} m`].filter(Boolean).join(' · ');
  card.innerHTML = `<div class="pc-head"><span class="pc-dot" style="background:${esc(d.colorFor?.(r.id) ?? 'var(--brand)')}"></span>`
    + `<b class="pc-name">${esc(r.id)}</b>`
    + (pres !== 'present' ? `<span class="pc-pres" data-presence="${esc(pres)}">${esc(pres)}</span>` : '')
    + (where ? `<span class="pc-where">${esc(where)}</span>` : '') + `</div>`
    + rows.join('')
    + `<div class="pc-btns"><button type="button" data-act="dm">message</button></div>`;
  card.setAttribute('aria-label', `${r.id} — voice and actions`);
}

function follow() {
  const r = d.remotes.get(cardFor);
  const p = r && plateRect(r.avatar, d.canvas.getBoundingClientRect());
  if (!p) { close(); return; }
  paint();
  const W = innerWidth, H = innerHeight, M = 8, GAP = 10;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let x, y = p.cy - ch / 2, side;
  if (p.r + GAP + cw <= W - M) { x = p.r + GAP; side = 'right'; }
  else if (p.l - GAP - cw >= M) { x = p.l - GAP - cw; side = 'left'; }
  else {   // a phone: neither side has room — under the plate, centred on it
    x = Math.min(Math.max(M, p.cx - cw / 2), W - M - cw);
    y = p.b + GAP; side = 'below';
  }
  y = Math.min(Math.max(M, y), H - M - ch);
  card.style.left = `${Math.round(x)}px`;
  card.style.top = `${Math.round(y)}px`;
  card.dataset.side = side;
}

/** For probes: where the card is and for whom, without reaching into module state. */
export const plateCardState = () => ({ open: !!card && !card.hidden, for: cardFor, by: openedBy });
