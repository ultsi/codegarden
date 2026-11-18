import { BAND_L1_L2, BAND_L2_L3 } from './config.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const lss = (band, s) => smoothstep(Math.log(band[0]), Math.log(band[1]), Math.log(s));

/**
 * Semantic zoom weights for a camera scale.
 * l1 = architecture, l2 = API contracts, l3 = code. They always sum to 1.
 * vis = how "materialised" function cards are (0 at L1, 1 from L2 on).
 */
export function levelWeights(s) {
  const a = lss(BAND_L1_L2, s);
  const l3 = lss(BAND_L2_L3, s);
  const l1 = 1 - a;
  const l2 = Math.max(0, a - l3);
  return { l1, l2, l3, vis: a };
}
