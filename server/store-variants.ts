// store-variants — the store's serving shadows, named in one place.
//
// A store upload (content-addressed: assets/opt/store/<hash>.glb, immutable)
// gets TWO shadows, both built off the request path by upload.ts's serial
// optimize pump and both served by routes.ts on the ORIGINAL's address:
//
//   store-min/<hash>.glb        draco + webp@1024 — the unflagged answer, what
//                               every client without a KTX2 decoder gets
//   store/<hash>.glb.ktx2.glb   draco + KTX2 (the §20a diet) — the ?ktx2=<key>
//                               answer, beside the original exactly like every
//                               library variant (OPT_DIR/<rel>.ktx2.glb), which
//                               is the path the /library route already resolves
//
// The second shadow is what this module gives a name to. Before it, a KTX2-
// capable client asking for a store upload fell through to store-min: webp
// decodes to full RGBA8 on the GPU (a 1024² map with mips is ~5.3MB of VRAM)
// where KTX2 stays block-compressed (~1.4MB) and skips createImageBitmap
// entirely (§20: 1.0–1.2s/GLB of decode, 4–8× the VRAM). The library got that
// variant on day one; the conjured props that actually fill a world never did
// (#122's own evidence: store/305ea…glb?ktx2=1 → "draco + webp, and no KTX2
// at all").
//
// Beside-the-original carries the ghost-listing obligation (§20c): the variant
// ends in .glb too, so every place that enumerates store/*.glb — the catalog,
// the boot sweep — asks isStoreOriginal, never endsWith(".glb"); and every
// place that LISTS the opt tree (/library-list, which the prefetcher warms
// from) skips isKtx2Variant, or each variant is downloaded a second time under
// its own name.
//
// And one serving rule, in routes.ts: a flagged fetch (?ktx2=<key>, the key
// being shared/ktx2.js's — a generation, rotated when a flagged answer has
// been pinned wrong, as it had been under =1) that falls
// through to the webp shadow is PROVISIONAL for that URL — served no-cache,
// never immutable — because the variant may still be encoding, or the box may
// have no encoder yet. Content-addressed makes the ADDRESS immutable, not the
// flagged answer; pinned for a year, the variant never reaches that cache.
//
// DOM-free and side-effect-free: unit-tested in tools/store-variants-test.ts.

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/** The variant suffix. `<hash>.glb` + this = the KTX2 shadow's file name. */
export const KTX2_SUFFIX = ".ktx2.glb";

// ---- the texel budget ------------------------------------------------------
// The unflagged answer — the webp shadow every client without a KTX2 decoder
// gets — is capped at 1024² (optimize.ts, `resize: [1024, 1024]`; the
// library's day-one mirror is "draco+webp@1024" too). That is the house
// budget: what a model is allowed to look like in this world. The KTX2 arm
// used to encode from the full-resolution source instead — a Tripo conjure's
// 2048² maps, three of them, two UASTC — and the "variant" came out 1.5× the
// ORIGINAL on the wire (the show box, 2026-08-25: `not smaller (17600988 ->
// 26716692)`, sixteen times over), which the size gate rightly refused. A
// flagged fetch was a silent quality UPGRADE over the unflagged one at ~13×
// the bytes of the webp shadow. So: same budget as the shadow, GPU-native —
// downscale (never up) so the longest side is KTX2_TEXEL_CAP, 4-aligned for
// the block format. toktx does it (--resize) and libvips never touches it.
export const KTX2_TEXEL_CAP = 1024;

/** The resize a texture of `size` needs to fit the budget, or null when it
 *  already does. Aspect kept; both sides rounded to a multiple of 4. */
export function capTexels(size: [number, number] | null | undefined, cap = KTX2_TEXEL_CAP): [number, number] | null {
  if (!size || !(size[0] > 0) || !(size[1] > 0)) return null;
  const [w, h] = size;
  if (w <= cap && h <= cap) return null;
  const k = cap / Math.max(w, h);
  const r = (v: number) => Math.max(4, Math.round((v * k) / 4) * 4);
  return [r(w), r(h)];
}

