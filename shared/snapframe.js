// Optional framing for a world snapshot (GET /snap, the `snap` wire message,
// the agent `snapshot` tool). One normaliser, three readers: the sequencer
// cleans what arrives over HTTP, the renderer cleans what arrives over the
// wire, the agent tool cleans what the model asked for — and an absent field
// always means "today's fixed framing", so old callers see no change.
//
//   dist   — third/selfie: metres between the camera and the body, measured
//            flat (third sits behind, selfie in front).        [0.5, 30]
//   height — third/selfie: camera height above the body's feet. [0, 30]
//   pitch  — first: gaze tilt in degrees, + looks up, − looks down. [-85, 85]
//            (the default first-person gaze is about −4.3°: dropped 0.6m over 8m)

export const SNAP_DIST = [0.5, 30];
export const SNAP_HEIGHT = [0, 30];
export const SNAP_PITCH = [-85, 85];

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const num = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** @returns {{dist?: number, height?: number, pitch?: number}} only the fields
 *  that were given as finite numbers, each clamped to its range. */
export function normalizeSnapFrame(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const d = num(raw.dist), h = num(raw.height), p = num(raw.pitch);
  if (d !== undefined) out.dist = clamp(d, SNAP_DIST);
  if (h !== undefined) out.height = clamp(h, SNAP_HEIGHT);
  if (p !== undefined) out.pitch = clamp(p, SNAP_PITCH);
  return out;
}
