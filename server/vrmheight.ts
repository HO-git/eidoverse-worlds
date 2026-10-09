// vrmheight — a body's stature read from the VRM file itself, no wearer needed.
//
// The roster's `height` was browser-contributed only (POST /thumb): a body
// nobody had worn showed null — 12 of 14 when this landed. The bounding box
// is no substitute: it counts hair, ears, petals and tails (claude.vrm boxes
// at ~2.2m around a 1.49m body). Nor is "vertices skinned to humanoid
// bones" — claude's crown of tentacles is weighted 100% to the humanoid
// Head bone itself, so a mesh-extent measure still reads 2.21m. The one
// definition of stature this world already has is the CLIENT's (avatar.js
// portrait pass): head joint world Y + 0.13m of forehead. This module
// computes exactly that from the file's bind pose, so a skeleton number and
// a wearer's browser number agree to the centimetre — a wearer's reading
// still wins in avatarRoster, it just stops being the only source.
//
// Read-only on the VRM (doctrine: the server never alters bodies), pure
// parseGlb + DataView walks — no gltf-transform, no three. Results are
// mtime-keyed in memory AND persisted beside the thumbs (heights.json), so a
// restart re-parses nothing and a re-upload re-measures exactly once.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseGlb } from "./glbparse.ts";
import { OPT_DIR } from "./config.ts";
import { atomicWrite } from "./fsutil.ts";

export type HeightSource = "skeleton" | "bbox_extent";
export type VrmHeight = { h: number; src: HeightSource; box: number | null };

// ---- glTF plumbing, just enough ------------------------------------------

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_N: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Per-element accessor reader over the GLB's one BIN chunk. DataView keeps
 *  us honest about alignment and interleaved strides; `normalized` weights
 *  (ubyte/ushort) come back as floats, per spec. Sparse or external-buffer
 *  accessors return null and the caller falls back. */
function accReader(json: any, bin: Uint8Array, idx: number): ((i: number, out: number[]) => void) | null {
  const acc = json.accessors?.[idx];
  if (!acc || acc.sparse) return null;
  const n = TYPE_N[acc.type];
  const size = COMP_SIZE[acc.componentType];
  if (!n || !size) return null;
  // Absent bufferView is spec-legal (zero-fill bases, Draco bodies) but gets
  // no reader HERE: zeros measure nothing, Draco positions live in the
  // extension's own view, and a crafted `count` on a zero-fill accessor would
  // otherwise buy a free synchronous spin (#229 review P1). With this branch
  // out, every count the walk loops over is backed by the in-bounds check
  // below — bounded by the file's actual bytes. The accessor's declared
  // min/max still feed the box (measureVrmBytes).
  if (acc.bufferView == null) return null;
  const bv = json.bufferViews?.[acc.bufferView];
  if (!bv || json.buffers?.[bv.buffer]?.uri) return null;   // GLB bodies keep everything in chunk 0
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride || size * n;
  if (base + (acc.count - 1) * stride + size * n > bin.byteLength) return null;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const ct = acc.componentType, norm = !!acc.normalized;
  return (i, out) => {
    let o = base + i * stride;
    for (let k = 0; k < n; k++, o += size) {
      let v: number;
      switch (ct) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5123: v = dv.getUint16(o, true); if (norm) v /= 65535; break;
        case 5121: v = dv.getUint8(o); if (norm) v /= 255; break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5122: v = dv.getInt16(o, true); if (norm) v = Math.max(v / 32767, -1); break;
        default:   v = dv.getInt8(o); if (norm) v = Math.max(v / 127, -1); break;
      }
      out[k] = v;
    }
  };
}

