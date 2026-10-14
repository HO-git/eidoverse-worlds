// water — a world's one water level, drawn (shared/terrainshape.js waterParams).
//
// A flat sheet at `level` over the terrain square. Every vertex carries how deep the water is THERE
// (level minus the ground under it), baked once at build, and the material reads that depth: clear and
// pale in the shallows, the world's colour further out, foam where the depth runs to nothing at the shore.
// Triangles wholly over dry ground are dropped from the index, so the sheet costs what the lakes cost,
// not what the whole square would. The ripple is a moving normal, not moving vertices, so the shoreline
// foam stays exactly where the ground meets the water.
//
// KINDS (shared/waterkind.js): the same level fills a bowl, a channel and the open edge of the world,
// and those are different water. The shape of each wet body says which — still, river, ocean — and each
// vertex is told its kind, a river's flow, and the sea's way in to shore. The material reads them: still
// water lies nearly mirror-calm; a river's ripples and foam streaks are carried down its channel; the
// sea rolls waves in toward the shore that steepen and break into surf in the shallows.
//
// Nothing here moves bodies — wading is the controller's (and the agents') rule, from the same level.
import { THREE, scene } from './core.js';
import { attribute, mix, smoothstep, vec3, float, positionLocal, time, sin, cos, pow, normalize, color, transformNormalToView } from 'three/tsl';
import { waterParams } from '../../shared/terrainshape.js';
import { analyzeWater } from '../../shared/waterkind.js';

let current = null;   // { mesh, level }

/** The world's water level, or null when it has none. */
export const waterLevel = () => current?.level ?? null;

