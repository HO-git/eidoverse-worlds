// sky-interim-probe — the world first, the sky last (owner, 09-27). After a fresh sky build: one interim gradient in
// the sky system's own time-of-day colours stands in, the big domes stay out of the scene and never enter the serial
// warm conductor, the curtain doesn't wait on the sky, and the real sky replaces the gradient only once the world
// near you has settled. Cloud quality OFF before load (a software cloud bake exhausts this machine); the tier still
// builds, holds and bakes. Real client.
//   bun tools/sky-interim-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
const lines = []; const T0 = Date.now();
pg.on('console', (m) => { const t = m.text(); if (/sky/.test(t)) lines.push(`${((Date.now() - T0) / 1000).toFixed(1)} ${t.slice(0, 160)}`); });
pg.on('request', (r) => { const b = r.postData(); if (b && /\[sky\]/.test(b)) for (const x of b.match(/\[sky\][^"\\]*/g) ?? []) lines.push(`${((Date.now() - T0) / 1000).toFixed(1)} ${x.slice(0, 160)}`); });
try {
  // a world whose log already has a cloudy sky, so boot builds it
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=interim&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.evaluate(async () => { const { sendVerb } = await import('./lib/net.js'); sendVerb('sky', { hours: 17, rate: 0, clouds: 'cumulus' }); });
  await pg.waitForTimeout(1500);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  const t1 = Date.now();
  // sample the state until the real sky is up
  let seen = { interim: false, interimWithDomesOut: false, colours: null }; let up = false;
  for (let i = 0; i < 360 && !up; i++) {
    const st = await pg.evaluate(async () => {
      try {
        const si = await import('./lib/sky_interim.js'), sb = await import('./lib/sky_baked.js');
        const m = globalThis.EW?.scene?.getObjectByName?.('interim sky');
        const c = m?.geometry?.attributes?.color; const top = c ? [c.getX(0), c.getY(0), c.getZ(0)].map((v) => +v.toFixed(3)) : null;
        return { interim: si.interimSkyShown(), held: sb.liveDomesHeld(), top, booted: !document.querySelector('#splash:not(.gone)') };
      } catch (e) { return { err: String(e) }; }
    }).catch(() => null);
    if (st?.interim) { seen.interim = true; if (st.held) seen.interimWithDomesOut = true; if (st.top) seen.colours = st.top; }
    up = lines.some((l) => /the real sky is up/.test(l));
    if (!up) await pg.waitForTimeout(500);
  }
  const after = await pg.evaluate(async () => ({ interim: (await import('./lib/sky_interim.js')).interimSkyShown(), held: (await import('./lib/sky_baked.js')).liveDomesHeld() }));
  const order = (re) => lines.findIndex((l) => re.test(l));
  console.log('   ', JSON.stringify({ seen, after, s: ((Date.now() - t1) / 1000).toFixed(1) }));
  console.log(lines.filter((l) => /held out|settled|real sky|build owns|compiled/.test(l)).map((l) => '      ' + l).join('\n'));
  check('a fresh build holds the domes out and shows the interim gradient', seen.interim && seen.interimWithDomesOut, JSON.stringify(seen));
  check('…painted in the sky system\'s own colours (not black, not a flat default)', !!seen.colours && seen.colours.some((v) => v > 0.02), JSON.stringify(seen.colours));
  check('the sky compiles only after the world settled', order(/world settled/) >= 0 && order(/world settled/) < order(/the real sky is up/), '');
  const owns = lines.find((l) => /build owns/.test(l)) ?? '';
  const spheres = owns.match(/SphereGeometry=\w+/g) ?? [];
  check('the big domes (the spheres) skip the warm conductor, for later', spheres.length >= 2 && spheres.every((x) => /later/.test(x)), owns.slice(0, 200));
  check('the real sky replaces it: gradient gone, nothing left held', up && !after.interim && !after.held, JSON.stringify(after));
  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