// column-major 4×4, same layout node.getWorldMatrix() hands geometry.ts
function matMul(a: number[], b: number[]): number[] {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function localMatrix(node: any): number[] {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Bind-pose world matrix per node — the node transforms ARE the bind pose
 *  in a VRM (no animation is applied at rest). */
function worldMatrices(json: any): number[][] {
  const nodes: any[] = json.nodes ?? [];
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((nd, i) => { for (const c of nd?.children ?? []) if (parent[c] === -1) parent[c] = i; });
  const world: (number[] | null)[] = nodes.map(() => null);
  const compute = (i: number): number[] => {
    if (world[i]) return world[i]!;
    const local = localMatrix(nodes[i] ?? {});
    const p = parent[i];
    if (p < 0 || p === i) return (world[i] = local);
    // pre-seed with the local so a malformed cycle terminates at it instead
    // of recursing forever; acyclic files overwrite it one line later
    world[i] = local;
    return (world[i] = matMul(compute(p), local));
  };
  nodes.forEach((_, i) => compute(i));
  return world as number[][];
}

/** The humanoid bone map, both dialects: VRM 1.0 (`VRMC_vrm`, bone→{node})
 *  and VRM 0.x (`VRM`, [{bone, node}]). Spring-bone joints need no list of
 *  their own — they are never humanoid bones, so the strongest-weight test
 *  below already reads them as protrusions. */
function humanoid(json: any): { set: Set<number>; head: number } | null {
  const v1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones;
  const set = new Set<number>();
  let head = -1;
  if (v1 && typeof v1 === "object") {
    for (const [bone, b] of Object.entries<any>(v1)) {
      if (typeof b?.node === "number") { set.add(b.node); if (bone === "head") head = b.node; }
    }
  } else {
    const v0 = json.extensions?.VRM?.humanoid?.humanBones;
    if (Array.isArray(v0)) for (const b of v0) {
      if (typeof b?.node === "number") { set.add(b.node); if (b.bone === "head") head = b.node; }
    }
  }
  return set.size ? { set, head } : null;
}

// ---- the measurement -------------------------------------------------------

const SANE = (h: number) => h > 0.2 && h < 20;
// crown ≈ head joint + a forehead — the client's own constant (avatar.js
// portrait stature), kept IDENTICAL so file and wearer agree on a body
const CROWN = 0.13;

export function measureVrmBytes(bytes: Uint8Array): VrmHeight | null {
  const { json, bin } = parseGlb(bytes);
  const world = worldMatrices(json);
  const hum = humanoid(json);
  const nodes: any[] = json.nodes ?? [];

  // Only scene-reachable meshes measure — same doctrine as geometry.ts: an
  // orphan node (present in the file, attached to nothing) never renders on
  // any client, so letting its leftovers raise the extent would report a
  // height no one can see. The head FORMULA stays scene-independent: bone
  // transforms exist whether or not anything draws.
  const inScene = new Set<number>();
  {
    const stack: number[] = [];
    for (const sc of json.scenes ?? []) for (const r of sc?.nodes ?? []) if (typeof r === "number") stack.push(r);
    while (stack.length) {
      const i = stack.pop()!;
      if (inScene.has(i) || !nodes[i]) continue;
      inScene.add(i);
      for (const c of nodes[i].children ?? []) if (typeof c === "number") stack.push(c);
    }
  }

  let allMinY = Infinity, allMaxY = -Infinity;     // the whole visible file: the box extent
  let bodyMinY = Infinity, bodyMaxY = -Infinity;   // humanoid-weighted vertices only
  const p = [0, 0, 0], jv = [0, 0, 0, 0], wv = [0, 0, 0, 0];

  for (let ni = 0; ni < nodes.length; ni++) {
    if (!inScene.has(ni)) continue;
    const nd = nodes[ni];
    const mesh = json.meshes?.[nd?.mesh];
    if (!mesh) continue;
    const skin = nd.skin != null ? json.skins?.[nd.skin] : null;
    // jointYRow[j] = row 1 of (jointWorld × inverseBind) — stature only needs
    // the Y of the skinned position, so we fold each joint's matrix pair down
    // to the four numbers that produce it
    let jointYRow: Float64Array | null = null;
    let jointIsBody: Uint8Array | null = null;
    if (skin && Array.isArray(skin.joints) && skin.joints.length) {
      const nJ = skin.joints.length;
      const ibmR = skin.inverseBindMatrices != null ? accReader(json, bin, skin.inverseBindMatrices) : null;
      if (skin.inverseBindMatrices != null && !ibmR) continue;   // unreadable IBMs: skip the mesh, fallbacks cover it
      jointYRow = new Float64Array(nJ * 4);
      jointIsBody = new Uint8Array(nJ);
      const ibm = new Array(16).fill(0);
      for (let j = 0; j < nJ; j++) {
        const jn = skin.joints[j];
        const jw = world[jn];
        if (!jw) continue;
        let m = jw;
        if (ibmR) { ibmR(j, ibm); m = matMul(jw, ibm); }
        jointYRow[j * 4] = m[1]; jointYRow[j * 4 + 1] = m[5];
        jointYRow[j * 4 + 2] = m[9]; jointYRow[j * 4 + 3] = m[13];
        jointIsBody[j] = hum?.set.has(jn) ? 1 : 0;
      }
    }
    const nw = world[ni];
    for (const prim of mesh.primitives ?? []) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx == null) continue;
      const posR = accReader(json, bin, posIdx);
      if (!posR) {
        // unreadable positions (a Draco body, a zero-fill base): the
        // accessor's REQUIRED min/max still bound the geometry, so the box
        // gets the declared corners through the node world instead of
        // silence. No body voting — skinning needs real vertices.
        const acc = json.accessors?.[posIdx];
        if (Array.isArray(acc?.min) && Array.isArray(acc?.max) && acc.min.length === 3 && acc.max.length === 3) {
          for (const x of [acc.min[0], acc.max[0]]) for (const y of [acc.min[1], acc.max[1]]) for (const z of [acc.min[2], acc.max[2]]) {
            const wy = nw ? nw[1] * x + nw[5] * y + nw[9] * z + nw[13] : y;
            if (Number.isFinite(wy)) {
              if (wy < allMinY) allMinY = wy;
              if (wy > allMaxY) allMaxY = wy;
            }
          }
        }
        continue;
      }
      const count = json.accessors[posIdx].count ?? 0;
      const jR = jointYRow ? accReader(json, bin, prim.attributes?.JOINTS_0) : null;
      const wR = jointYRow ? accReader(json, bin, prim.attributes?.WEIGHTS_0) : null;
      const skinned = !!(jointYRow && jR && wR);
      for (let i = 0; i < count; i++) {
        posR(i, p);
        let y: number;
        let body = false;
        if (skinned) {
          jR!(i, jv); wR!(i, wv);
          let acc = 0, wsum = 0, strongest = -1, wmax = 0;
          for (let k = 0; k < 4; k++) {
            const w = wv[k];
            if (!(w > 0)) continue;
            const j = jv[k];
            if (j < 0 || j * 4 >= jointYRow!.length) continue;
            acc += w * (jointYRow![j * 4] * p[0] + jointYRow![j * 4 + 1] * p[1] + jointYRow![j * 4 + 2] * p[2] + jointYRow![j * 4 + 3]);
            wsum += w;
            if (w > wmax) { wmax = w; strongest = j; }
          }
          if (wsum > 0) {
            y = acc / wsum;
            body = strongest >= 0 && jointIsBody![strongest] === 1;
          } else {
            y = nw ? nw[1] * p[0] + nw[5] * p[1] + nw[9] * p[2] + nw[13] : p[1];
          }
        } else {
          y = nw ? nw[1] * p[0] + nw[5] * p[1] + nw[9] * p[2] + nw[13] : p[1];
        }
        if (y < allMinY) allMinY = y;
        if (y > allMaxY) allMaxY = y;
        if (body) {
          if (y < bodyMinY) bodyMinY = y;
          if (y > bodyMaxY) bodyMaxY = y;
        }
      }
    }
  }

  const cm = (v: number) => Math.round(v * 100) / 100;
  const box = allMaxY > allMinY ? cm(allMaxY - allMinY) : null;

  // 1. the client's stature formula, verbatim: head joint + forehead. The
  //    browser measures from the scene origin (a conforming VRM stands with
  //    feet on Y=0), so no floor term — parity beats cleverness here.
  if (hum && hum.head >= 0 && world[hum.head]) {
    const est = world[hum.head][13] + CROWN;
    if (SANE(est)) return { h: cm(est), src: "skeleton", box };
  }

  // 2. a humanoid with no head bone (hips-only rigs exist): the bind-pose
  //    extent of the vertices whose strongest weight lands on a humanoid
  //    bone — hair and skirts ride spring joints and don't vote, though a
  //    head-skinned protrusion still would
  const bodyH = bodyMaxY - bodyMinY;
  if (Number.isFinite(bodyH) && SANE(bodyH)) return { h: cm(bodyH), src: "skeleton", box };

  // 3. the box top, labeled as the extent it is — hair, ears and all
  if (box != null && SANE(box)) return { h: box, src: "bbox_extent", box };
  return null;
}

