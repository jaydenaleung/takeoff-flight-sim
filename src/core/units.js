// Unit conversions and small numeric helpers. Internals are SI; these are for the UI boundary.
export const G = 9.80665;
export const KT = 0.514444;      // m/s per knot
export const FT = 0.3048;        // m per foot
export const NM = 1852;          // m per nautical mile
export const FPM = FT / 60;      // m/s per ft/min
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const LB = 0.45359237;
export const INHG = 3386.389;    // Pa per inHg

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (x) => (x < 0 ? -1 : 1);
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const wrap180 = (d) => wrap360(d + 180) - 180;
export function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}
export function moveToward(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}
/** Exponential approach factor that is frame-rate independent. */
export const expK = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
