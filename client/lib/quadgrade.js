// quadgrade — the VR panels' saturation/contrast grade as pure numbers (no three): the defaults, the ranges, the
// persisted choice, and gradeSRGB, the JS twin of the shader grade in quadcolour.js. VR panels only: never the design
// tokens, never the desktop (owner, 09-30: 'colours are generally less vibrant in VR' — a modest default boost).
export const LUMA = [0.2126, 0.7152, 0.0722];   // Rec. 709, the weights the shader uses
// VR panel grade: modest by default (owner asked for a modest default boost); the Settings › VR sliders drive these
export const GRADE_DEFAULT = Object.freeze({ saturation: 1.15, contrast: 1.08 });
export const GRADE_RANGE = Object.freeze({ saturation: [0.5, 2], contrast: [0.5, 1.8] });
const LS = 'ew-xr-panel-grade';
export const clampTo = (v, [lo, hi], d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
export const storeGrade = (g) => { try { localStorage.setItem(LS, JSON.stringify(g)); } catch {} };
export function loadGrade() {
  let o = {}; try { o = JSON.parse(localStorage.getItem(LS) || '{}') ?? {}; } catch {}
  return { saturation: clampTo(Number(o.saturation), GRADE_RANGE.saturation, GRADE_DEFAULT.saturation),
    contrast: clampTo(Number(o.contrast), GRADE_RANGE.contrast, GRADE_DEFAULT.contrast) };
}
/** The grade in sRGB-encoded [0,1] (the JS twin of the shader): saturation about Rec.709 luma, contrast about mid-grey. */
export function gradeSRGB([r, g, b], { saturation = 1, contrast = 1 } = {}) {
  const y = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  return [r, g, b].map((v) => Math.min(1, Math.max(0, (y + (v - y) * saturation - 0.5) * contrast + 0.5)));
}

