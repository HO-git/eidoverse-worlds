// lantern (client/lib/lantern.js) — the keys' contract, against the REAL module and the real action
// registry, in happy-dom. The browser walk is tools/lantern-probe.mjs; this pins the logic it rides on:
//   Enter SAYS what you typed (unless it starts with "/" or the person moved the highlight)
//   Tab DOES the highlighted action — and never says, even when nothing matches
//   a command that names its target fills the line instead of running with a default
//
//   BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/lantern-test.ts
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();

const A = await import('../client/lib/actions.js');
const L = await import('../client/lib/lantern.js');

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`); }
};

const said: string[] = [];
const ran: string[] = [];
A.clear();
A.register({ id: 'body:sit', title: 'sit', group: 'body', key: 'X', run: () => ran.push('body:sit') });
A.register({ id: 'emote:wave', title: 'wave', group: 'emotes', key: '1', run: () => ran.push('emote:wave') });
A.register({ id: 'cmd:w', title: '/w', group: 'commands', keywords: ['whisper'], detail: '/w <name> <message> — whisper, privately', fill: '/w ' });
A.register({ id: 'cmd:who', title: '/who', group: 'commands', detail: 'list everyone present', run: () => ran.push('cmd:who') });

const hint = document.createElement('div'); hint.id = 'hintbar'; document.body.append(hint);
const before = document.createElement('input'); before.id = 'before'; document.body.append(before);   // the chat line, say
L.initLantern({ submit: (q: string) => said.push(q) });
const root = document.getElementById('lantern')!;
const input = root.querySelector('.ln-input') as HTMLInputElement;
const key = (k: string, o: KeyboardEventInit = {}) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
const reset = () => { said.length = 0; ran.length = 0; };
const rowKinds = () => [...root.querySelectorAll('.ln-row')].map((r) => r.className.split(' ')[1]);

console.log('LANTERN — Enter says, Tab does');
reset(); L.openLantern('sit');
check('"sit": the say row first, then the action', rowKinds().join() === 'say,action', rowKinds().join());
check('…the action is highlighted, wearing Tab', root.querySelector('.ln-row.sel .ln-do')?.textContent === 'Tab');
key('Enter');
check('"sit" + Enter says "sit" and sits nobody', said.join() === 'sit' && ran.length === 0, JSON.stringify({ said, ran }));
check('…and closes', !L.isLanternOpen());
reset(); L.openLantern('sit'); key('Tab');
check('"sit" + Tab sits and says nothing', ran.join() === 'body:sit' && said.length === 0, JSON.stringify({ said, ran }));

console.log('LANTERN — Tab never says');
reset(); L.openLantern('zzqx');
check('"zzqx": only the say row', rowKinds().join() === 'say', rowKinds().join());
key('Tab');
check('"zzqx" + Tab says nothing and runs nothing', said.length === 0 && ran.length === 0, JSON.stringify({ said, ran }));
check('…and the lantern stays open with the text', L.isLanternOpen() && input.value === 'zzqx');
key('Enter');
check('…Enter still says it', said.join() === 'zzqx');
reset(); L.openLantern('sit'); key('ArrowUp'); key('Tab');
check('Tab on a say row the person moved to says nothing either', said.length === 0 && ran.length === 0 && L.isLanternOpen(), JSON.stringify({ said, ran }));
L.closeLantern();

console.log('LANTERN — a moved highlight, commands, fill');
reset(); L.openLantern('sit'); key('ArrowUp'); key('ArrowDown'); key('Enter');
check('a highlight moved back onto the action: Enter runs it', ran.join() === 'body:sit' && said.length === 0, JSON.stringify({ said, ran }));
reset(); L.openLantern('/who');
check('"/who": the pass-through row first', rowKinds()[0] === 'raw', rowKinds().join());
key('Enter');
check('"/who" + Enter goes through the command path', said.join() === '/who' && ran.length === 0, JSON.stringify({ said, ran }));
reset(); L.openLantern('whisper'); key('Tab');
check('a fill command on Tab fills the line and stays open', input.value === '/w ' && L.isLanternOpen() && said.length === 0, JSON.stringify({ v: input.value, said }));
L.closeLantern();

console.log('LANTERN — the hint bar steps aside while it is open');
L.openLantern('');
check('open: body.lantern-open (the hint bar would sit on the footer: both bottom 24px)', document.body.classList.contains('lantern-open'));
L.closeLantern();
check('closed: the class is gone, the hint bar is back', !document.body.classList.contains('lantern-open'));

console.log('LANTERN — a click inside it keeps it open');
L.openLantern('');
const pd = new Event('pointerdown', { bubbles: true, cancelable: true });
root.querySelector('.ln-foot')!.dispatchEvent(pd);
check('a pointerdown on the footer keeps the caret in the line (default prevented: no blur, no close 120 ms later)', pd.defaultPrevented);
const ph = new Event('pointerdown', { bubbles: true, cancelable: true });
root.querySelector('.ln-head')!.dispatchEvent(ph);
check('…on the head around the line too', ph.defaultPrevented);
const pi = new Event('pointerdown', { bubbles: true, cancelable: true });
input.dispatchEvent(pi);
check('…but not on the line itself (placing the caret is the line\'s own business)', !pi.defaultPrevented);
L.closeLantern();

console.log('LANTERN — closing gives focus back');
before.focus(); L.openLantern('');
check('open: the line has focus', document.activeElement === input);
key('Escape');
check('Esc closes and focus goes back to the field that had it', !L.isLanternOpen() && document.activeElement === before, document.activeElement?.id || String(document.activeElement));
before.focus(); L.openLantern('sit'); key('Tab');
check('…after Tab runs an action too', document.activeElement === before, document.activeElement?.id || String(document.activeElement));
const other = document.createElement('button'); other.id = 'other'; document.body.append(other);
before.focus(); L.openLantern('');
other.focus(); L.closeLantern();
check('focus that already left the lantern is not pulled back', document.activeElement === other, document.activeElement?.id || String(document.activeElement));
before.focus(); L.openLantern('');
before.remove(); key('Escape');
check('a previously focused node that is gone is not focused (no throw)', !L.isLanternOpen());
document.body.append(before);
const btn = document.createElement('button'); btn.id = 'btn'; document.body.append(btn);
btn.focus(); L.openLantern(''); key('Escape');
check('a button that had focus (the pill, a rail entry) is not refocused: its Enter/Space would click it', document.activeElement !== btn,
  document.activeElement?.id || String(document.activeElement));

console.log('LANTERN — Ctrl+K from inside the line');
L.openLantern('');
key('k', { code: 'KeyK', ctrlKey: true });
check('Ctrl+K in the line closes it (the window\'s capture handler owns the chord)', !L.isLanternOpen());

console.log('LANTERN — the resting line pins from the ∃ menu, and goes quiet with the panels (R, 10-01)');
{ const pill = document.getElementById('lantern-pill')!;
  // hidden = a class the sheet turns into display:none (index.html) — the pill's own `display:flex` beats [hidden]
  const resting = () => !pill.classList.contains('unpinned') && !pill.classList.contains('quiet');
  check('pinned by default: the pill rests', L.pillPinned() === true && resting(), pill.className);
  L.setPillPinned(false);
  check('unpinned: no resting pill', !L.pillPinned() && pill.classList.contains('unpinned'), pill.className);
  check('…and the choice is remembered', localStorage.getItem('ew-lantern-pinned') === '0', String(localStorage.getItem('ew-lantern-pinned')));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
  check('unpinned, Ctrl+K still opens the lantern (unpinning hides its resting place, not the command line)', L.isLanternOpen());
  L.closeLantern();
  L.openLantern('');
  check('…and openLantern() (the rail\'s search entry) does too', L.isLanternOpen());
  L.closeLantern();
  L.setPillPinned(true);
  check('pinned again: the pill rests again', resting() && localStorage.getItem('ew-lantern-pinned') === '1', pill.className);

  L.setPillQuiet(true);
  check('Esc put the panels away: the pill goes with them', L.pillQuiet() && pill.classList.contains('quiet'), pill.className);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
  check('quiet, Ctrl+K still opens the lantern', L.isLanternOpen());
  key('Escape');
  check('…and Esc in the line closes the lantern first (the panels stay put away)', !L.isLanternOpen() && L.pillQuiet());
  L.setPillQuiet(false);
  check('the panels come back: so does the pill', resting(), pill.className);
  L.setPillPinned(false); L.setPillQuiet(true); L.setPillQuiet(false);
  check('an unpinned pill stays away when the panels come back', pill.classList.contains('unpinned') && !pill.classList.contains('quiet'), pill.className);
  L.setPillPinned(true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
