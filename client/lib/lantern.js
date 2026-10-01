// lantern — one line for everything: type to talk, `/` for commands, or a word
// ("sky", "wave", "mute") for the matching ACTIONS, with their keys shown so the
// keys teach themselves. Direction C of the HUD redesign mockups (the "lantern" direction).
//
// Additive: Ctrl/Cmd+K or the resting line bottom-centre opens it; Enter-to-chat is
// untouched. It owns no knowledge of what can be done — that is lib/actions.js,
// filled at each definition site — and no send path: plain text and /commands go
// through the chat compose box's own submit (chat.submit), so there is one path.
//
// THE KEYS (R, 09-29): Enter SAYS what you typed — always; the say row is first.
// Tab DOES the highlighted action (default: the best match, wearing a Tab badge).
// So "sit"+Enter says "sit", "sit"+Tab sits. Two exceptions to Enter-says: text
// starting with "/" (the command path), and a highlight the person MOVED themselves
// (↑/↓ or the mouse onto a row) — then Enter runs that row.
import { list, grouped } from './actions.js';
import { svg, has, rsvg, hasLine, fsvg, hasFill } from './icons.js';

const SEEN_LS = 'ew-lantern-seen';
const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');
export const CHORD = isMac ? '⌘K' : 'Ctrl K';   // the rail's search entry shows it too (ui.js)

let root = null, input = null, listEl = null, pill = null;
let rows = [];        // what is on screen, selectable, in display order
let sel = 0;
let best = -1;        // the default highlight for this query (the best action row); -1: nothing to do
let moved = false;    // the person moved the highlight themselves: Enter runs it
let prevFocus = null; // what had focus when it opened: closing hands it back
let deps = { submit: () => {}, whisperTarget: () => null };

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const isLanternOpen = () => !!root && !root.hidden;

export function openLantern(text = '') {
  if (!root) return;
  if (root.hidden) prevFocus = document.activeElement;
  place();
  root.hidden = false;
  pill?.classList.add('open');
  document.body.classList.add('lantern-open');   // the hint bar shares the bottom band (index.html)
  input.value = text;
  render.lastQ = null;
  render();
  input.focus();
  try { localStorage.setItem(SEEN_LS, '1'); } catch { /* private mode */ }
  if (pill?.classList.contains('fresh')) { pill.classList.remove('fresh'); paintPill(); }
  dispatchEvent(new CustomEvent('lantern'));   // the rail's search entry lights with it (ui.js)
}

export function closeLantern() {
  if (!root || root.hidden) return;
  root.hidden = true;
  pill?.classList.remove('open');
  document.body.classList.remove('lantern-open');
  // only while the line still holds focus (a click that moved it elsewhere keeps it there), and only to
  // a field someone was typing in (the chat line): a focused button — the pill, the rail's search entry —
  // would take the next Enter or Space as its own click instead of letting it reach the world's keys
  if (document.activeElement === input) {
    if (prevFocus?.isConnected && prevFocus !== input && prevFocus.matches?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) prevFocus.focus();
    else input.blur();
  }
  prevFocus = null;
  dispatchEvent(new CustomEvent('lantern'));
}

// ---------------------------------------------------------------- rows

// icon: an icons.js name (line weight first — the mockup's rows are line glyphs), an
// emoji literal (emotes, as their tiles wear them), or a neutral dot
function iconHtml(icon) {
  if (icon && hasLine(icon)) return rsvg(icon, 16);
  if (icon && has(icon)) return svg(icon, 16);
  if (icon && hasFill(icon)) return fsvg(icon, 16);
  if (icon && /[^\x00-\x7f]/.test(icon)) return `<span class="ln-emo">${esc(icon)}</span>`;
  return '<span class="ln-dot"></span>';
}

