// lantern — one line for everything: type to talk, `/` for commands, or a word
// ("sky", "wave", "mute") for the matching ACTIONS, with their keys shown so the
// keys teach themselves. Direction C of the HUD bluesky (hep/hud-bluesky).
//
// Additive: Ctrl/Cmd+K or the small pill bottom-centre opens it; Enter-to-chat is
// untouched. It owns no knowledge of what can be done — that is lib/actions.js,
// filled at each definition site — and no send path: plain text and /commands go
// through the chat compose box's own submit (chat.submit), so there is one path.
import { list, grouped, STRONG } from './actions.js';

const SEEN_LS = 'ew-lantern-seen';
const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');
const CHORD = isMac ? '⌘K' : 'Ctrl K';

let root = null, input = null, listEl = null, pill = null;
let rows = [];        // what is on screen, selectable, in display order
let sel = 0;
let deps = { submit: () => {}, whisperTarget: () => null };

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const isLanternOpen = () => !!root && !root.hidden;

export function openLantern(text = '') {
  if (!root) return;
  root.hidden = false;
  pill?.classList.add('open');
  input.value = text;
  render();
  input.focus();
  try { localStorage.setItem(SEEN_LS, '1'); } catch { /* private mode */ }
  pill?.classList.remove('fresh');
}

export function closeLantern() {
  if (!root || root.hidden) return;
  root.hidden = true;
  pill?.classList.remove('open');
  if (document.activeElement === input) input.blur();
}

// ---------------------------------------------------------------- rows

function build(q) {
  const out = [];   // [{ group, rows: [{ kind, title, key?, action? }] }]
  if (q.startsWith('/')) {
    // the existing command path, verbatim; matching commands below it as a reminder of what exists
    out.push({ group: 'chat', rows: [{ kind: 'raw', title: `run ${q}` }] });
    const word = q.slice(1).split(/\s+/)[0];
    const cmds = list(word).filter((r) => r.action.group === 'commands' && r.action.title.startsWith(`/${word}`));
    if (cmds.length) out.push({ group: 'commands', rows: cmds.map(toRow) });
    return out;
  }
  const results = list(q, { limit: q ? 30 : 200 });
  const groups = grouped(results).map(({ group, rows: rs }) => ({ group, rows: rs.map(toRow) }));
  if (!q) return groups;
  const to = deps.whisperTarget?.();
  const say = { group: 'chat', rows: [{ kind: 'say', title: to ? `whisper “${q}” to ${to}` : `say “${q}” in chat` }] };
  // plain text with no STRONG match is speech first; a strong match leads and speech waits at the end
  return results[0]?.score >= STRONG ? [...groups, say] : [say, ...groups];
}
const toRow = ({ action }) => ({ kind: 'action', title: action.title, key: action.key, action });

function render() {
  const q = input.value.trim();
  const groups = build(q);
  rows = groups.flatMap((g) => g.rows);
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  if (q !== render.lastQ) sel = 0;
  render.lastQ = q;
  let i = 0, html = '';
  for (const g of groups) {
    html += `<div class="ln-group">${esc(g.group)}</div>`;
    for (const r of g.rows) {
      html += `<div class="ln-row ${r.kind}${i === sel ? ' sel' : ''}" role="option" data-i="${i}"${i === sel ? ' aria-selected="true"' : ''}>`
        + `<span class="ln-title">${esc(r.title)}</span>${r.key ? `<kbd>${esc(r.key)}</kbd>` : ''}</div>`;
      i++;
    }
  }
  listEl.innerHTML = html || '<div class="ln-empty">nothing matches — Enter says it in chat</div>';
  listEl.querySelector('.ln-row.sel')?.scrollIntoView({ block: 'nearest' });
}

function move(d) {
  if (!rows.length) return;
  sel = (sel + d + rows.length) % rows.length;
  for (const el of listEl.querySelectorAll('.ln-row')) {
    const on = Number(el.dataset.i) === sel;
    el.classList.toggle('sel', on);
    if (on) { el.setAttribute('aria-selected', 'true'); el.scrollIntoView({ block: 'nearest' }); } else el.removeAttribute('aria-selected');
  }
}

function runRow(r) {
  const q = input.value.trim();
  if (!r) { if (q) { closeLantern(); deps.submit(q); } return; }
  if (r.kind === 'raw' || r.kind === 'say') { closeLantern(); deps.submit(q); return; }
  const a = r.action;
  if (typeof a.fill === 'string' && typeof a.run !== 'function') {   // a command that needs its argument: keep typing
    input.value = a.fill; render(); input.focus(); return;
  }
  closeLantern();
  try { a.run(); } catch (e) { console.error(`[lantern] ${a.id} failed`, e); }
}

// ---------------------------------------------------------------- boot

export function initLantern({ submit, whisperTarget } = {}) {
  if (root) return;
  deps = { submit: submit ?? deps.submit, whisperTarget: whisperTarget ?? deps.whisperTarget };

  root = document.createElement('div');
  root.id = 'lantern'; root.className = 'panel'; root.hidden = true;
  root.innerHTML = '<input class="ln-input" type="text" autocomplete="off" spellcheck="false" aria-label="type or say anything">'
    + '<div class="ln-list" role="listbox"></div>';
  input = root.querySelector('.ln-input');
  listEl = root.querySelector('.ln-list');
  input.placeholder = 'type to talk · / for commands · or a word: sky, wave, mute…';
  document.body.appendChild(root);

  pill = document.createElement('button');
  pill.id = 'lantern-pill'; pill.className = 'panel';
  pill.title = `type or say anything (${CHORD})`;
  pill.innerHTML = '<span class="lp-glyph" aria-hidden="true">✦</span><span class="lp-text">type or say anything</span>'
    + `<kbd class="lp-chord">${CHORD}</kbd>`;
  let fresh = true; try { fresh = localStorage.getItem(SEEN_LS) !== '1'; } catch { /* private mode */ }
  if (fresh) { pill.classList.add('fresh'); pill.querySelector('.lp-text').textContent = 'type or say anything — try “wave”'; }
  pill.onclick = () => (isLanternOpen() ? closeLantern() : openLantern());
  document.body.appendChild(pill);

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                        // typing is never walking (chat.js does the same)
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runRow(rows[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeLantern(); }
    else if (e.key === 'Tab' && rows[sel]?.action?.fill) { e.preventDefault(); input.value = rows[sel].action.fill; render(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); closeLantern(); }
  });
  // rows are clicked, not focused: keep the caret in the line
  listEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.ln-row')) e.preventDefault(); });
  listEl.addEventListener('pointermove', (e) => {
    const r = e.target.closest('.ln-row');
    if (r && Number(r.dataset.i) !== sel) move(Number(r.dataset.i) - sel);
  });
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
}
