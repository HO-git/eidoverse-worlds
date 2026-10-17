// vrmheight — a body's stature read from its VRM file, so every body on the
// roster has a height before anyone has worn it.
//
// The rule is shared/rig.js's stature(): the humanoid head joint at rest plus
// a forehead, the same rule the browser's portrait pass and the door's
// bodyHeightFor use, so the three agree on a body. The bounding box is no
// substitute, since it counts hair, ears and tails: the default claude.vrm
// boxes at about 2.2 m around a 1.5 m body, its crown of tentacles weighted
// to the Head bone itself.
//
// Only the GLB header and JSON chunk are read, a few milliseconds a body, so a
// result is kept in memory for the file's version (its mtime, as the roster
// stamps it) and nothing is written. Read-only on the VRM.
import * as THREE from "three";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { glbJson, rigMath } from "../shared/rig.js";

const { stature } = rigMath(THREE);
const memo = new Map<string, { v: string; h: number | null }>();

/** The header and JSON chunk of a GLB on disk: its first 20 bytes say how
 *  long the JSON chunk is, which can't be more than the file holds. */
function headerAndJson(file: string): Uint8Array {
  const fd = openSync(file, "r");
  try {
    const head = new Uint8Array(20);
    if (readSync(fd, head, 0, 20, 0) < 20) throw new Error("shorter than a GLB header");
    const len = new DataView(head.buffer).getUint32(12, true);
    if (20 + len > fstatSync(fd).size) throw new Error("JSON chunk longer than the file");
    const buf = new Uint8Array(20 + len);
    buf.set(head);
    readSync(fd, buf, 20, len, 20);
    return buf;
  } finally { closeSync(fd); }
}

/** The file's stature in metres, or null when it has no humanoid head or
 *  isn't a readable GLB. `v` is the file's version as the roster stamps it,
 *  so a re-export is read again. */
export function vrmHeightFor(file: string, v: string): number | null {
  const hit = memo.get(file);
  if (hit?.v === v) return hit.h;
  let h: number | null;
  try { h = stature(glbJson(headerAndJson(file))); } catch { h = null; }
  memo.set(file, { v, h });
  return h;
}