// a command's help line "/w <name> <message> — whisper, privately" reads as
// title "whisper, privately", detail "<name> <message>", badge "/w"
function commandRow(a) {
  const help = String(a.detail ?? '');
  const m = help.match(/^\/\S+\s*(.*?)\s+—\s+(.*)$/);
  const args = m ? m[1] : '';
  const what = m ? m[2] : help;
  return { title: what || a.title, sub: args, badge: a.title };
}

function build(q) {
  const out = [];   // [{ group|null, rows: [{ kind, title, sub?, badge?, icon?, action? }] }]
  if (q.startsWith('/')) {
    // the existing command path, verbatim; matching commands below it as a reminder of what exists
    out.push({ group: null, rows: [{ kind: 'raw', title: `run ${q}`, icon: 'chat-circle' }] });
    const word = q.slice(1).split(/\s+/)[0];
    const cmds = list(word).filter((r) => r.action.group === 'commands' && r.action.title.startsWith(`/${word}`));
    if (cmds.length) out.push({ group: 'commands', rows: cmds.map(toRow) });
    return out;
  }
  const results = list(q, { limit: q ? 30 : 200 });
  const groups = grouped(results).map(({ group, rows: rs }) => ({ group, rows: rs.map(toRow) }));
  if (!q) return groups;
  const to = deps.whisperTarget?.();
  const say = { group: null, rows: [{ kind: 'say', title: to ? `whisper “${q}” to ${to}` : `say “${q}” in chat`, icon: 'chat-circle' }] };
  return [say, ...groups];   // speech first, always: Enter says it
}
function toRow({ action: a }) {
  if (a.group === 'commands') return { kind: 'action', action: a, icon: a.icon, ...commandRow(a) };
  return { kind: 'action', action: a, title: a.title, sub: a.detail ?? '', badge: a.key ?? '', icon: a.icon };
}

