// vrmheight-test — the file-side stature measure (server/vrmheight.ts).
//
// Recipe:  OPT_DIR=$(mktemp -d) bun run tools/vrmheight-test.ts
// (OPT_DIR is set by the test itself when absent; no sequencer needed.)
//
// The VRMs are synthesized in memory: a two-bone rig (hips at 0.9, head at
// 1.37 world) wearing a skinned triangle whose third vertex is a 2.2m
// "tentacle" weighted 100% to the Head bone — the real-world case (the
// default claude.vrm) that rules out every mesh-extent method and makes the
// client's head-joint formula the measurement of record. Cases cover both
// humanoid dialects (VRMC_vrm map, VRM 0.x array), the headless-rig vertex
// fallback, the bbox_extent fallback, the unmeasurable refusal, and the
// vrmHeightFor cache (sidecar hit, version-bump recompute).

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OPT_DIR ??= mkdtempSync(join(tmpdir(), "vrmheight-opt-"));
const { measureVrmBytes, vrmHeightFor } = await import("../server/vrmheight.ts");

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

// ---- a minimal GLB container, the inverse of glbparse.parseGlb ------------
function glb(json: any, bin: Uint8Array): Uint8Array {
  const je = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (je.length % 4)) % 4, bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + je.length + jpad + (bin.length ? 8 + bin.length + bpad : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, je.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(je, 20);
  for (let i = 0; i < jpad; i++) out[20 + je.length + i] = 0x20;
  if (bin.length) {
    const o = 20 + je.length + jpad;
    dv.setUint32(o, bin.length + bpad, true); dv.setUint32(o + 4, 0x004e4942, true);
    out.set(bin, o + 8);
  }
  return out;
}

// ---- the shared rig: hips(world 0.9) → head(world 1.37), one skinned tri --
// Vertices sit in bind-pose world space and the IBMs are exact inverses of
// the joint worlds, so skinning is the identity — what a conforming VRM is.
const translate = (y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, y, 0, 1];
function rigged(humanoidExt: Record<string, unknown>): Uint8Array {
  const pos = new Float32Array([0, 0, 0, 0.2, 1.3, 0, 0, 2.2, 0]);     // foot, shoulder, tentacle tip
  const joints = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]); // VEC4 ubyte: hips, hips, HEAD
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const ibm = new Float32Array([...translate(-0.9), ...translate(-1.37)]);
  const bin = new Uint8Array(pos.byteLength + 12 + weights.byteLength + ibm.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(joints, 36);
  bin.set(new Uint8Array(weights.buffer), 48);
  bin.set(new Uint8Array(ibm.buffer), 96);
  return glb({
    asset: { version: "2.0" },
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: "hips", translation: [0, 0.9, 0], children: [1] },
      { name: "head", translation: [0, 0.47, 0] },
      { name: "body", mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0, 1], inverseBindMatrices: 3 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [0.2, 2.2, 0] },
      { bufferView: 1, componentType: 5121, count: 3, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: 2, type: "MAT4" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 12 },
      { buffer: 0, byteOffset: 48, byteLength: 48 },
      { buffer: 0, byteOffset: 96, byteLength: 128 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    extensions: humanoidExt,
  }, bin);
}

// 1. VRM 1.0: stature = head joint (1.37) + 0.13 forehead; the 2.2m
//    head-weighted tentacle inflates only the box
check("vrm1: head formula beats the tentacle",
  measureVrmBytes(rigged({ VRMC_vrm: { specVersion: "1.0", humanoid: { humanBones: { hips: { node: 0 }, head: { node: 1 } } } } })),
  { h: 1.5, src: "skeleton", box: 2.2 });

// 2. VRM 0.x: the array dialect lands on the same number
check("vrm0: array humanBones, same stature",
  measureVrmBytes(rigged({ VRM: { specVersion: "0.0", humanoid: { humanBones: [{ bone: "hips", node: 0 }, { bone: "head", node: 1 }] } } })),
  { h: 1.5, src: "skeleton", box: 2.2 });

// 3. a humanoid with no head bone: the vertex fallback — only vertices whose
//    strongest weight lands on a humanoid bone vote, so the head-weighted
//    tentacle (head is a node here, but not a listed humanoid bone) is out:
//    foot 0 → shoulder 1.3
check("headless rig: humanoid-weighted vertex extent",
  measureVrmBytes(rigged({ VRMC_vrm: { specVersion: "1.0", humanoid: { humanBones: { hips: { node: 0 } } } } })),
  { h: 1.3, src: "skeleton", box: 2.2 });

// 4. not a VRM at all: the box, labeled as the extent it is
const plainBin = new Uint8Array(new Float32Array([0, 0, 0, 0, 1.8, 0, 0.3, 0.2, 0]).buffer);
const plain = glb({
  asset: { version: "2.0" }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [0.3, 1.8, 0] }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
  buffers: [{ byteLength: 36 }],
}, plainBin);
check("plain glb: bbox_extent", measureVrmBytes(plain), { h: 1.8, src: "bbox_extent", box: 1.8 });

// 5. nothing to measure: refusal, not a guess
check("empty glb: null", measureVrmBytes(glb({ asset: { version: "2.0" } }, new Uint8Array(0))), null);

// ---- vrmHeightFor: cache + sidecar ----------------------------------------
const dir = mkdtempSync(join(tmpdir(), "vrmheight-files-"));
const file = join(dir, "t.vrm");
writeFileSync(file, rigged({ VRMC_vrm: { specVersion: "1.0", humanoid: { humanBones: { hips: { node: 0 }, head: { node: 1 } } } } }));

check("vrmHeightFor: first read measures", vrmHeightFor("t", file, "v1"), { h: 1.5, src: "skeleton", box: 2.2 });
writeFileSync(file, plain);   // bytes change under the SAME version stamp…
check("vrmHeightFor: same v serves the cache", vrmHeightFor("t", file, "v1"), { h: 1.5, src: "skeleton", box: 2.2 });
check("vrmHeightFor: new v re-measures", vrmHeightFor("t", file, "v2"), { h: 1.8, src: "bbox_extent", box: 1.8 });
const sidecar = JSON.parse(await Bun.file(join(process.env.OPT_DIR!, "thumbs", "heights.json")).text());
check("sidecar persists the latest verdict", sidecar.t, { v: "v2", h: 1.8, src: "bbox_extent", box: 1.8 });
writeFileSync(file, "not a glb");
check("vrmHeightFor: broken file is null, once", vrmHeightFor("t", file, "v3"), null);
check("vrmHeightFor: the failure is cached too", vrmHeightFor("t", file, "v3"), null);

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
