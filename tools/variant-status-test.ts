// bun tools/variant-status-test.ts — store-variants.ts variantStatus/classifyVariant: every optimization's state for a
// person, read from what the sweep left on disk (owner, 09-24: nothing may fail silently). Marker lines are the CLI's own.
// The LOD arm reads its marker through lodVerdictKind — the SAME reader the route names x-eidoverse-lod with (#205) — so
// the card and the wire cannot disagree. A changed floor or reducer is a new recipe (LOD_GEN, lodRecipeFor): a new
// filename, so an older generation's marker is simply never looked up here; there is no per-kind re-opening any more.
import { classifyVariant, variantStatus, lodVariantPath, ktx2VariantPath, lodRecipeFor, LOD_RECIPE, LOD_MIN_VERTS, KTX2_RECIPE, recipeStamp, sourceSidecar, sourceToken, freshOver, variantSource } from "../server/store-variants.ts";
import { toolsStamp, toolsDigest, toolVersions } from "../server/tools-stamp.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got: unknown) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const fs = (files: Record<string, string>) => ({ exists: (p: string) => p in files, read: (p: string) => files[p] ?? "" });

const O = "/opt/store/abc.glb", L = lodVariantPath(O), K = ktx2VariantPath(O);
const S = `${recipeStamp(LOD_RECIPE)} ${toolsStamp()}`;   // the CLI stamps recipe AND tools (tools-stamp.ts)
const lodLine = (v: string, ms = 12) => `[optimize] lod: ${v} (${ms}ms) ${S} — original stays the only representation`;
const cases: [string, Record<string, string>, string, string | null][] = [
  ["variant on disk → built", { [L]: "" }, "built", null],
  ["too light → not-needed (lodVerdictKind light)", { [`${L}.failed`]: lodLine(`already light (927 verts < ${LOD_MIN_VERTS})`) }, "not-needed", `already light (927 verts < ${LOD_MIN_VERTS})`],
  ["skins → unsupported, reason without the prefix (structural)", { [`${L}.failed`]: lodLine("unsupported: skinned/avatar asset (skins)", 3) }, "unsupported", "skinned/avatar asset (skins)"],
  ["morph targets → unsupported (structural)", { [`${L}.failed`]: lodLine("unsupported: morph targets the reducer cannot prove preserved", 3) }, "unsupported", "morph targets the reducer cannot prove preserved"],
  ["ineffective → refused with its numbers", { [`${L}.failed`]: lodLine("reduction ineffective (20280 -> 13728 verts)", 287) }, "refused", "reduction ineffective (20280 -> 13728 verts)"],
  ["ineffective even permissive → refused with its numbers", { [`${L}.failed`]: lodLine("reduction ineffective (20280 -> 13728 verts, permissive too)", 287) }, "refused", "reduction ineffective (20280 -> 13728 verts, permissive too)"],
  ["preservation failed → refused", { [`${L}.failed`]: lodLine("preservation failed: bounds moved on axis 1") }, "refused", "preservation failed: bounds moved on axis 1"],
  // the GPU gate's refusal (optimize.ts), as the CLI writes it: its ms sits INSIDE the parens
  ["not lighter on the GPU → refused, no log dressing", { [`${L}.failed`]: `[optimize] lod: not lighter on the GPU (textures 1.33 -> 5.33 MB, 912ms) ${S} — original stays the only representation` }, "refused", "not lighter on the GPU (textures 1.33 -> 5.33 MB)"],
  // a LOD mentioning "nothing to" is not the KTX2 arm's content verdict: the LOD grammar is lodVerdictKind's alone
  ["an unclassified LOD marker is refused with its raw reason — never guessed 'not needed'", { [`${L}.failed`]: "[optimize] lod: nothing to see here (5ms) — original stays the only representation" }, "refused", "nothing to see here"],
  ["the reducer's refusal measured with OTHER tools → stale (a new meshoptimizer re-asks it)", { [`${L}.failed`]: lodLine("reduction ineffective (20280 -> 13728 verts, permissive too)", 287).replace(toolsStamp(), toolsStamp(toolsDigest({ ...toolVersions(), meshoptimizer: "9.9.9" }))) }, "stale", "reduction ineffective (20280 -> 13728 verts, permissive too)"],
  ["a content verdict measured with other tools still stands (under the floor is a fact about the file)", { [`${L}.failed`]: lodLine(`already light (927 verts < ${LOD_MIN_VERTS})`).replace(toolsStamp(), "tools=000000000000") }, "not-needed", `already light (927 verts < ${LOD_MIN_VERTS})`],
  ["size gate, OLD recipe → stale (the sweep re-measures)", { [`${L}.failed`]: "[optimize] not smaller (1 -> 2, 5ms) recipe=lod0-old — keeping original" }, "stale", "not smaller (1 -> 2)"],
  ["host could not afford → deferred with why", { [`${L}.deferred`]: "no ktx encoder on this host\n" }, "deferred", "no ktx encoder on this host"],
  ["nothing on disk → pending", {}, "pending", null],
  ["empty marker → refused, never a blank reason", { [`${L}.failed`]: "" }, "refused", "refused (no reason recorded)"],
  ["a warning printed before the verdict is not the reason (the LAST [optimize] line is)", { [`${L}.failed`]: `warn: sharp missing, resizing without it\n${lodLine("reduction ineffective (20280 -> 13728 verts, permissive too)", 287)}` }, "refused", "reduction ineffective (20280 -> 13728 verts, permissive too)"],
];
// KTX2 keeps its byte gate: a current-recipe size verdict still stands as refused
{
  const { exists, read } = fs({ [`${K}.failed`]: `[optimize] not smaller (100 -> 200, 3ms) recipe=${KTX2_RECIPE} ${toolsStamp()} — keeping original` });
  const r = classifyVariant(K, exists, read, KTX2_RECIPE);
  check("KTX2 size verdict, current recipe → refused, no log dressing", r.state === "refused" && r.reason === "not smaller (100 -> 200)", r);
  const n = fs({ [`${K}.failed`]: "[optimize] ktx2: no convertible raster images (12ms) — keeping original" });
  const r2 = classifyVariant(K, n.exists, n.read, KTX2_RECIPE);
  check("KTX2 nothing to convert → not-needed", r2.state === "not-needed", r2);
}
for (const [name, files, state, reason] of cases) {
  const { exists, read } = fs(files);
  const r = classifyVariant(L, exists, read, LOD_RECIPE, { lod: true });
  check(name, r.state === state && r.reason === reason, r);
}
// a forced rebuild refused OVER a built variant: the old bytes still serve, and the card must not say "built"
{
  const { exists, read } = fs({ [K]: "", [`${K}.failed`]: `[optimize] not smaller (100 -> 200, 3ms) recipe=${KTX2_RECIPE} ${toolsStamp()} — keeping original` });
  const r = classifyVariant(K, exists, read, KTX2_RECIPE);
  check("variant + CURRENT-recipe verdict → refused, naming the served variant", r.state === "refused" && r.reason === "rebuild refused (not smaller (100 -> 200)); the earlier variant still serves", r);
  const o = fs({ [K]: "", [`${K}.failed`]: "[optimize] not smaller (100 -> 200, 3ms) recipe=ktx2-old — keeping original" });
  const r2 = classifyVariant(K, o.exists, o.read, KTX2_RECIPE);
  check("variant + an OLDER recipe's verdict → built (a later build succeeded)", r2.state === "built" && r2.reason === null, r2);
}
// the three variants resolve their OWN paths and recipes
{
  const { exists, read } = fs({ [K]: "", "/opt/min/abc.glb.failed": "[optimize] not smaller (10 -> 12, 1ms) — keeping original",
    [`${L}.failed`]: `[optimize] not smaller (10 -> 40, 1ms) recipe=${KTX2_RECIPE} — keeping original` });
  const v = variantStatus(O, "/opt/min", { exists, read });
  check("variantStatus: ktx2 built, min refused (unstamped min verdicts stand), lod stamped with the KTX2 recipe → stale", v.ktx2.state === "built" && v.min.state === "refused" && v.lod.state === "stale", v);
}
// a changed floor / reducer is a NEW filename: the old generation's marker is not what variantStatus reads
{
  const oldL = lodVariantPath(O, lodRecipeFor({ gen: 1, minVerts: 12_000 }));
  const { exists, read } = fs({ [`${oldL}.failed`]: "[optimize] lod: already light (6992 verts < 12000) (302ms) — original stays the only representation" });
  const v = variantStatus(O, "/opt/min", { exists, read });
  check("an older generation's 'already light' is never looked up → the current generation is pending (the sweep asks it)", oldL !== L && v.lod.state === "pending", v.lod);
}
// the LOD verdict passes through lodVerdictKind: the arm is the LOD one only when asked
{
  const { exists, read } = fs({ [`${L}.failed`]: lodLine(`already light (927 verts < ${LOD_MIN_VERTS})`) });
  const v = variantStatus(O, "/opt/min", { exists, read });
  check("variantStatus reads its LOD marker through the LOD grammar (already light → not-needed)", v.lod.state === "not-needed", v.lod);
}
// MUTABLE sources (library models), LEGACY files (no recorded identity — written before freshOver): a variant or a
// verdict NOT newer than the model is stale — the old rule, kept so the change re-sweeps nothing
{
  const SRC = "/lib/eidoverse/assets/models/abc.glb";
  const at: Record<string, number> = { [SRC]: 2000 };
  const mtime = (p: string) => at[p] == null ? null : { size: 7, mtimeMs: at[p] };
  const files = { [L]: "", [K]: "" };
  const { exists, read } = fs(files);
  at[L] = 3000; at[K] = 3000;
  const fresh = variantStatus(O, "/opt/min", { exists, read, source: SRC, stat: mtime, simplifyOf: () => null });
  check("variants NEWER than the library source → built", fresh.lod.state === "built" && fresh.ktx2.state === "built", fresh);
  at[L] = 1000; at[K] = 2000;   // older, and EQUAL (not strictly newer: the sweep would rebuild it)
  const old = variantStatus(O, "/opt/min", { exists, read, source: SRC, stat: mtime, simplifyOf: () => null });
  check("a LOD variant OLDER than the source → stale (the route serves it provisional; the sweep rebuilds it)", old.lod.state === "stale", old.lod);
  check("a ktx2 variant with the SAME mtime as the source → stale (strictly newer, as the sweep)", old.ktx2.state === "stale", old.ktx2);
  const mk = fs({ [`${L}.failed`]: lodLine(`already light (927 verts < ${LOD_MIN_VERTS})`) });
  at[`${L}.failed`] = 1500;
  const vOld = variantStatus(O, "/opt/min", { ...mk, source: SRC, stat: mtime });
  check("a standing verdict OLDER than the source → stale, naming the verdict it no longer stands for",
    vOld.lod.state === "stale" && vOld.lod.reason === `the model changed after this verdict: already light (927 verts < ${LOD_MIN_VERTS})`, vOld.lod);
  at[`${L}.failed`] = 2500;
  const vNew = variantStatus(O, "/opt/min", { ...mk, source: SRC, stat: mtime });
  check("…and NEWER than the source → it stands (not-needed)", vNew.lod.state === "not-needed", vNew.lod);
  const store = variantStatus(O, "/opt/min", { ...mk, stat: () => ({ size: 7, mtimeMs: 0 }) });
  check("a store upload passes no source (content-addressed): an ancient marker still stands", store.lod.state === "not-needed", store.lod);
  // a forced rebuild's refusal over a built variant must ALSO be newer than the source to count as the current answer
  const rb = fs({ [K]: "", [`${K}.failed`]: `[optimize] not smaller (100 -> 200, 3ms) recipe=${KTX2_RECIPE} ${toolsStamp()} — keeping original` });
  at[K] = 3000; at[`${K}.failed`] = 1000;
  const r = classifyVariant(K, rb.exists, rb.read, KTX2_RECIPE, { source: SRC, stat: mtime });
  check("variant fresh + a verdict older than the source beside it → built (that refusal judged an older model)", r.state === "built", r);
}
// RECORDED identity (store-variants.ts freshOver): fresh iff what the pump recorded EQUALS the source now — order is
// never consulted. The two failures of "newer than": a replacement carrying an OLDER mtime (cp -p, rsync -a, tar) kept a
// stale verdict standing; a marker written in the SAME tick as its source read as not-fresh.
{
  const SRC = "/lib/eidoverse/assets/models/abc.glb";
  const id = { size: 4242, mtimeMs: 1727500000123.4567 };
  const st: Record<string, { size: number; mtimeMs: number }> = { [SRC]: id, [K]: { size: 1, mtimeMs: id.mtimeMs + 9e6 } };
  const stat = (p: string) => st[p] ?? null;
  const lightMarker = `${lodLine(`already light (927 verts < ${LOD_MIN_VERTS})`)}\n${sourceToken(id)}`;
  const files: Record<string, string> = { [K]: "", [sourceSidecar(K)]: JSON.stringify(id), [`${L}.failed`]: lightMarker };
  const { exists, read } = fs(files);
  st[`${L}.failed`] = { size: 1, mtimeMs: id.mtimeMs };   // the SAME tick as the source
  const same = variantStatus(O, "/opt/min", { exists, read, source: SRC, stat, simplifyOf: () => null });
  check("identity recorded = the source's → the ktx2 variant is built", same.ktx2.state === "built", same.ktx2);
  check("…and a verdict written in the SAME mtime tick as its source stands (not-needed) — equality, not order", same.lod.state === "not-needed", same.lod);
  st[SRC] = { size: 5000, mtimeMs: id.mtimeMs - 86_400_000 };   // replaced by a DIFFERENT file carrying an older mtime (cp -p)
  const cp = variantStatus(O, "/opt/min", { exists, read, source: SRC, stat, simplifyOf: () => null });
  check("source replaced by a file with an OLDER mtime → the variant is stale (it is newer, but about another file)", cp.ktx2.state === "stale", cp.ktx2);
  check("…and so is the verdict", cp.lod.state === "stale", cp.lod);
  st[SRC] = { size: id.size, mtimeMs: id.mtimeMs + 1 };   // same size, touched
  check("same size, another mtime → stale (the stat tuple, both fields)", variantStatus(O, "/opt/min", { exists, read, source: SRC, stat, simplifyOf: () => null }).ktx2.state === "stale", null);
  st[SRC] = { size: id.size + 1, mtimeMs: id.mtimeMs };   // same mtime, another size
  check("same mtime, another size → stale", variantStatus(O, "/opt/min", { exists, read, source: SRC, stat, simplifyOf: () => null }).ktx2.state === "stale", null);
  // the recorded identity wins over the legacy order in BOTH directions: an old-mtime variant about THIS source is fresh
  st[SRC] = id; st[K] = { size: 1, mtimeMs: id.mtimeMs - 5000 };
  check("a variant with an OLDER mtime than the source but recording its identity → built (a restore, a copy)",
    variantStatus(O, "/opt/min", { exists, read, source: SRC, stat, simplifyOf: () => null }).ktx2.state === "built", null);
  check("freshOver: a source that is gone is fresh for nothing", !freshOver(K, "/lib/gone.glb", { read, stat }), null);
  check("freshOver: no source (content-addressed) is always fresh", freshOver(K, null, { read, stat: () => null }), null);
}
// which file a verdict is ABOUT: the one the sweep builds from — never the /library route's OPT mirror or PATCH copy
{
  const dirs = { opt: "/nonexistent-opt", library: "/lib" };
  check("variantSource: a library GLB → the LIBRARY file", variantSource("eidoverse/assets/models/a.glb", dirs) === "/lib/eidoverse/assets/models/a.glb", variantSource("eidoverse/assets/models/a.glb", dirs));
  check("variantSource: a store hash → null (content-addressed)", variantSource("store/abc.glb", dirs) === null, variantSource("store/abc.glb", dirs));
  check("variantSource: a VRM with no overlay copy → the library file", variantSource("eidoverse/assets/vrms/b.vrm", dirs) === "/lib/eidoverse/assets/vrms/b.vrm", null);
  check("variantSource: a rel escaping the tree names no file", variantSource("../../etc/passwd.glb", dirs) === "", variantSource("../../etc/passwd.glb", dirs));
}
// a Permissive LOD serves, but the hover says how it was made; an ordinary one says nothing
{
  const { exists, read } = fs({ [L]: "" });
  const perm = variantStatus(O, "/opt/min", { exists, read, simplifyOf: (p) => p === L ? "permissive" : null });
  check("a Permissive LOD reads built, and its reason names the seam collapse", perm.lod.state === "built" && perm.lod.reason === "permissive: collapsed across UV seams", perm.lod);
  const plain = variantStatus(O, "/opt/min", { exists, read, simplifyOf: () => null });
  check("…an ordinary LOD reads built with no reason", plain.lod.state === "built" && plain.lod.reason === null, plain.lod);
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