// the typed text lit inside the title, where the title starts with it or a word does
function lit(title, q) {
  const t = String(title);
  if (!q || q.startsWith('/')) return esc(t);
  const i = t.toLowerCase().search(new RegExp(`(^|[\\s/·(-])${q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (i < 0) return esc(t);
  const s = i === 0 && t.toLowerCase().startsWith(q.toLowerCase()) ? 0 : i + 1;
  return `${esc(t.slice(0, s))}<u>${esc(t.slice(s, s + q.length))}</u>${esc(t.slice(s + q.length))}`;
}

function rowHtml(r, i, q) {
  const on = i === sel;
  // the badge that says what Enter / Tab will do on THIS row, right now
  let act = '';
  if (r.kind === 'say') act = moved ? '' : 'Enter';
  else if (r.kind === 'raw') act = on ? 'Enter' : '';
  else if (on) act = moved || q.startsWith('/') ? 'Enter' : 'Tab';
  const keys = (r.badge ? `<kbd class="ln-key">${esc(r.badge)}</kbd>` : '')
    + (act ? `<kbd class="ln-do">${act}</kbd>` : '');
  return `<div class="ln-row ${r.kind}${on ? ' sel' : ''}" role="option" data-i="${i}"${on ? ' aria-selected="true"' : ''}`
    + ` data-title="${esc(r.action?.title ?? r.title)}">`
    + `<span class="ln-ic">${iconHtml(r.icon)}</span>`
    + `<span class="ln-name"><span class="ln-title">${r.kind === 'action' ? lit(r.title, q) : esc(r.title)}</span>`
    + `${r.sub ? `<em class="ln-sub">${esc(r.sub)}</em>` : ''}</span>`
    + `<span class="ln-keys">${keys}</span></div>`;
}

function render() {
  const q = input.value.trim();
  const groups = build(q);
  rows = groups.flatMap((g) => g.rows);
  if (q !== render.lastQ) {
    // a new query resets the highlight to the best ACTION (not the say row: Enter already says it)
    moved = false;
    best = rows.findIndex((r) => r.kind === 'action' || r.kind === 'raw');
    sel = Math.max(0, best);
  }
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  render.lastQ = q;
  let i = 0, html = '';
  for (const g of groups) {
    if (g.group) html += `<div class="ln-group">${esc(g.group)}</div>`;
    for (const r of g.rows) html += rowHtml(r, i++, q);
  }
  listEl.innerHTML = html || '<div class="ln-empty">nothing to do by that name</div>';
  listEl.querySelector('.ln-row.sel')?.scrollIntoView({ block: 'nearest' });
}

function select(i, byPerson) {
  if (!rows.length) return;
  sel = (i + rows.length) % rows.length;
  if (byPerson) moved = sel !== best || moved;
  const q = input.value.trim();
  // repaint only the rows (badges move with the highlight)
  for (const el of listEl.querySelectorAll('.ln-row')) {
    const n = Number(el.dataset.i);
    el.outerHTML = rowHtml(rows[n], n, q);
  }
  listEl.querySelector('.ln-row.sel')?.scrollIntoView({ block: 'nearest' });
}

function runRow(r) {
  const q = input.value.trim();
  if (!r) return;
  if (r.kind === 'raw' || r.kind === 'say') { if (q) { closeLantern(); deps.submit(q); } return; }
  const a = r.action;
  if (typeof a.fill === 'string' && typeof a.run !== 'function') {   // a command that needs its argument: keep typing
    input.value = a.fill; render(); input.focus(); return;
  }
  closeLantern();
  try { a.run(); } catch (e) { console.error(`[lantern] ${a.id} failed`, e); }
}

function onEnter() {
  const q = input.value.trim();
  if (q.startsWith('/') || moved || !q) { if (moved || q) runRow(rows[sel]); return; }
  closeLantern(); deps.submit(q);   // Enter says it
}

// ---------------------------------------------------------------- placement
// One horizontal axis for the resting line, the hint bar that borrows its spot,
// and the open panel: the viewport's centre, unless that would sit on the chat
// frame's compose box — then the centre of the free span beside the frame.
let lastX = null;
function place() {
  if (!root || innerWidth <= 600) { if (lastX !== null) { document.documentElement.style.removeProperty('--ln-x'); lastX = null; } return; }
  let x = innerWidth / 2;
  const line = document.getElementById('chatline');
  const frame = line?.closest('.frame');
  // (frames are position:fixed, so offsetParent can't say whether one shows; its computed display can)
  const c = line && frame && getComputedStyle(frame).display !== 'none' ? line.closest('.chat-compose')?.getBoundingClientRect() : null;
  if (c && c.width > 0 && c.top < innerHeight) {
    const half = Math.max(pill?.offsetWidth ?? 0, root.hidden ? 0 : root.offsetWidth, Math.min(580, innerWidth - 24)) / 2;
    const lo = x - half - 12, hi = x + half + 12;
    if (hi > c.left && lo < c.right) {
      // free span to the right or left of the compose box; take the wider one
      const right = [c.right + 12, innerWidth - 12], left = [12, c.left - 12];
      const span = right[1] - right[0] >= left[1] - left[0] ? right : left;
      x = Math.round((span[0] + span[1]) / 2);
    }
  }
  x = Math.round(x);
  if (x !== lastX) { document.documentElement.style.setProperty('--ln-x', `${x}px`); lastX = x; }
}

// ---------------------------------------------------------------- boot

const EMARK = () => document.querySelector('#hud svg')?.outerHTML.replace(/width="\d+" height="\d+"/, 'width="20" height="20"') ?? '∃';

function paintPill() {
  const fresh = pill.classList.contains('fresh');
  pill.innerHTML = `<span class="lp-glyph" aria-hidden="true">${EMARK().replace(/width="20" height="20"/, `width="${fresh ? 20 : 16}" height="${fresh ? 20 : 16}"`)}</span>`
    + `<span class="lp-text">${fresh ? '<kbd>WASD</kbd> move · type or say anything — try <q>wave</q>' : 'type or say anything'}</span>`
    + `<kbd class="lp-chord">${CHORD}</kbd>`;
}

export function initLantern({ submit, whisperTarget } = {}) {
  if (root) return;
  deps = { submit: submit ?? deps.submit, whisperTarget: whisperTarget ?? deps.whisperTarget };

  root = document.createElement('div');
  root.id = 'lantern'; root.className = 'panel'; root.hidden = true;
  root.innerHTML = `<div class="ln-head"><span class="ln-mark" aria-hidden="true">${EMARK()}</span>`
    + '<input class="ln-input" type="text" autocomplete="off" spellcheck="false" aria-label="type or say anything">'
    + '<kbd class="ln-esc">Esc</kbd></div>'
    + '<div class="ln-list" role="listbox"></div>'
    + '<div class="ln-foot"><span><kbd>↑↓</kbd>pick</span><span><kbd>Tab</kbd>do it</span><span><kbd>Enter</kbd>say it</span>'
    + '<span class="ln-grow"></span><span><kbd>/</kbd>commands</span></div>';
  input = root.querySelector('.ln-input');
  listEl = root.querySelector('.ln-list');
  input.placeholder = 'type to talk · / for commands · or a word: sky, wave, mute…';
  document.body.appendChild(root);

  pill = document.createElement('button');
  pill.id = 'lantern-pill'; pill.className = 'panel';
  pill.title = `type or say anything (${CHORD})`;
  let fresh = true; try { fresh = localStorage.getItem(SEEN_LS) !== '1'; } catch { /* private mode */ }
  if (fresh) pill.classList.add('fresh');
  paintPill();
  pill.onclick = () => (isLanternOpen() ? closeLantern() : openLantern());
  document.body.appendChild(pill);
  root.querySelector('.ln-esc').addEventListener('pointerdown', (e) => { e.preventDefault(); closeLantern(); });

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                        // typing is never walking (chat.js does the same)
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1, true); }
    else if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
    else if (e.key === 'Tab') { e.preventDefault(); if (!e.shiftKey && rows[sel]?.kind !== 'say') runRow(rows[sel]); }   // Tab never says
    else if (e.key === 'Escape') { e.preventDefault(); closeLantern(); }
  });
  // nothing in the panel takes focus from the line — rows, the gaps between them, the footer — or the
  // blur would close it 120 ms later (below). The line itself keeps its own caret placement.
  for (const t of ['pointerdown', 'mousedown']) root.addEventListener(t, (e) => { if (e.target !== input) e.preventDefault(); });
  listEl.addEventListener('pointermove', (e) => {
    const r = e.target.closest('.ln-row');
    if (r && Number(r.dataset.i) !== sel) select(Number(r.dataset.i), true);
  });
  // the pointer leaving gives the highlight back to the best match (and Enter back to speech)
  listEl.addEventListener('pointerleave', () => { if (moved) { moved = false; select(Math.max(0, best), false); } });
  listEl.addEventListener('click', (e) => {
    const r = e.target.closest('.ln-row');
    if (r) runRow(rows[Number(r.dataset.i)]);
  });
  // a click anywhere else closes it (the pill toggles on its own)
  input.addEventListener('blur', () => setTimeout(() => {
    if (isLanternOpen() && !root.contains(document.activeElement) && document.activeElement !== pill) closeLantern();
  }, 120));

  // Ctrl/Cmd+K from anywhere — even from inside the chat box — captured before the
  // world's key handlers so K never also reaches them
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyK' || e.altKey || e.shiftKey) return;
    if (document.querySelector('.scrim.open')) return;   // a modal (help, the door) owns the keyboard
    e.preventDefault(); e.stopPropagation();
    if (isLanternOpen()) closeLantern(); else openLantern();
  }, true);

  // frames move and close under us: keep the axis clear of the compose box
  place();
  addEventListener('resize', place);
  setInterval(place, 500);
}