// ---- caching ---------------------------------------------------------------

type SidecarEntry = { v: string; p?: string; h: number | null; src?: HeightSource; box?: number | null };
const memo = new Map<string, { v: string; r: VrmHeight | null }>();
let sidecar: Record<string, SidecarEntry> | null = null;
const sidecarPath = () => join(OPT_DIR, "thumbs", "heights.json");

function loadSidecar(): Record<string, SidecarEntry> {
  if (sidecar) return sidecar;
  try { sidecar = existsSync(sidecarPath()) ? JSON.parse(readFileSync(sidecarPath(), "utf8")) : {}; }
  catch { sidecar = {}; }
  return sidecar!;
}

/** Stature for one roster body, computed from its file when needed. `name`
 *  is the roster name VERBATIM (sanitizing it would let "foo bar" and
 *  "foo_bar" share an entry), `v` the mtime stamp avatarRoster already
 *  minted — same stamp, same meaning: these numbers describe exactly the
 *  bytes that URL serves. A saved entry also carries the file's path and a
 *  hit requires BOTH to match, so a def repointing a name at a different
 *  file re-measures even when the mtimes coincide. A failed parse caches
 *  too, so a broken upload costs one attempt, not one per roster read. */
export function vrmHeightFor(name: string, file: string, v: string): VrmHeight | null {
  const hit = memo.get(file);
  if (hit && hit.v === v) return hit.r;
  const sc = loadSidecar();
  const entry = sc[name];
  if (entry && entry.v === v && entry.p === file) {
    const r = entry.h != null ? { h: entry.h, src: entry.src ?? "skeleton", box: entry.box ?? null } : null;
    memo.set(file, { v, r });
    return r;
  }
  let r: VrmHeight | null = null;
  const t0 = Date.now();
  try { r = measureVrmBytes(readFileSync(file)); }
  catch (err) { console.warn(`[vrmheight] ${name}: unmeasurable — ${String(err).slice(0, 160)}`); }
  memo.set(file, { v, r });
  sc[name] = r ? { v, p: file, h: r.h, src: r.src, box: r.box } : { v, p: file, h: null };
  try {
    mkdirSync(join(OPT_DIR, "thumbs"), { recursive: true });
    atomicWrite(sidecarPath(), JSON.stringify(sc));
  } catch (err) { console.warn(`[vrmheight] sidecar write failed:`, String(err).slice(0, 160)); }
  if (r) console.log(`[vrmheight] ${name}: ${r.h}m ${r.src}${r.box != null ? ` (box ${r.box}m)` : ""} in ${Date.now() - t0}ms`);
  return r;
}
