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
const before = document.createElement('button'); before.id = 'before'; document.body.append(before);
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
