// palette — the world panel's catalog sections (split from build.js, §R4):
// the model library, the avatar roster, and the drag-in upload door. The
// EDITING gestures (ghost, select, drag, undo) stay in build.js; this module
// is how a thing gets INTO your hand, build.js is what your hand does with it.

import { TIER_COLORS } from '../../shared/perfrank.js';
import { CONFIG, report, bus } from './base.js';
import { libLabels } from './assets.js';
import { sendVerb } from './net.js';
import { makeSection, toast, escapeHtml } from './ui.js';
import { holdGhost } from './build.js';
import { paintGround } from './groundpanel.js';
import { paintSky } from './skypanel.js';

// The starter vocabulary. Everything else arrives through the catalog or an
// `asset` verb, so this list is a doorway, not a limit.
const STARTER = [
  ['crate (red)', 'eidoverse/assets/models/crate_large_red.glb'],
  ['crate (blue)', 'eidoverse/assets/models/crate_large_blue.glb'],
  ['palm tree', 'eidoverse/assets/models/palm_date_tree_tropical_deseert_oasis_plant.glb'],
  ['joshua tree', 'eidoverse/assets/models/stylized_yucca_joshua_tree_desert_cactus_plant.glb'],
  ['streetlight', 'eidoverse/assets/models/streetlight_lamp_light_street_blade_runner_cyberpunk.glb'],
  ['deco desk', 'eidoverse/assets/models/scifi_art_deco_office_desk.glb'],
  ['retro computer', 'eidoverse/assets/models/scif_cyberpunk_crt_retro_computer_monitor_screen_keyboard_tower.glb'],
  ['barrels', 'eidoverse/assets/models/scifi_barrels_group_of_four.glb'],
];

/** The curated starters, as rows — the same list the palette opens on. */
export const starterModels = () => STARTER.map(([name, path]) => ({ name, path }));

export function initPalette() {
  makeSection('🧱 build', async (body) => { if (!body.dataset.init) await paintBuild(body); },
    { id: 'build' });
  makeSection('🧍 avatar', paintAvatars, { id: 'avatar' });
  makeSection('🌿 ground', paintGround, { id: 'ground' });
  makeSection('☀ sky', paintSky, { id: 'sky' });
}

// ---- models ----------------------------------------------------------------

