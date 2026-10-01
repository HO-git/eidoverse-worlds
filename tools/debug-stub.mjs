// debug-tabs-test substitutes this for every neighbour debug.js imports except rows.js (pure DOM).
// One export table serves core/base/xrpanels/gputime/perf/render/perfscope/three-mesh-bvh/colliders/
// ragdoll/ammodoll/avatar/frames/ui — the names are disjoint. Inert unless a test reads it.
const Inert = class { constructor() {} set() { return this; } add() {} remove() {} copy() { return this; } };
export const THREE = new Proxy({}, { get: () => Inert });
export const scene = { add() {}, remove() {} };
export const bus = { on() {}, emit() {} };
export const registerXRPanel = () => {};
export const xrPanelOpen = () => false;
export const gpuLine = () => '', shadowPassLine = () => '', setGpuTimer = () => {}, gpuTimerOn = () => false;
export const gpuTimerState = () => ({ supported: false });
export const measureShadowPass = async () => ({});
export const perf = {};
export const drawStats = () => ({});
export const MODES = [], setMode = () => {}, activeMode = () => null, setSolid = () => {}, isSolid = () => false;
export const mountPerfPanel = () => {};
export const MeshBVHHelper = Inert;
export const colliders = new Map();
export const closestParams = () => ({});
export const TUNING = {};
export const JOINT_SPECS = { hip: { flex: 90, ext: 10, twist: 20, x: [-10, 10], z: [-10, 10] } }, HAIR_TUNING = {}, WING_TUNING = {};
export const BLINK = {}, WING_IDLE = {}, LIMP_SPRINGS = {};
export const toast = () => {}, paintRangesIn = () => {};
// frames.js: a frame with the real api's show/hide/toggle/visible shape
export function makeFrame(key, opts = {}) {
  const el = document.createElement('div'), body = document.createElement('div');
  el.append(body); document.body.append(el);
  const api = {
    key, el, body, hidden: !!opts.hidden,
    show() { api.hidden = false; return api; },
    hide() { api.hidden = true; return api; },
    toggle() { api.hidden ? api.show() : api.hide(); return api; },
    get visible() { return !api.hidden; },
  };
  return api;
}
