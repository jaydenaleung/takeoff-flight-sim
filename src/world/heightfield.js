// The terrain height function, shared by the main thread (physics, radio altimeter, scenery
// placement) and the terrain workers (mesh generation) so that what you see is what you hit.
export const GRID_W = 2048, GRID_H = 1760, CELL = 600;
export const HALF_W = (GRID_W * CELL) / 2, HALF_H = (GRID_H * CELL) / 2;

function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
/** Fractal noise in roughly [-1, 1]. */
export function fbm(x, z, oct) {
  let amp = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * (vnoise(x * f, z * f) * 2 - 1);
    f *= 2.07; amp *= 0.5;
    const t = x; x = x * 0.8 - z * 0.6; z = t * 0.6 + z * 0.8;     // rotate octaves
  }
  return s;
}
export { hash2, vnoise };

const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

export class HeightField {
  /**
   * heights: Uint16Array (GRID_W*GRID_H) of (metres + 500) * 4
   * flags:   Uint8Array, 0 land, 128 lake, 255 ocean
   * pads:    airport flattening pads [{ x, z, r, elev, boxes: [{cx, cz, ux, uz, hl, hw}] }]
   */
  constructor(heights, flags, pads = []) {
    this.h = heights; this.f = flags; this.pads = pads;
    this._g = [0, 0];
  }
  raw(i, j) {
    if (i < 0) i = 0; else if (i >= GRID_W) i = GRID_W - 1;
    if (j < 0) j = 0; else if (j >= GRID_H) j = GRID_H - 1;
    return this.h[j * GRID_W + i] * 0.25 - 500;
  }
  flag(i, j) {
    if (i < 0) i = 0; else if (i >= GRID_W) i = GRID_W - 1;
    if (j < 0) j = 0; else if (j >= GRID_H) j = GRID_H - 1;
    return this.f[j * GRID_W + i];
  }
  /** Bicubic base elevation; also stores the base gradient magnitude in this.slope. */
  base(x, z) {
    const gx = (x + HALF_W) / CELL - 0.5, gz = (z + HALF_H) / CELL - 0.5;
    const i = Math.floor(gx), j = Math.floor(gz);
    const tx = gx - i, tz = gz - j;
    const h = this.h, W = GRID_W;
    let r0, r1, r2, r3;
    if (i >= 1 && j >= 1 && i < GRID_W - 2 && j < GRID_H - 2) {
      let o = (j - 1) * W + i - 1;
      r0 = cr(h[o], h[o + 1], h[o + 2], h[o + 3], tx); o += W;
      const a0 = h[o + 1], a1 = h[o + 2];
      r1 = cr(h[o], a0, a1, h[o + 3], tx); o += W;
      const b0 = h[o + 1], b1 = h[o + 2];
      r2 = cr(h[o], b0, b1, h[o + 3], tx); o += W;
      r3 = cr(h[o], h[o + 1], h[o + 2], h[o + 3], tx);
      const dx = ((a1 - a0) + (b1 - b0)) * 0.5, dz = ((b0 - a0) + (b1 - a1)) * 0.5;
      this.slope = (Math.hypot(dx, dz) * 0.25) / CELL;
      // exactly flat water surfaces must not ripple from interpolation overshoot
      if (a0 === a1 && a0 === b0 && a0 === b1) return a0 * 0.25 - 500;
      return cr(r0, r1, r2, r3, tz) * 0.25 - 500;
    }
    const a = this.raw(i, j), b = this.raw(i + 1, j), c = this.raw(i, j + 1), d = this.raw(i + 1, j + 1);
    this.slope = 0;
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  /** 0 = land, 1 = lake, 2 = ocean (bilinear majority around the point). */
  water(x, z) {
    const gx = (x + HALF_W) / CELL - 0.5, gz = (z + HALF_H) / CELL - 0.5;
    const i = Math.floor(gx), j = Math.floor(gz);
    const tx = gx - i, tz = gz - j;
    const a = this.flag(i, j), b = this.flag(i + 1, j), c = this.flag(i, j + 1), d = this.flag(i + 1, j + 1);
    if (!(a | b | c | d)) return 0;
    const w = (v, k) => (v === k ? 1 : 0);
    const lake = w(a, 128) * (1 - tx) * (1 - tz) + w(b, 128) * tx * (1 - tz) + w(c, 128) * (1 - tx) * tz + w(d, 128) * tx * tz;
    const ocean = w(a, 255) * (1 - tx) * (1 - tz) + w(b, 255) * tx * (1 - tz) + w(c, 255) * (1 - tx) * tz + w(d, 255) * tx * tz;
    if (lake > 0.5) return 1;
    if (ocean > 0.5) return 2;
    return 0;
  }
  /** Natural terrain: baked elevation plus relief-scaled fractal detail. */
  natural(x, z, oct = 5) {
    const b = this.base(x, z);
    if (b <= 0.3) return b;
    const s = this.slope;
    let amp = Math.min(140, 260 * Math.pow(s, 1.15)) + 0.35;
    if (b < 12) amp *= b / 12;
    if (amp < 0.2) return b;
    const n = fbm(x / 900, z / 900, oct);
    const ridge = 1 - Math.abs(fbm(x / 2300 + 31.7, z / 2300 - 12.4, 3)) * 2;
    return Math.max(0.4, b + amp * (n * 0.75 + ridge * 0.25 * Math.min(1, s * 6)));
  }
  /** Airport flattening weight and elevation at a point: returns weight 0..1, sets this.padElev. */
  padWeight(x, z) {
    const pads = this.pads;
    let best = 0;
    for (let k = 0; k < pads.length; k++) {
      const p = pads[k];
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > p.r * p.r) continue;
      let dmin = 1e9;
      const bx = p.boxes;
      for (let q = 0; q < bx.length; q++) {
        const B = bx[q];
        const lx = (x - B.cx) * B.ux + (z - B.cz) * B.uz;
        const lz = -(x - B.cx) * B.uz + (z - B.cz) * B.ux;
        const ex = Math.abs(lx) - B.hl, ez = Math.abs(lz) - B.hw;
        const d = ex <= 0 && ez <= 0 ? Math.max(ex, ez) : Math.hypot(Math.max(ex, 0), Math.max(ez, 0));
        if (d < dmin) dmin = d;
      }
      if (dmin < 650) {
        const t = dmin <= 0 ? 1 : 1 - dmin / 650;
        const w = t * t * (3 - 2 * t);
        if (w > best) { best = w; this.padElev = p.elev; }
      }
    }
    return best;
  }
  /** Ground elevation (metres MSL). Water surfaces return their own level; sea bed is negative. */
  heightAt(x, z, oct = 5) {
    const w = this.pads.length ? this.padWeight(x, z) : 0;
    if (w >= 1) return this.padElev;
    const n = this.natural(x, z, oct);
    return w > 0 ? n + (this.padElev - n) * w : n;
  }
  /** Surface the aircraft would touch: the sea surface over the ocean. */
  surfaceAt(x, z) {
    const h = this.heightAt(x, z);
    return h < 0 ? 0 : h;
  }
}

/** Decode the baked terrain image (RGBA bytes) into height and flag arrays. */
export function decodeTerrain(rgba) {
  const n = GRID_W * GRID_H;
  const heights = new Uint16Array(n), flags = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    heights[i] = (rgba[p] << 8) | rgba[p + 1];
    flags[i] = rgba[p + 2] > 200 ? 255 : rgba[p + 2] > 64 ? 128 : 0;
  }
  return { heights, flags };
}