async function paintBuild(body) {
  body.dataset.init = '1';
  body.innerHTML = '';

  // primitives that aren't library models — a light is the first
  const prim = document.createElement('button');
  prim.textContent = '💡 add light';
  prim.title = 'place a light source';
  prim.onclick = () => holdGhost('@light', 'light');
  body.appendChild(prim);

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'search the library…';
  search.addEventListener('keydown', (e) => e.stopPropagation()); // typing ≠ walking
  body.appendChild(search);

  const grid = document.createElement('div');
  grid.className = 'grid';
  body.appendChild(grid);

  // Every optimization's status, from the server's own verdicts (/library-models `opt`, store-variants.ts
  // variantStatus — owner, 09-24: nothing may fail silently). A pass that was refused / deferred / is stale shows an
  // amber chip; a built LOD a quiet one; the hover lists every pass and why. Text goes through textContent/title
  // only — reasons are server-written but derived from uploaded content.
  const PASS = { min: 'compressed copy', ktx2: 'GPU textures', lod: 'LOD' };
  const WORD = { built: 'built', 'not-needed': 'not needed', unsupported: 'not supported', refused: 'refused',
    stale: 'will be re-checked', deferred: 'deferred', pending: 'not processed yet' };
  // The corner row (owner, 09-24): the loupe's overall rank as a colored pill (the same rule and colors as Debug › Perf ›
  // Loupe — shared/perfrank.js; the server reads it from the GLB, tools/glbperf-parity-probe proves it equals the
  // loupe's), then LOD / ⚠ chips. Inset from the image corner and spaced; hover explains each.
  const CAT = { tris: 'triangles', draws: 'draw calls', texMB: 'texture memory', bones: 'bones', mats: 'materials', alpha: 'transparent materials' };
  const chipRow = (card) => {
    let row = card.querySelector('.opt-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'opt-row';
      row.style.cssText = 'position:absolute;bottom:6px;right:6px;display:flex;gap:4px;align-items:center;pointer-events:none';
      (card.querySelector('.pv') ?? card).appendChild(row);
    }
    return row;
  };
  const perfLine = (label, p) => `${label}: ${p.rankName} — set by ${CAT[p.worst] ?? p.worst}\n`
    + `  ${p.tris.toLocaleString()} tris · ${p.draws} draws · ${p.mats} materials · ${p.texMB} MB textures (desktop worst case)`
    + `${p.alpha ? ` · ${p.alpha} transparent` : ''}${p.bones ? ` · ${p.bones} bones` : ''}`
    + `${p.unsizedImages ? ` · ${p.unsizedImages} image(s) not sized` : ''}`;
  // pill = what it costs IF YOU LOAD IT (the file a viewer is served); the hover also gives the original upload's
  // ↻ — re-run this object's GPU-texture + LOD passes (POST /rebuild, signed-in or door-keyed): a refusal asked again,
  // a built variant rebuilt in place. Inside the card's <button>, so a click must never reach the card (placement).
  const rebuildChip = (card, path, bad) => {
    const chip = document.createElement('b');
    chip.className = 'opt-rebuild';
    chip.textContent = '↻';
    chip.setAttribute('role', 'button');
    chip.title = 'rebuild GPU textures + LOD (re-asks a refused pass)';
    chip.style.cssText = 'display:inline-block;width:auto;font-size:10px;line-height:1;padding:1px 4px;border-radius:4px;'
      + `pointer-events:auto;cursor:pointer;background:rgba(0,0,0,.55);color:#e8e8e8;opacity:${bad ? 1 : 0.55}`;
    chip.onpointerenter = () => { chip.style.opacity = '1'; };
    chip.onpointerleave = () => { chip.style.opacity = bad ? '1' : '0.55'; };
    chip.onclick = async (e) => {
      e.stopPropagation(); e.preventDefault();
      if (chip.dataset.busy) return;
      chip.dataset.busy = '1'; chip.textContent = '…';
      try {
        const q = new URLSearchParams({ path });
        // the door key rides a header, never the URL; a signed-in session rides its cookie (same-origin fetch sends it)
        const r = await fetch(`/rebuild?${q}`, { method: 'POST', headers: CONFIG.token ? { authorization: `Bearer ${CONFIG.token}` } : {} });
        const j = r.ok ? await r.json() : null;
        toast(j ? (j.busy ? 'the encoder is busy with other rebuilds — try again in a minute' : j.cooldownS ? `rebuilt recently — this model can be rebuilt again in ${Math.ceil(j.cooldownS / 60)} min` : j.queued.length ? `rebuilding ${j.queued.map((k) => PASS[k] ?? k).join(' + ')} — the card updates on the next search`
          : 'nothing to rebuild on this server (no texture encoder)') : `rebuild refused (${r.status})`);
      } catch { toast('rebuild failed — server unreachable'); }
      chip.textContent = '↻'; delete chip.dataset.busy;
    };
    chipRow(card).appendChild(chip);
  };
  const optBadge = (card, opt, perf, perfOriginal, path, rebuildable) => {
    const rows = [];
    if (perf) {
      rows.push(perfLine(`perf if loaded (${perf.servedAs ?? 'served'})`, perf));
      if (perfOriginal) rows.push(perfLine('original upload', perfOriginal));
      const pill = document.createElement('b');   // not a span: the card's label rule (.card span) is full-width
      pill.className = 'opt-rank';
      pill.dataset.rank = String(perf.rank);
      pill.style.cssText = `display:inline-block;width:14px;height:8px;border-radius:4px;background:${TIER_COLORS[perf.rank]};`
        + 'box-shadow:0 0 0 1px rgba(0,0,0,.45)';
      chipRow(card).appendChild(pill);
    }
    if (opt) rows.push(...Object.entries(opt).map(([k, v]) => `${PASS[k] ?? k}: ${WORD[v.state] ?? v.state}${v.reason ? ` — ${v.reason}` : ''}`));
    if (rows.length) card.title = rows.join('\n');
    if (!opt) return;
    const bad = Object.values(opt).some((v) => v.state === 'refused' || v.state === 'deferred' || v.state === 'stale');
    const lod = opt.lod?.state === 'built';
    for (const [on, text, css] of [[lod, 'LOD', 'background:rgba(143,232,200,.18);color:#8fe8c8'], [bad, '⚠', 'background:#6b4a12;color:#ffd68a']]) {
      if (!on) continue;
      const chip = document.createElement('b');
      chip.className = 'opt-chip';
      chip.textContent = text;
      chip.style.cssText = `display:inline-block;width:auto;font-size:9px;line-height:1;padding:2px 4px;border-radius:4px;font-weight:600;${css}`;
      chipRow(card).appendChild(chip);
    }
    if (path && rebuildable !== false) rebuildChip(card, path, bad);   // no source to rebuild from → no button (it would 400)
  };

  const paint = (items) => {
    grid.innerHTML = '';
    for (const it of items) {
      libLabels.set(it.path, it.name);
      const card = document.createElement('button');
      card.className = 'card panel';
      const img = it.preview
        ? `<img alt="" loading="lazy" src="/library/${it.preview}" onerror="this.style.visibility='hidden'">`
        : '<div style="width:100%;aspect-ratio:1"></div>';
      // the picture gets its own positioned box so the status row sits ON the image (bottom-right), clear of the
      // label strip Skye's previews carry along their top edge and of the name below (owner, 09-24)
      card.innerHTML = `<div class="pv" style="position:relative;width:100%;line-height:0">${img}</div><span>${escapeHtml(it.name)}</span>`;   // server-supplied name (§24k hygiene)
      card.onclick = () => holdGhost(it.path, it.name);
      optBadge(card, it.opt, it.perf, it.perfOriginal, it.path, it.rebuildable);
      grid.appendChild(card);
    }
    if (!items.length) grid.innerHTML = '<div style="color:var(--dim);font-size:11px">nothing matched</div>';
  };

  // The catalog agents already had (mcpl list_library), now served to people —
  // with the _preview.jpg Skye ships beside every model, so it's a real
  // catalog instead of a list of filenames.
  const starter = () => STARTER.map(([name, path]) =>
    ({ name, path, preview: path.replace(/\.glb$/, '_preview.jpg') }));

  let timer = null;
  const run = async (q) => {
    // An empty box shows the curated starters, not an alphabetical dump of the
    // whole library — otherwise opening the panel greets you with four
    // varieties of apocalyptic rubble.
    if (!q) { paint(starter()); return; }
    try {
      const r = await fetch(`/library-models?q=${encodeURIComponent(q)}`);
      paint(await r.json());
    } catch (e) { report('catalog', e); }
  };
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => run(search.value.trim()), 160); };

  paint(starter());
}

