// syncgate — no pipeline is ever LINKED on the render path (WebGL backend).
//
// three r186's WebGL backend builds a pipeline the first time a frame meets a render object it has no program for, and
// on that path (promises === null) it goes straight to _completeCompile, whose gl.getProgramParameter(LINK_STATUS)
// blocks until the driver has finished linking (three.webgpu.js ~75523/75697). KHR_parallel_shader_compile lets the
// link run off-thread and be POLLED, but three only takes that branch inside compileAsync. Measured on the owner's
// machine 2026-09-24 (a DevTools trace): one
// render-path getProgramParameter held the main thread 54.7 s in the Commons, and the whole browser froze with it.
// Every warm in the client (assets.js, avatar.js, sky.js, warmqueue.js …) exists to keep builds off that path; this is
// the backstop for whatever they miss (a variant change after the warm, a pass nobody pre-compiled).
//
// With the extension present, a render-path build is handed to three's own polling branch. The object is then simply
// not drawn until its program links, by three itself: _renderObjectDirect draws only when Pipelines.isReady(), which
// stays false until _completeCompile sets the pipeline (~65557/33289). It pops in late instead of stopping the world. Without the extension nothing
// changes (there is no way to link without blocking). ?syncgate=0 turns the gate off; the census stays.
//
// The census tees every render-path build that took ≥ SLOW_MS to request (with the gate off, that is the link itself),
// naming object, material and the generated shader sizes — the question the trace could not answer: WHICH material.

const SLOW_MS = 250;
// the world's own pass: no user target bound — or the target three's _renderScene binds for it (its tone-mapping
// framebuffer, isPostProcessingRenderTarget ~63249; the XR eye target in a session). Anything else is someone's target.
const isWorldPass = (rt) => rt === null || !!rt?.isPostProcessingRenderTarget || !!rt?.isXRRenderTarget;
// the nearest named ancestor, with the path length — most three children are anonymous under a named root
const named = (o) => { for (let n = o, d = 0; n && d < 6; n = n.parent, d++) if (n.name) return d ? `${n.name}›${d}` : n.name; return '(unnamed)'; };

export function installSyncGate(renderer, { tee = () => {}, gate = true } = {}) {
  const be = renderer.backend;
  if (!be || be.isWebGPUBackend || be.__syncGate) return null;
  const orig = be.createRenderPipeline?.bind(be);
  if (!orig) return null;
  const stats = { renderPath: 0, deferred: 0, intoTarget: 0, slow: [], parallel: !!be.parallel, gate };
  be.__syncGate = stats;

  be.createRenderPipeline = (renderObject, promises) => {
    if (promises != null) return orig(renderObject, promises);          // compileAsync: three polls already
    stats.renderPath++;
    if (!isWorldPass(renderer.getRenderTarget())) stats.intoTarget++;
    const t0 = performance.now();
    // Only the WORLD drawn to the screen may wait a frame. A render into a render target is usually ONE-SHOT — a bake,
    // an env/PMREM, a capture — and a skipped draw there is not a late pop-in but a permanently wrong texture (the sky
    // boot bake would come out black). Those keep upstream behaviour; their owners warm them (sky_baked compiles its
    // bands with compileAsync first).
    const deferring = gate && !!be.parallel && isWorldPass(renderer.getRenderTarget());
    let ret;
    if (deferring) {
      const mine = [];
      ret = orig(renderObject, mine);
      if (mine.length) stats.deferred++;
    } else {
      ret = orig(renderObject, null);
    }
    const ms = performance.now() - t0;
    if (ms >= SLOW_MS || deferring) {
      const o = renderObject.object, m = renderObject.material, p = renderObject.pipeline;
      const row = {
        ms: +ms.toFixed(0), deferred: deferring,
        object: `${o?.type ?? '?'}:${named(o)}`,
        material: `${m?.type ?? '?'}:${m?.name || ''}`,
        vs: p?.vertexProgram?.code?.length ?? 0, fs: p?.fragmentProgram?.code?.length ?? 0,
        skinned: !!o?.isSkinnedMesh, morphs: o?.morphTargetInfluences?.length ?? 0,
        lights: renderObject.lightsNode?.getLights?.()?.length ?? null,
      };
      if (ms >= SLOW_MS) stats.slow.push(row);
      if (ms >= SLOW_MS || row.fs > 60000) tee(`[syncgate] render-path build ${row.ms} ms${deferring ? ' (deferred link)' : ' (BLOCKING)'} ${row.object} ${row.material} vs ${row.vs} fs ${row.fs} chars skinned=${row.skinned} morphs=${row.morphs} lights=${row.lights}`);
    }
    return ret;
  };

  tee(`[syncgate] installed: parallel-compile ${stats.parallel ? 'yes' : 'NO (gate inert: links block)'}; gate ${gate ? 'on' : 'off (?syncgate=0, census only)'}`);
  return stats;
}
