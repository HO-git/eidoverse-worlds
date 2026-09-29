// bun tools/lod-budget-test.ts — the LOD's screen-space budget (gen 3): geometry error and texture size both follow
// from the closest distance the client shows the LOD (shared/lod-distance.js) at a headset's pixel density.
//   - lodBudget: the error is 2 px there, in world metres, off the model's WORLD diagonal (node scale included);
//   - lodTexelCaps: each texture keeps the texels that distance can resolve, from its own UV texel density;
//     a texture it cannot measure (KHR_texture_transform) keeps the house cap; an extension texture follows its
//     material's measured cap.
//   - the bounds gate: a silhouette moved by less than the budget passes (a 1 m prop: 2 cm gate, 4 cm budget); one
//     moved by twice the budget is still refused;
//   - a texture-only LOD: vertices stuck over 0.6×, but textures at ≤ LOD_TEX_ONLY of the full tier → served (needs the
//     real KTX2 encoder; without one the check FAILS, never a silent pass).
// Mutations witnessed red: texelsPerMetre → Infinity in lodTexelCaps (every cap back to the house cap); the node's
// scale ignored in lodBudget (the world diagonal read from raw positions); the budget dropped from the bounds gate's
// tolerance (the 2.5 cm push refused); the gate's box read from raw positions, node transforms ignored (the cm model refused); the texture-only branch
// disabled (the 1024² field refused as ineffective).
import { Document } from "@gltf-transform/core";
import { KHRTextureTransform, KHRMaterialsSpecular } from "@gltf-transform/extensions";
import { NodeIO } from "@gltf-transform/core";
import { lodBudget, lodTexelCaps, optimizeGlbLod, findKtx2Encoder } from "../server/optimize.ts";
import sharp from "sharp";
import { lodNearest } from "../shared/lod-distance.js";
import { LOD_PX, LOD_PPD, LOD_TEXELS_PER_PX, LOD_TEX_ONLY, KTX2_TEXEL_CAP } from "../server/store-variants.ts";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d: unknown = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${n}${ok ? "" : `  ${JSON.stringify(d)}`}`); };

/** A PNG header is all getSize() reads: the IHDR width/height. */
function pngHeader(w: number, h: number) {
  const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer); dv.setUint32(16, w); dv.setUint32(20, h); return b;
}
/** A flat quad `side` metres square (drawn at node scale `scale`), UV 0..1 over a `tex`² base-colour map. */
function quad(side: number, tex: number, { scale = 1, transform = false, specular = false } = {}) {
  const doc = new Document(); const buf = doc.createBuffer(); const s = side / scale;
  const P = new Float32Array([0, 0, 0, s, 0, 0, s, 0, s, 0, 0, s]), T = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const t = doc.createTexture("base").setImage(pngHeader(tex, tex)).setMimeType("image/png");
  const m = doc.createMaterial("m").setBaseColorTexture(t);
  if (transform) m.getBaseColorTextureInfo()!.setExtension("KHR_texture_transform", doc.createExtension(KHRTextureTransform).createTransform().setScale([4, 4]));
  let spec = null;
  if (specular) {
    spec = doc.createTexture("spec").setImage(pngHeader(tex, tex)).setMimeType("image/png");
    m.setExtension("KHR_materials_specular", doc.createExtension(KHRMaterialsSpecular).createSpecular().setSpecularTexture(spec));
  }
  const prim = doc.createPrimitive().setMaterial(m)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(P).setBuffer(buf))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(T).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 2, 1, 0, 3, 2])).setBuffer(buf));
  doc.createScene().addChild(doc.createNode("q").setScale([scale, scale, scale]).setMesh(doc.createMesh("q").addPrimitive(prim)));
  return { doc, t, spec };
}
const pxPerMetre = (side: number) => (LOD_PPD * 180 / Math.PI) / lodNearest(Math.hypot(side, 0, side));

// geometry: the budget is 2 px at lodNearest, world metres, and node scale counts
{
  const { doc } = quad(2, 1024), b = lodBudget(doc);
  check("the budget's distance is the client's lodNearest of the world diagonal", Math.abs(b.nearest - lodNearest(Math.hypot(2, 0, 2))) < 1e-9, b);
  check(`the geometry error is ${LOD_PX} px there, in metres`, Math.abs(b.errWorld - LOD_PX / pxPerMetre(2)) < 1e-9, b.errWorld);
  const scaled = lodBudget(quad(2, 1024, { scale: 100 }).doc);   // positions 0.02 m under a 100× node: the same 2 m quad
  check("a model authored in other units (node scale) gets the same world budget", Math.abs(scaled.errWorld - b.errWorld) < 1e-9 && Math.abs(scaled.diag - b.diag) < 1e-6, { scaled, b });
}
// textures: sized to what the closest distance resolves
{
  const { doc, t } = quad(2, 1024), b = lodBudget(doc);
  const need = 1024 * (LOD_TEXELS_PER_PX * pxPerMetre(2)) / 512;   // 1024 texels over 2 m = 512 texels/m
  const want = 2 ** Math.ceil(Math.log2(need));
  const cap = lodTexelCaps(doc, b.texelsPerMetre).get(t);
  check(`a 2 m prop's 1024² map drops to what ${lodNearest(Math.hypot(2, 0, 2)).toFixed(0)} m resolves (${want}), not the house cap`, cap === want && want < KTX2_TEXEL_CAP, { cap, need });
  const big = quad(40, 1024), bb = lodBudget(big.doc);
  check("a 40 m wall's 1024² map is already under what its distance resolves: it keeps the house cap", lodTexelCaps(big.doc, bb.texelsPerMetre).get(big.t) === KTX2_TEXEL_CAP);
  const tiny = quad(0.05, 1024), tb = lodBudget(tiny.doc);
  check("never below 64", lodTexelCaps(tiny.doc, tb.texelsPerMetre).get(tiny.t) === 64);
  const tr = quad(2, 1024, { transform: true });
  check("a texture under KHR_texture_transform is not measured: no cap, the house cap applies", !lodTexelCaps(tr.doc, lodBudget(tr.doc).texelsPerMetre).has(tr.t));
  const sp = quad(2, 1024, { specular: true }), caps = lodTexelCaps(sp.doc, lodBudget(sp.doc).texelsPerMetre);
  check("an extension texture (KHR_materials_specular) follows its material's measured cap", caps.get(sp.spec!) === caps.get(sp.t) && caps.get(sp.t) === want, [...caps.values()]);
}
// the bounds gate, through optimizeGlbLod's mutation seam: a 0.5 m sphere (budget ~3.9 cm; 2% of its extent is 1 cm)
// reduces, then its outermost +x vertex is pushed further out by `push` metres
async function sphereGlb(unit: number) {   // unit: positions authored at 1/unit metres, drawn under a 1/unit node
  const doc = new Document(); const buf = doc.createBuffer(); const P: number[] = [], I: number[] = [];
  const seg = 48, ring = 32, rad = 0.25 * unit;
  for (let r = 0; r <= ring; r++) for (let q = 0; q <= seg; q++) { const th = (r / ring) * Math.PI, ph = (q / seg) * Math.PI * 2;
    P.push(rad * Math.sin(th) * Math.cos(ph), rad * Math.cos(th), rad * Math.sin(th) * Math.sin(ph)); }
  for (let r = 0; r < ring; r++) for (let q = 0; q < seg; q++) { const a = r * (seg + 1) + q, b = a + seg + 1; if (r > 0) I.push(a, a + 1, b); if (r < ring - 1) I.push(a + 1, b + 1, b); }
  const prim = doc.createPrimitive().setMaterial(doc.createMaterial("m"))
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(P)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(I)).setBuffer(buf));
  doc.createScene().addChild(doc.createNode("s").setScale([1 / unit, 1 / unit, 1 / unit]).setMesh(doc.createMesh("s").addPrimitive(prim)));
  return new NodeIO().writeBinary(doc);
}
{
  const src = await sphereGlb(1);
  const push = (d: number) => (dd: Document) => {
    for (const m of dd.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const pos = p.getAttribute("POSITION")!; let best = 0; const e = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) if (pos.getElement(i, e)[0] > pos.getElement(best, [0, 0, 0])[0]) best = i;
      pos.getElement(best, e); e[0] += d; pos.setElement(best, e);
    }
  };
  const inBudget = await optimizeGlbLod(src, null, push(0.025));
  check("a 2.5 cm silhouette shift on a 0.5 m prop — over the old 1 cm gate, under the ~3.9 cm budget — is served", !!inBudget.out, { kind: inBudget.kind, verdict: inBudget.verdict });
  const spike = await optimizeGlbLod(src, null, push(0.08));
  check("an 8 cm shift, twice the budget, is still refused as a preservation failure", !spike.out && spike.kind === "preservation", { kind: spike.kind, verdict: spike.verdict });
  // the gate is WORLD space: the same sphere authored in centimetres under a 0.01 node, pushed 2.5 local units (2.5 cm)
  // — a raw-POSITION box reads 2.5 units against its 2% floor of 1 unit and refuses it
  const cm = await sphereGlb(100);
  const cmIn = await optimizeGlbLod(cm, null, push(2.5));
  check("…and it is judged in WORLD space: the same 2.5 cm push on a model authored in cm under a 0.01 node is served", !!cmIn.out, { kind: cmIn.kind, verdict: cmIn.verdict });
  const cmOut = await optimizeGlbLod(cm, null, push(8));
  check("…as is its 8 cm refusal", !cmOut.out && cmOut.kind === "preservation", { kind: cmOut.kind });
}
// texture-only: a faceted jagged 6 m field (every vertex on a hard edge — its vertices can't come under 0.6×) with a
// base-colour map. 1024² over 6 m is ~170 texels/m against the ~37 its LOD distance resolves → 256², 1/16 of the
// memory: served for its textures. The same field at 64² has nothing to give (the floor): refused as ineffective.
{
  const enc = findKtx2Encoder();
  check("(setup) a KTX2 encoder on this host — the texture-only checks need the real encoder", !!enc, null);
  async function field(texSize: number) {
    const n = 40, F = 6; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const grid: number[][] = [];
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) grid.push([F * x / n, F * (rnd() - 0.5) * 1.6 / n, F * z / n]);
    const P: number[] = [], N: number[] = [], T: number[] = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x, b = a + n + 1;
      for (const tri of [[a, b, a + 1], [a + 1, b, b + 1]]) {
        const [p, q, r] = tri.map((i) => grid[i]);
        const e1 = q.map((v, k) => v - p[k]), e2 = r.map((v, k) => v - p[k]);
        const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...fn) || 1;
        for (const i of tri) { P.push(...grid[i]); N.push(...fn.map((v) => -v / l)); T.push(grid[i][0] / F, grid[i][2] / F); }
      }
    }
    const doc = new Document(); const buf = doc.createBuffer();
    // noise, not a flat colour: prune() folds a solid-colour texture into its material factor and the map is gone
    const px = new Uint8Array(texSize * texSize * 3).map(() => Math.floor(rnd() * 256));
    const png = new Uint8Array(await sharp(px, { raw: { width: texSize, height: texSize, channels: 3 } }).png().toBuffer());
    const m = doc.createMaterial("m").setBaseColorTexture(doc.createTexture("t").setImage(png).setMimeType("image/png"));
    const prim = doc.createPrimitive().setMaterial(m)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(P)).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(N)).setBuffer(buf))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(T)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(P.length / 3).map((_, i) => i)).setBuffer(buf));
    doc.createScene().addChild(doc.createNode("f").setMesh(doc.createMesh("f").addPrimitive(prim)));
    return new NodeIO().writeBinary(doc);
  }
  if (enc) {
    const big = await optimizeGlbLod(await field(1024), enc);
    check("a 1024²-textured field whose vertices stay over 0.6× is served as a TEXTURE-ONLY LOD", !!big.out && big.texOnly === true && big.after > big.before * 0.6 && (big.texRatio ?? 1) <= LOD_TEX_ONLY,
      { kind: big.kind, verdict: big.verdict, before: big.before, after: big.after, texRatio: big.texRatio });
    const small = await optimizeGlbLod(await field(64), enc);
    check("…and the same field at 64², with nothing to give, is refused as ineffective", !small.out && small.kind === "ineffective", { kind: small.kind, texRatio: small.texRatio });
  }
}
console.log(`${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m`); process.exit(fail ? 1 : 0);