// Assets uploaded into the world join the palette live, for everyone.
bus.on('asset', ({ name, path }) => {
  libLabels.set(path, name);
  toast(`${name} joined the world's palette`, 'info');
});

// ---- avatars ---------------------------------------------------------------

let onSwitchAvatar = null;
export function wireAvatarSwitch(fn) { onSwitchAvatar = fn; }
/** The one body-switch, for every surface (the desktop cards, the bodies panel, its quad). */
export function switchAvatar(path, name) { return onSwitchAvatar?.(path, name); }
let myAvatarPath = '';
export function setMyAvatarPath(p) { myAvatarPath = p; }

async function paintAvatars(body) {
  const list = await fetch('/avatars').then((r) => r.json()).catch(() => []);
  body.innerHTML = '';
  // the door's proven recipe (09-05): dense grid, every card a 3:4 portrait
  // box whether the image loaded or not — inline styles on the placeholder
  // used to give it its own size, so cards came out at two sizes (R's shot)
  const grid = document.createElement('div');
  grid.className = 'grid dense av-grid';
  for (const { name, path } of list) {
    const card = document.createElement('button');
    card.className = `card panel ${path === myAvatarPath ? 'on' : ''}`;
    // the portrait BOX sizes the card, never the image: a lazy <img> that has
    // not loaded (or 404s) has no size, and a card sized by it collapsed —
    // that was the two-sizes grid. The placeholder sits under the image and
    // simply shows through until a portrait covers it.
    card.innerHTML =
      `<div class="av-shot"><div class="ph">🧍</div><img alt="" loading="lazy" src="/thumb/${encodeURIComponent(name)}.png"></div>
       <span>${escapeHtml(name)}</span>`;
    const img = card.querySelector('img');
    img.addEventListener('error', () => { img.remove(); });
    card.onclick = () => onSwitchAvatar?.(path, name);
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

// ---- upload ----------------------------------------------------------------

addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const isVrm = /\.vrm$/i.test(file.name);
  if (!/\.(glb|vrm)$/i.test(file.name)) {
    toast(`can't ingest ${file.name} — .glb and .vrm only`, 'warn');
    return;
  }
  toast(`uploading ${file.name} (${(file.size / 1e6).toFixed(1)}MB)…`, 'info');
  try {
    const q = new URLSearchParams();
    if (isVrm) { q.set('as', 'avatar'); q.set('name', file.name); }
    if (CONFIG.token) q.set('token', CONFIG.token);
    const r = await fetch(`/upload${q.size ? `?${q}` : ''}`, { method: 'POST', body: file });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const { path, name } = await r.json();
    if (isVrm) {
      toast(`avatar "${name}" is on the roster — pick it in the avatar panel`, 'info', 9000);
    } else {
      const label = file.name.replace(/\.glb$/i, '');
      sendVerb('asset', { name: label, path });  // world vocabulary grows for everyone
      await holdGhost(path, label);
    }
  } catch (err) { report(`upload ${file.name}`, err); }
});
