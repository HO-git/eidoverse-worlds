// naming — the fleet's rungs on top of upstream's label reader (shared/label.js,
// carried byte-identical from anima-research/eidoverse-worlds#168 so bumps merge
// clean). Every surface that CALLS a thing something goes through thingIdentity:
// the MCPL agent's look() and tool replies, the scene panel, /geom.
//
// Upstream's ladder: authored label.name → logged asset name → humanized model
// basename → id. Added here:
//   kind   'light' | 'thing' — a light folds with kind "light" and no lib; the
//          agent's entity view carries lib "(light)" instead (agent.ts
//          reconcileFromFold). Unlabelled lights read "light", never the bare id.
//   model  what the thing LOOKS like regardless of its name: the model's
//          humanized filename, or "light"; '' for a store hash, which is an
//          address and describes nothing. Perception appends it to an authored
//          name — "vigil candle (light)", "Helen's bench (parkbank)".
//   store  true for a content-addressed upload (store/<16 hex>.glb): an
//          unlabelled one is shown as "<hash> (upload)" so a reader knows it is a
//          conjured mesh, not a library file.
import { objectIdentity } from './label.js';

const isLight = (e) => e?.kind === 'light' || e?.lib === '(light)';
const isStoreHash = (lib) => /^store\/[0-9a-f]{16}\.glb$/i.test(lib ?? '');

/** @returns {{name:string, authored:boolean, id:string, assetName:string, description:string,
 *            visibility:string, offset:number[]|null, kind:'light'|'thing', model:string, store:boolean}} */
export function thingIdentity(entity, assets = []) {
  const light = isLight(entity);
  // a light has no lib to humanize: hand upstream's ladder a lib that reads "light"
  const base = objectIdentity(light ? { ...entity, lib: 'light' } : entity, assets);
  const store = isStoreHash(entity?.lib);
  return { ...base, kind: light ? 'light' : 'thing', store,
    model: light ? 'light' : store ? '' : (base.authored ? humanized(entity, assets) : base.name) };
}
/** the ladder below the authored name — what the thing would be called unlabelled */
function humanized(entity, assets) {
  return objectIdentity({ ...entity, comp: { ...(entity?.comp ?? {}), label: undefined } }, assets).name;
}