/** Build (or replace, or remove) the water for terrain-verb args over the ground `heightAt`. */
export function applyWater(args, heightAt) {
  if (current) {
    scene.remove(current.mesh);
    current.mesh.geometry.dispose();
    current.mesh.material.dispose();
    current = null;
  }
  const W = waterParams(args);
  if (!W) return;
  const size = typeof args?.size === 'number' ? args.size : 80;
  const seg = Math.max(32, Math.min(256, Math.round(size)));
  // the analysis grid IS the mesh's vertex grid: PlaneGeometry rotated flat lists vertex (i, j) at
  // x = -size/2 + i·cell, z = -size/2 + j·cell, row by row — the same order waterkind indexes
  const A = analyzeWater(heightAt, size, { level: W.level, kind: args.water?.kind, flow: args.water?.flow }, seg);
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const n = A.n, N = n * n, depth = A.depth;
  // keep a triangle if any corner is wet (or nearly): the foam needs the strip just above the waterline
  const idx = geo.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (Math.max(depth[a], depth[b], depth[c]) > -0.05) keep.push(a, b, c);
  }
  if (!keep.length) return;   // a level below every bit of ground: nothing is under water
  geo.setIndex(keep);
  // Per-vertex kind (one-hot), flow (x, z, speed) and way-to-shore (x, z, metres from shore). A dry
  // vertex on a shoreline triangle borrows its wettest neighbour's, so the surf and the streaks run right
  // up to the waterline instead of fading to still water across the last triangle.
  const kindw = new Float32Array(N * 3), flow = new Float32Array(N * 3), shore = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    let src = k;
    if (depth[k] <= 0) {
      const i = k % n, j = (k - i) / n; let best = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const m = jj * n + ii;
        if (depth[m] > best) { best = depth[m]; src = m; }
      }
    }
    kindw[3 * k + A.kind[src]] = 1;
    flow[3 * k] = A.flow[2 * src]; flow[3 * k + 1] = A.flow[2 * src + 1]; flow[3 * k + 2] = A.speed[src];
    shore[3 * k] = A.toShore[2 * src]; shore[3 * k + 1] = A.toShore[2 * src + 1]; shore[3 * k + 2] = A.shore[k];
  }
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  geo.setAttribute('wkind', new THREE.BufferAttribute(kindw, 3));
  geo.setAttribute('wflow', new THREE.BufferAttribute(flow, 3));
  geo.setAttribute('wshore', new THREE.BufferAttribute(shore, 3));

  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.08, metalness: 0 });
  const d = attribute('depth'), K = attribute('wkind'), F = attribute('wflow'), S = attribute('wshore');
  const still = K.x, river = K.y, ocean = K.z;
  const deep = smoothstep(0.0, 2.5, d);                    // 0 at the shore → 1 past 2.5 m
  const edge = float(1).sub(smoothstep(0.0, 0.22, d));     // a band where the depth runs out
  // the mesh sits at (0, level, 0) unrotated, so local x/z ARE world x/z — the same pattern on every client
  const px = positionLocal.x, pz = positionLocal.z, t = time;

  // STILL — faint wind ripples, nearly a mirror
  const sX = sin(px.mul(1.3).add(t.mul(0.5))).mul(0.018).add(sin(pz.mul(2.1).sub(t.mul(0.4))).mul(0.01));
  const sZ = cos(pz.mul(1.1).add(t.mul(0.45))).mul(0.018).add(cos(px.mul(1.9).add(t.mul(0.35))).mul(0.01));

  // RIVER — a pattern carried down the channel: `a` runs along the flow, `c` across it
  const a = px.mul(F.x).add(pz.mul(F.y)), c = pz.mul(F.x).sub(px.mul(F.y));
  const ph1 = a.sub(t.mul(F.z)).mul(1.4), ph2 = a.mul(0.6).add(c.mul(1.7)).sub(t.mul(F.z).mul(0.6));
  const along = cos(ph1).mul(0.085).add(cos(ph2).mul(0.04)), across = cos(ph2).mul(0.05);
  const rX = F.x.mul(along).sub(F.y.mul(across)), rZ = F.y.mul(along).add(F.x.mul(across));
  const streak = smoothstep(0.8, 1.0, sin(c.mul(2.2).add(sin(a.mul(0.35)).mul(1.6))).mul(0.5).add(0.5))
    .mul(smoothstep(0.45, 1.0, sin(ph1.mul(0.45)).mul(0.5).add(0.5)));

  // OCEAN — swell rolling in along `o` (the way to shore), crests a little wavy along `oc`; it grows with
  // depth and flattens as it runs aground, where it breaks into surf on the beat of its own crest
  const o = px.mul(S.x).add(pz.mul(S.y)), oc = pz.mul(S.x).sub(px.mul(S.y));
  const KW = 0.32, ow1 = o.mul(KW).sub(t.mul(1.0)).add(sin(oc.mul(0.07)).mul(1.2));
  const ow2 = o.mul(KW * 1.9).add(oc.mul(0.25)).sub(t.mul(1.45));
  const amp = smoothstep(0.15, 2.5, d).mul(0.22).mul(ocean);
  const disp = sin(ow1).mul(amp).add(sin(ow2).mul(amp.mul(0.35)));
  const slope = cos(ow1).mul(amp.mul(KW)).add(cos(ow2).mul(amp.mul(0.35 * KW * 1.9)));
  const oX = S.x.mul(slope).negate(), oZ = S.y.mul(slope).negate();
  const surf = float(1).sub(smoothstep(0.0, 0.9, d)).mul(pow(sin(ow1).mul(0.5).add(0.5), 3)).mul(ocean);
  mat.positionNode = positionLocal.add(vec3(0, disp, 0));

  const nx = still.mul(sX).add(river.mul(rX.add(sX.mul(0.5)))).add(ocean.mul(oX.add(sX)));
  const nz = still.mul(sZ).add(river.mul(rZ.add(sZ.mul(0.5)))).add(ocean.mul(oZ.add(sZ)));
  mat.normalNode = transformNormalToView(normalize(vec3(nx, float(1), nz)));

  // colour: the world's water colour, murkier and greener in a river, a deeper blue out at sea with
  // turquoise in its shallows
  const base = color(W.color);
  const deepCol = base.mul(still).add(mix(base, vec3(0.2, 0.3, 0.22), 0.25).mul(river)).add(mix(base, vec3(0.04, 0.2, 0.36), 0.55).mul(ocean));
  const shallowCol = base.mul(0.55).add(vec3(0.18, 0.24, 0.2)).mul(still.add(river)).add(vec3(0.22, 0.56, 0.56).mul(ocean));
  const foam = edge.mul(still.mul(0.75).add(river.mul(0.6)).add(ocean.mul(0.35)))
    .add(streak.mul(river).mul(0.45)).add(surf.mul(0.85)).clamp(0, 1);
  mat.colorNode = mix(mix(shallowCol, deepCol, deep), vec3(0.9, 0.95, 0.94), foam);
  mat.opacityNode = mix(float(0.38), float(W.opacity), deep).add(foam.mul(0.35)).clamp(0, 1);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.y = W.level;
  mesh.renderOrder = 2;   // after the ground and the opaque world: it is seen THROUGH
  mesh.userData.bodies = A.bodies.map((b) => ({ kind: b.kind, area: Math.round(b.area), width: +b.width.toFixed(1), length: +b.length.toFixed(1) }));
  scene.add(mesh);
  current = { mesh, level: W.level, analysis: A };
}

/** What kind of water is at a point, for the HUD and probes (shared/waterkind.js sample). */
export const waterAt = (x, z) => current?.analysis?.sample(x, z) ?? null;
