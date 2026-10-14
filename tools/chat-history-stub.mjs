// chat-scrollback-test substitutes this for net.js: requestHistory pages a
// fake world log with the server's readHistory semantics (server/world.ts) —
// the NEWEST `limit` matching entries strictly between after and before,
// handed back oldest-first.
let log = [];
export const requests = [];
export function setLog(entries) { log = entries; requests.length = 0; }
export async function requestHistory({ before = Infinity, after = -Infinity, limit = 50, verbs = null } = {}) {
  requests.push({ before, after, limit });
  const out = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = log[i];
    if (e.seq < before && e.seq > after && (!verbs || verbs.includes(e.verb))) out.push(e);
  }
  out.reverse();
  const oldest = out.length ? out[0].seq : null;
  return { entries: out, oldestSeq: oldest, hasMore: oldest !== null && oldest > 0 };
}