// A size-gate verdict (`.failed` = "not smaller") is only as durable as the
// RECIPE that produced it: change the recipe and every refusal is a question
// again. So the CLI stamps the recipe into the verdict, and the sweeps treat
// a size verdict without the CURRENT stamp as stale — re-measured once, then
// re-stamped. The sixteen refusals above get retried the first boot after
// this lands, with no operator step. Content verdicts ("no convertible raster
// images", a corrupt container) carry no stamp and stand.
export const KTX2_RECIPE = "texel1024";
export const recipeStamp = (recipe = KTX2_RECIPE) => `recipe=${recipe}`;
/** Does `content` carry the stamp for exactly `recipe`? Delimited, never a
 *  prefix: `recipe=…-min12000` must not answer for `…-min120000` (a marker
 *  written by a newer CLI into a filename the older running server chose,
 *  in a pull-before-restart window). */
export const hasStamp = (content: string, recipe: string) =>
  new RegExp(`(^|\\s)${recipeStamp(recipe).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(content);

// ---- the geometry LOD (objects only — v1 contract, PR #142 thread) ---------
// A far or VRAM-pressed client can ask for a decimated variant of a PLACEABLE
// OBJECT: `<rel>.lod1.glb` beside the original — weld + meshopt-simplify
// (the avatar importer's own proven diet) at LOD_RATIO, textures at the
// ktx2 texel budget, draco. BODIES ARE OUT OF SCOPE AND FAIL CLOSED, by
// positive structural detection, never filename folklore: skins / joint
// weights, VRM metadata, morph targets, morph-weight animation channels —
// any of them means NO variant and a typed verdict ("unsupported: skinned/
// avatar asset"), the original staying the only served representation. The
// variant binds its identity in asset.extras: source sha256 + this recipe +
// exact tool versions. Named nodes, materials, and bounds are asserted
// unchanged after the reduce — a failed assert is a typed verdict too, not
// a half-valid object.
// the REDUCER's generation: bump when weld/simplify semantics, the gates, or the tool change. 2 = the Permissive retry
// (optimize.ts reduce: one Permissive pass when UV seams lock the regular one), the GPU gate (a LOD is refused if its
// textures cost MORE GPU memory than the original's — it replaced the byte gate), and the texel cap honoured on
// ktx-create hosts (gen-1 LODs built there were 2048² under a texel1024 name).
export const LOD_GEN = 2;
export const LOD_RATIO = 0.25;      // meshopt-simplify target ratio
export const LOD_ERROR = 0.01;      // meshopt-simplify error bound
// under this, there is nothing worth reducing. Was 12,000; owner, 09-24: "we can totally build LODs even for simple
// objects … I WANT to have worlds with thousands of objects" — a 7k-vert desk × 1,000 is 7M verts. Below ~1k a LOD
// saves less than its own fetch; the "ineffective" gate still refuses what cannot reduce.
export const LOD_MIN_VERTS = 1_000;

/** The recipe string DERIVES from every parameter a variant or a verdict
 *  depends on — the reducer generation, ratio, error, the texel budget, and
 *  the vertex floor. The recipe is in the URL and in every filename, so a
 *  change to any of these is a new generation BY CONSTRUCTION: fresh
 *  filenames, a fresh sweep, and nothing pinned under yesterday's address.
 *  The floor used to live only inside the marker's text: lowering it under
 *  the same string would have left every "already light" verdict standing
 *  and the sweep skipping exactly the models the change was for. */
export function lodRecipeFor({ gen = LOD_GEN, ratio = LOD_RATIO, error = LOD_ERROR, texel = KTX2_TEXEL_CAP, minVerts = LOD_MIN_VERTS } = {}): string {
  // the fraction's own decimal digits, every one of them — 0.25 → 25, 0.01 →
  // 01, 0.014 → 014: two settings the reducer tells apart must never share a
  // string (a rounded percent read 0.014 as 0.01, and the sweep would have
  // skipped every existing file under the unchanged address)
  const frac = (x: number, what: string) => {
    const s = x.toString();
    if (!(x > 0 && x < 1) || !/^0\.\d+$/.test(s)) throw new Error(`lod ${what} must be a plain decimal in (0, 1): ${s}`);
    return s.slice(2);
  };
  if (!Number.isInteger(texel) || !Number.isInteger(minVerts) || !Number.isInteger(gen)) throw new Error("lod gen/texel/minVerts must be integers");
  return `lod${gen}-r${frac(ratio, "ratio")}e${frac(error, "error")}-texel${texel}-min${minVerts}`;
}
export const LOD_RECIPE = lodRecipeFor();   // "lod2-r25e01-texel1024-min1000"

// ---- standing verdicts -------------------------------------------------------
// A flagged fetch that falls through is provisional — the doctrine that keeps
// a later variant from being locked out of a pinned cache entry. But a typed
// refusal is not "not yet": a body is a body, and a 981-vertex prop is under
// the floor, for as long as the content and the recipe are what they are —
// and BOTH are in the URL (a store hash, the recipe). Such a verdict may be
// final: the original is THE answer for this tier, cacheable like the plain
// ktx2 answer. Three classes are not, because they depend on something the
// URL does not carry: "reduction ineffective" and a preservation failure
// depend on the reducer (a better meshoptimizer may succeed tomorrow), and
// the GPU gate ("not lighter on the GPU") on the encoder and the host, so
// they stay provisional until LOD_GEN is bumped for that tool. Anything
// unclassified stays provisional — the safe default.
// "gpu" is the GPU gate's refusal (optimize.ts: the LOD's textures would cost MORE GPU memory than the original's):
// it depends on the encoder and on whether the texel cap could be honoured on this host (sharp presence on a
// ktx-create box) — neither is in the URL — so it is non-final, like "ineffective".
export type LodVerdictKind = "structural" | "light" | "ineffective" | "preservation" | "gpu";
/** Which class of typed refusal a lod `.failed` marker records (the
 *  reducer's phrases, optimize.ts) — or null for anything else. The ONE
 *  reader of that grammar: the route (serve time) and classifyVariant (the
 *  catalog's card) both call it, so the wire and the card cannot disagree. */
export function lodVerdictKind(content: string): LodVerdictKind | null {
  if (/\bunsupported: (skinned\/avatar asset|morph targets|animated object)/i.test(content)) return "structural";
  if (/\balready light \(\d+ verts < \d+\)/i.test(content)) return "light";
  // ", permissive too": the reducer tried the Permissive retry as well (optimize.ts reduce)
  if (/\breduction ineffective \(\d+ -> \d+ verts(, permissive too)?\)/i.test(content)) return "ineffective";
  if (/\bpreservation failed:/i.test(content)) return "preservation";
  if (/\bnot lighter on the GPU \(textures /i.test(content)) return "gpu";
  return null;
}
/** Does this marker make the original the FINAL answer under `recipe`? A
 *  content-only class (structural, light) stamped with the running recipe —
 *  the filename binds the recipe too; the stamp is the belt to that brace. */
export function lodVerdictFinal(content: string, recipe = LOD_RECIPE): boolean {
  const kind = lodVerdictKind(content);
  return (kind === "structural" || kind === "light") && hasStamp(content, recipe);
}

// ---- source identity: freshness by EQUALITY, never by mtime order ------------------------------------------------------
// A variant or a verdict is ABOUT one source file: the one the pump handed the CLI (the LIBRARY model for a library
// asset — the sweep builds from it; the overlay-first VRM for a body). When the pump writes either, it records that
// file's identity as it stood when the pass STARTED; the derived file is fresh iff that recorded identity EQUALS the
// source's identity now. "Marker newer than source" (make-style ordering) was wrong both ways: a replacement that keeps
// or restores an older mtime (cp -p, rsync -a, tar, a sync) kept a stale verdict standing forever, and a marker written
// in the same mtime tick as its source read as not-fresh (the "current verdict stands" flake). The redo / Syncthing
// rule — compare a recorded stat tuple for change — is cheap enough for every request (two stats, one tiny read).
// Identity = size + mtimeMs (the float, exact through String/JSON): a content hash would be read per REQUEST at the
// route, for multi-MB models; the inode would churn on every restore or volume move (a mass re-sweep) and is not stable
// on every filesystem. seats.ts caches its sha256 on the same (size, mtime) pair.
// A derived file with NO recorded identity (written before this rule) keeps the old rule — strictly newer than its
// source — so this lands without re-sweeping anything; the next write records an identity. `source` null = a
// content-addressed original (a store hash): the same bytes forever, so anything derived from it is fresh.
export type SourceIdentity = { size: number; mtimeMs: number };
export type StatFn = (p: string) => SourceIdentity | null;
export const diskIdentity: StatFn = (p) => { try { const s = statSync(p); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } };
/** Where a VARIANT's recorded source identity lives (a verdict marker carries its own, inline). */
export const sourceSidecar = (variant: string) => `${variant}.srcid`;
export const sameIdentity = (a: SourceIdentity | null, b: SourceIdentity | null) => !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;
/** The marker's token for a source identity — its own line, so no reader of the verdict line ever sees it. */
export const sourceToken = (id: SourceIdentity) => `source=${id.size}:${id.mtimeMs}`;
export function parseSourceToken(content: string): SourceIdentity | null {
  const m = /(?:^|\s)source=(\d+):(\d+(?:\.\d+)?)(?:\s|$)/.exec(content);
  return m ? { size: Number(m[1]), mtimeMs: Number(m[2]) } : null;
}
/** The identity a derived file recorded: a `.failed` marker's inline token, a variant's `.srcid` sidecar. */
export function recordedSource(derived: string, read: (p: string) => string): SourceIdentity | null {
  if (derived.endsWith(".failed")) return parseSourceToken(read(derived));
  try {
    const j = JSON.parse(read(sourceSidecar(derived)) || "null");
    return j && Number.isFinite(j.size) && Number.isFinite(j.mtimeMs) ? { size: j.size, mtimeMs: j.mtimeMs } : null;
  } catch { return null; }
}
const readOrEmpty = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
/** THE freshness rule, for the sweep, the pump, the route and the catalog alike. */
export function freshOver(derived: string, source: string | null,
  { read = readOrEmpty, stat = diskIdentity }: { read?: (p: string) => string; stat?: StatFn } = {}): boolean {
  if (source == null) return true;
  const cur = stat(source);
  if (!cur) return false;                     // the source is gone: nothing current to be fresh over
  const rec = recordedSource(derived, read);
  if (rec) return sameIdentity(rec, cur);
  const d = stat(derived);                    // legacy: no identity recorded — the old strictly-newer rule
  return !!d && d.mtimeMs > cur.mtimeMs;
}
/** The source a library/store rel's variants and verdicts are ABOUT — the file the sweep hands the pump, so the route
 *  and the catalog compare against the same file the build read. null = content-addressed (store/). A GLB is built
 *  from the LIBRARY file (the /library route's OPT mirror and PATCH copy are never a build input); a VRM from the
 *  overlay if it has one, else the library (sweepLibrary walks the overlay first). */
export function variantSource(rel: string, dirs: { opt: string; library: string }): string | null {
  if (rel.startsWith("store/")) return null;
  const inside = (base: string) => { const p = join(base, rel); return p.startsWith(base) ? p : null; };
  if (rel.endsWith(".vrm")) {
    const o = inside(dirs.opt);
    if (o && existsSync(o)) return o;
  }
  return inside(dirs.library) ?? "";   // outside the tree: no file, so nothing is fresh over it
}

/** A geometry-LOD serving artifact — ANY recipe generation's, not only the
 *  current one (old generations must stay unlisted and uncatalogued too). */
export function isLodVariant(name: string): boolean {
  return /\.lod\.[a-z0-9.-]+\.glb$/i.test(name);
}

/** Where the LOD shadow of an original lives: beside it, like the KTX2 one —
 *  and the RECIPE IS IN THE NAME, exactly as it is in the URL (review of
 *  #156, point 1): a new recipe is a new file under a new URL, so a recipe
 *  change can never serve yesterday's reduction under today's address. The
 *  old generation's file simply stops being asked for (and the pump deletes
 *  it when the new one lands). */
export function lodVariantPath(original: string, recipe = LOD_RECIPE): string {
  return `${original}.lod.${recipe}.glb`;
}

/** Does a `.failed` verdict still stand under the current recipe? A size
 *  verdict ("not smaller") stands only if it carries the current stamp;
 *  anything else stands regardless. */
export function verdictStands(content: string, recipe = KTX2_RECIPE): boolean {
  if (!/not smaller/i.test(content)) return true;
  return hasStamp(content, recipe);
}

/** Any KTX2 serving artifact, of any asset class: `<rel>.ktx2.glb` (models,
 *  library and store), `<rel>.ktx2.vrm` (bodies, §20c), `<img>.ktx2` (loose
 *  toolkit images, §20d). Reached only through the ORIGINAL's path + the
 *  ?ktx2=<key> negotiation; never a listing entry of its own. */
export function isKtx2Variant(name: string): boolean {
  return /\.ktx2(\.glb|\.vrm)?$/i.test(name);
}

/** Anything the opt tree holds that is not an asset a client addresses by
 *  name: a KTX2 variant, a `.failed` marker (the pump's diagnostic verdict on
 *  a pass), a `.tmp` (a pass mid-write), a `.deferred` (a pass this host
 *  could not afford — upload.ts), a `.srcid` (a variant's recorded source
 *  identity — freshOver). None is a listing entry — the
 *  prefetcher pushes every listed store path as a fetch, and a marker fetched
 *  as a model is a 404 on a good day. */
export function isServingArtifact(name: string): boolean {
  return isKtx2Variant(name) || isLodVariant(name) || /\.(failed|tmp|deferred|srcid)$/i.test(name);
}

/** Is this store/ entry an upload, as opposed to a variant of one? The
 *  predicate every store/*.glb enumeration must use (catalog, boot sweep):
 *  a variant is the SAME model, not a second catalog entry and not a
 *  candidate for its own shadows. */
export function isStoreOriginal(name: string): boolean {
  return name.endsWith(".glb") && !isKtx2Variant(name) && !isLodVariant(name);
}

/** Where the KTX2 shadow of a store original lives: beside it, `<path>.ktx2.glb`
 *  — routes.ts's own resolution for a flagged fetch (`${rel}.ktx2.glb` under
 *  OPT_DIR), so serving needs no change to find it. */
export function ktx2VariantPath(original: string): string {
  return `${original}${KTX2_SUFFIX}`;
}

/** Which shadows a store original still lacks. A `.failed` marker counts as
 *  present — the pass already gave its answer (not smaller / not convertible)
 *  and the sweep must not re-measure it every boot — EXCEPT a KTX2 size
 *  verdict from an older recipe (verdictStands), which is a question again.
 *  `exists`/`read` are injectable for tests; production reads the disk. */
export function storeShadowsMissing(
  original: string,
  minDir: string,
  exists: (p: string) => boolean = existsSync,
  read: (p: string) => string = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } },
): { min: boolean; ktx2: boolean; lod: boolean } {
  const min = join(minDir, basename(original));
  const k = ktx2VariantPath(original);
  const kFailed = `${k}.failed`;
  const l = lodVariantPath(original);
  const lFailed = `${l}.failed`;
  return {
    min: !exists(min) && !exists(`${min}.failed`),
    ktx2: !exists(k) && !(exists(kFailed) && verdictStands(read(kFailed))),
    lod: !exists(l) && !(exists(lFailed) && verdictStands(read(lFailed), LOD_RECIPE)),
  };
}

// ---- status, for people (owner, 09-24: "nothing could silently fail getting LODs") ----------------------------------
// storeShadowsMissing answers the SWEEP's question (is there work left?). This answers a PERSON's: what does each
// optimization look like for this asset, and why. Every `.failed` marker already carries a typed verdict — the only
// thing missing was a way to read it. States:
//   built        the variant exists (serving)
//   not-needed   the pass declined for a correct reason: too light to reduce, nothing to convert
//   unsupported  refused by contract (bodies, animated, morphs — LOD v1, PR #142/#156)
//   refused      the pass ran and its result failed a gate (not smaller, ineffective, preservation, heavier on the
//                GPU) — reason attached
//   stale        a size verdict from an older recipe, or a variant/verdict about a (library) model that has changed
//                since (freshOver): the sweep will re-measure it
//   deferred     this host could not afford the pass (upload.ts `.deferred`)
//   pending      nothing on disk yet: the sweep has not reached it
export type VariantState = "built" | "not-needed" | "unsupported" | "refused" | "stale" | "deferred" | "pending";
export type VariantStatus = { state: VariantState; reason: string | null };

/** Classify one variant from what is on disk beside it. `recipe` is the one its size verdicts are stamped with. */
// the CLI's line: "[optimize] <pass>: <verdict> (<ms>ms) — <tail>" — keep the verdict, drop the log dressing
// the verdict is the LAST "[optimize]" line (the pump logs the same one): a warning printed before it (the no-sharp resize
// note, a gltf-transform logger line) must not become the card's reason
const verdictLine = (raw: string): string => { const ls = raw.split("\n"); return [...ls].reverse().find((l) => /^\[optimize\]/.test(l)) ?? ls[0]; };
const failedReason = (raw: string): string => verdictLine(raw).replace(/^\[optimize\]\s*(?:lod:\s*)?/, "").replace(/\s*\(\d+ms\).*$/, "")
  .replace(/,\s*\d+ms\)/, ")").replace(/\s+—\s+.*$/, "").replace(/\s*recipe=\S+/, "").trim() || "refused (no reason recorded)";

/** How classifyVariant reads one pass. `lod`: the marker is read through lodVerdictKind — the route's own reader of the
 *  reducer's grammar, so the card and the x-eidoverse-lod header name the same verdict. `source`: the MUTABLE file the
 *  pass judges (a library model, variantSource); a variant or a marker not freshOver it is `stale` — the one rule the
 *  sweep, the pump and the route use. Store originals are content-addressed, so they pass no source. `stat` is
 *  injectable for tests (the recorded identity is read through `read`). */
export type ClassifyOpts = { lod?: boolean; source?: string | null; stat?: StatFn };

export function classifyVariant(path: string, exists: (p: string) => boolean, read: (p: string) => string, recipe?: string,
  opts: ClassifyOpts = {}): VariantStatus {
  const fresh = (p: string) => freshOver(p, opts.source ?? null, { read, stat: opts.stat });
  const failed = `${path}.failed`;
  const failedNow = exists(failed);
  if (exists(path)) {
    if (!fresh(path)) return { state: "stale", reason: "the model changed after this variant was built; the sweep rebuilds it" };
    // A CURRENT-recipe verdict beside a variant can only be a forced rebuild that was refused (the pump never runs over
    // one that stands, and ↻ clears it first): the old bytes still serve, and "built" would hide the refusal.
    // An older recipe's verdict beside a variant is just history — a later build succeeded.
    if (failedNow && recipe !== undefined) {
      const raw = read(failed);
      if (verdictStands(raw, recipe) && fresh(failed)) return { state: "refused", reason: `rebuild refused (${failedReason(raw)}); the earlier variant still serves` };
    }
    return { state: "built", reason: null };
  }
  if (failedNow) {
    const raw = read(failed);
    const reason = failedReason(raw);
    if (recipe !== undefined && !verdictStands(raw, recipe)) return { state: "stale", reason };
    if (!fresh(failed)) return { state: "stale", reason: `the model changed after this verdict: ${reason}` };
    if (opts.lod) {
      switch (lodVerdictKind(raw)) {
        case "structural": return { state: "unsupported", reason: reason.replace(/^unsupported:\s*/i, "") };
        case "light": return { state: "not-needed", reason };
        default: return { state: "refused", reason };   // ineffective / preservation / gpu, and anything unclassified
      }
    }
    if (/no convertible|nothing to/i.test(raw)) return { state: "not-needed", reason };
    if (/unsupported:/i.test(raw)) return { state: "unsupported", reason: reason.replace(/^unsupported:\s*/i, "") };
    return { state: "refused", reason };
  }
  if (exists(`${path}.deferred`)) return { state: "deferred", reason: read(`${path}.deferred`).trim().slice(0, 200) || null };
  return { state: "pending", reason: null };
}

/** Every optimization's status for one store/library original. `source` is the mutable file the passes judge (the
 *  LIBRARY model — the one the sweep builds from and compares against); omit it for a content-addressed store upload. */
export function variantStatus(
  original: string,
  minDir: string,
  { exists = existsSync, read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } },
    simplifyOf = lodSimplifyOf, source = null, stat }: {
    exists?: (p: string) => boolean; read?: (p: string) => string; simplifyOf?: (p: string) => string | null;
    source?: string | null; stat?: StatFn;
  } = {},
): { min: VariantStatus; ktx2: VariantStatus; lod: VariantStatus } {
  const lodPath = lodVariantPath(original);
  let lod = classifyVariant(lodPath, exists, read, LOD_RECIPE, { lod: true, source, stat });
  // a Permissive LOD collapsed across UV/normal seams (optimize.ts): it serves, but it may read darker or faceted —
  // say so in the hover rather than let it pass as an ordinary build
  if (lod.state === "built" && simplifyOf(lodPath) === "permissive") lod = { state: "built", reason: "permissive: collapsed across UV seams" };
  return {
    min: classifyVariant(join(minDir, basename(original)), exists, read),
    ktx2: classifyVariant(ktx2VariantPath(original), exists, read, KTX2_RECIPE, { source, stat }),
    lod,
  };
}

const simplifyCache = new Map<string, { key: string; v: string | null }>();
/** asset.extras.simplify of a LOD variant, read from the GLB's JSON chunk only (the catalog asks per card); cached on
 *  (size, mtime). null = absent or unreadable. */
export function lodSimplifyOf(path: string): string | null {
  try {
    const st = statSync(path), key = `${st.size}:${st.mtimeMs}`, hit = simplifyCache.get(path);
    if (hit?.key === key) return hit.v;
    const fd = openSync(path, "r");
    try {
      const head = Buffer.alloc(20); readSync(fd, head, 0, 20, 0);
      let v: string | null = null;
      if (head.readUInt32LE(0) === 0x46546c67 && head.readUInt32LE(16) === 0x4e4f534a) {   // 'glTF', chunk 0 = 'JSON'
        const len = head.readUInt32LE(12), json = Buffer.alloc(len); readSync(fd, json, 0, len, 20);
        const x = JSON.parse(json.toString("utf8"))?.asset?.extras?.simplify; v = typeof x === "string" ? x : null;
      }
      simplifyCache.set(path, { key, v }); return v;
    } finally { closeSync(fd); }
  } catch { return null; }
}
