// A NULL EYE FRAMEBUFFER IS THE DEFAULT FRAMEBUFFER (tools/xr-render-errors-probe.mjs).
//
// three r186, WebGL backend: XRManager hands the session layer's framebuffer to backend.setXRTarget, and
// _setFramebuffer then calls WebGLState.drawBuffers(renderContext, fb), which caches per framebuffer in a WeakMap —
// `currentDrawbuffers.set(fb, …)`. A WebGL emulator (IWER, and the Immersive Web Emulator extension built on it)
// answers XRWebGLLayer.framebuffer with null by design (iwer lib/layers/XRWebGLLayer.js:44: it draws to the canvas and
// splits it per eye), so the set throws `Invalid value used as weak map key`. The throw lands inside
// renderer._renderOutput between `xr.enabled = false; autoClear = false` and their restore (no finally), so after the
// first XR frame the renderer was left with XR OFF: later frames drew the desktop camera into the canvas, not the eyes
// (48 session frames → 4 eye draws; the probe's red). report()'s rate limit showed it once.
//
// A real immersive runtime (her headset, Chromium) returns an opaque WebGLFramebuffer, never null (WebXR §
// XRWebGLLayer: only an INLINE session's layer has a null framebuffer), so there this wrapper only ever passes through.
// For null, the draw-buffer state the default framebuffer needs is [BACK] — exactly what three issues for a context
// with no textures — so that is what it gets. The bind itself (gl.bindFramebuffer(…, null)) is already correct.
// Revisit at every three bump: if drawBuffers stops keying a WeakMap on the framebuffer, delete this file.
export function tolerateNullXRFramebuffer(renderer) {
  const state = renderer?.backend?.isWebGLBackend ? renderer.backend.state : null;
  if (!state || typeof state.drawBuffers !== 'function' || state.drawBuffers.__nullFb) return false;
  const drawBuffers = state.drawBuffers;
  const wrapped = function (renderContext, framebuffer) {
    if (framebuffer === null && renderContext?.textures != null) return drawBuffers.call(this, { textures: null }, null);
    return drawBuffers.call(this, renderContext, framebuffer);
  };
  wrapped.__nullFb = true;
  wrapped.unwrapped = drawBuffers;   // the probe's --control puts this back to watch the bug return
  state.drawBuffers = wrapped;
  return true;
}
