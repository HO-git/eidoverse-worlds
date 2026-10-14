// water — a world's one water level, drawn (shared/terrainshape.js waterParams).
//
// A flat sheet at `level` over the terrain square. Every vertex carries how deep the water is THERE
// (level minus the ground under it), baked once at build, and the material reads that depth: clear and
// pale in the shallows, the world's colour further out, foam where the depth runs to nothing at the shore.
// Triangles wholly over dry ground are dropped from the index, so the sheet costs what the lakes cost,
// not what the whole square would. The ripple is a moving normal, not moving vertices, so the shoreline
// foam stays exactly where the ground meets the water.
//
// Nothing here moves bodies — wading is the controller's (and the agents') rule, from the same level.
import { THREE, scene } from './core.js';
import { attribute, mix, smoothstep, vec3, float, positionWorld, time, sin, cos, normalize, color, transformNormalToView } from 'three/tsl';
import { waterParams } from '../../shared/terrainshape.js';

let current = null;   // { mesh, level }

/** The world's water level, or null when it has none. */
export const waterLevel = () => current?.level ?? null;

/** Build (or replace, or remove) the water for terrain-verb args over the ground `heightAt`. */
export function applyWater(args, heightAt) {
  if (current) {
    if (current.mesh) {
      scene.remove(current.mesh);
      current.mesh.geometry.dispose();
      current.mesh.material.dispose();
    }
    current = null;
  }
  const W = waterParams(args);
  if (!W) return;
  const size = typeof args?.size === 'number' ? args.size : 80;
  // The level is the world's whether or not the sheet shows: wading and depth read it, not the mesh.
  current = { mesh: null, level: W.level };
  // about a metre a vertex (2 m on the biggest worlds), so a small pond is not stepped over
  const seg = Math.max(32, Math.min(512, Math.round(size)));
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = W.level - heightAt(pos.getX(i), pos.getZ(i));
  // keep a triangle if any corner is wet (or nearly): the foam needs the strip just above the waterline
  const idx = geo.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (Math.max(depth[a], depth[b], depth[c]) > -0.05) keep.push(a, b, c);
  }
  if (!keep.length) return;   // no vertex is under water: nothing to draw (the level still stands)
  geo.setIndex(keep);
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));

  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.08, metalness: 0 });
  const d = attribute('depth');
  const deep = smoothstep(0.0, 2.5, d);                    // 0 at the shore → 1 past 2.5 m
  const foam = float(1).sub(smoothstep(0.0, 0.22, d));     // a band where the depth runs out
  const shallow = color(W.color).mul(0.55).add(vec3(0.18, 0.24, 0.2));
  mat.colorNode = mix(mix(shallow, color(W.color), deep), vec3(0.88, 0.94, 0.93), foam.mul(0.75));
  mat.opacityNode = mix(float(0.38), float(W.opacity), deep).add(foam.mul(0.35)).clamp(0, 1);
  // two crossing ripple trains, slow, in world space so they read the same from every client
  const p = positionWorld, t = time;
  const nx = sin(p.x.mul(0.9).add(t.mul(1.1))).mul(0.06).add(sin(p.z.mul(1.7).sub(t.mul(0.7))).mul(0.035));
  const nz = cos(p.z.mul(0.8).add(t.mul(0.9))).mul(0.06).add(cos(p.x.mul(1.5).add(t.mul(0.6))).mul(0.035));
  mat.normalNode = transformNormalToView(normalize(vec3(nx, float(1), nz)));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.y = W.level;
  mesh.renderOrder = 2;   // after the ground and the opaque world: it is seen THROUGH
  scene.add(mesh);
  current.mesh = mesh;
}
