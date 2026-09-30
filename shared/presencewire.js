// Presence (present / away / busy) on the embodied plane, the same way the
// wing fold rides: one small field on the pose packet, no new message type,
// relayed by the server untouched and remembered for late joiners with the
// rest of the settled pose (a tester, 09-05: "broadcast that state so the Who panel
// can show it"). Shared by client and server so both agree on the vocabulary.
export const PRESENCE_STATES = ['present', 'away', 'busy'];

export function presenceWire(state) {
  return PRESENCE_STATES.includes(state) ? { presence: state } : {};
}

export function applyPresenceWire(target, sample) {
  if (!target || !sample || !PRESENCE_STATES.includes(sample.presence)) return false;
  target.presence = sample.presence;
  return true;
}

// Voice state on the same packet (2026-09-30, the nameplate ear and hover card): `mic` — this body's microphone is
// live (the HUD mic glyph's own reading); `hear` — it is hearing voices (the ear glyph: receiving AND not hushed).
// Additive and optional like `presence`: a client that predates it sends neither, and a receiver then knows NOTHING
// (undefined) rather than assuming "can't hear you". Booleans only; anything else is dropped.
export function voiceWire(v) {
  const o = {};
  if (typeof v?.mic === 'boolean') o.mic = v.mic;
  if (typeof v?.hear === 'boolean') o.hear = v.hear;
  return o;
}

export function applyVoiceWire(target, sample) {
  if (!target || !sample) return false;
  let did = false;
  if (typeof sample.mic === 'boolean') { target.mic = sample.mic; did = true; }
  if (typeof sample.hear === 'boolean') { target.hear = sample.hear; did = true; }
  return did;
}
