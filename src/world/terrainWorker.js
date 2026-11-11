// Terrain tile generation in a Web Worker: heights, normals and per-vertex colour.
import { HeightField, GRID_W, GRID_H, CELL, HALF_W, HALF_H, fbm, hash2, vnoise } from './heightfield.js';

let hf = null, lc = null, LCW = 0, LCH = 0, LCC = 1200, cities = [];
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) lin[i] = Math.pow(i / 255, 2.2);

const col = [0, 0, 0];
function landcover(x, z) {
  const gx = Math.min(LCW - 1.001, Math.max(0, (x + HALF_W) / LCC - 0.5));
  const gz = Math.min(LCH - 1.001, Math.max(0, (z + HALF_H) / LCC - 0.5));
  const i = gx | 0, j = gz | 0, tx = gx - i, tz = gz - j;
  const o = (j * LCW + i) * 3, o2 = o + LCW * 3;
  for (let k = 0; k < 3; k++) {
    const a = lin[lc[o + k]], b = lin[lc[o + 3 + k]], c = lin[lc[o2 + k]], d = lin[lc[o2 + 3 + k]];
    col[k] = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
}
const mix = (c, r, g, b, t) => { c[0] += (r - c[0]) * t; c[1] += (g - c[1]) * t; c[2] += (b - c[2]) * t; };

/** Writes linear RGB into col and returns the water flag (0 land, 1 water surface). */
function shade(x, z, h, ny, step) {
  const wf = hf.water(x, z);
  if (wf === 1) { col[0] = 0.035; col[1] = 0.11; col[2] = 0.17; return 1; }
  if (h < 0) {                                   // sea bed under the water plane
    const t = sm(0, -25, h);
    col[0] = 0.5 - 0.44 * t; col[1] = 0.47 - 0.32 * t; col[2] = 0.36 - 0.14 * t;
    return 0;
  }
  landcover(x, z);
  // Natural Earth colours are pastel: add contrast and saturation
  let r = col[0], g = col[1], b = col[2];
  const l = 0.3 * r + 0.55 * g + 0.15 * b;
  r = l + (r - l) * 1.45; g = l + (g - l) * 1.45; b = l + (b - l) * 1.45;
  const k = 0.62;
  col[0] = Math.max(0.01, r * k); col[1] = Math.max(0.01, g * k); col[2] = Math.max(0.01, b * k);
  const green = col[1] - Math.max(col[0], col[2]);
  const big = vnoise(x / 6100, z / 6100), med = vnoise(x / 830 + 7, z / 830 - 3);
  // farmland patchwork on flat fertile lowland
  if (green > 0.004 && ny > 0.9992 && h < 800 && step < 900) {
    const p = hash2(Math.floor(x / 420), Math.floor(z / 420)), q = hash2(Math.floor(x / 420) + 91, Math.floor(z / 420) - 37);
    const s = 0.55 * sm(0.004, 0.02, green);
    if (p < 0.35) mix(col, 0.13, 0.26, 0.07, s); else if (p < 0.6) mix(col, 0.36, 0.31, 0.13, s); else if (p < 0.8) mix(col, 0.27, 0.2, 0.12, s * q);
  } else if (green > 0.006) {
    const f = sm(0.006, 0.03, green) * (0.25 + 0.3 * med);      // forest canopy
    mix(col, 0.045, 0.1, 0.04, f);
  }
  // rock on steep slopes
  const rock = sm(0.86, 0.62, ny);
  if (rock > 0) mix(col, 0.2 + 0.1 * big + col[0] * 0.25, 0.18 + 0.08 * big + col[1] * 0.2, 0.16 + 0.07 * big + col[2] * 0.15, rock * 0.85);
  // seasonal snow line
  const snow = sm(3050 + 320 * big, 3500 + 320 * big, h) * (0.55 + 0.45 * sm(0.55, 0.9, ny));
  if (snow > 0) mix(col, 0.86, 0.89, 0.93, snow);
  // beach
  if (h < 4) { const wn = hf.water(x + 500, z) || hf.water(x - 500, z) || hf.water(x, z + 500) || hf.water(x, z - 500); if (wn) mix(col, 0.6, 0.55, 0.4, sm(4, 0.8, h) * 0.8); }
  // built-up areas
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i], dx = x - c.x, dz = z - c.z, R = c.R;
    if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
    const u = sm(R, R * 0.25, Math.hypot(dx, dz)) * (ny > 0.985 ? 1 : 0.3);
    if (u > 0) {
      const blk = hash2(Math.floor(x / 130), Math.floor(z / 130));
      const v = 0.2 + 0.1 * blk;
      mix(col, v, v, v * 1.03, u * (0.55 + 0.25 * hash2(Math.floor(x / 700), Math.floor(z / 700))));
    }
  }
  // airfield grass
  const pw = hf.pads.length ? hf.padWeight(x, z) : 0;
  if (pw > 0) mix(col, 0.16 + col[0] * 0.5, 0.21 + col[1] * 0.35, 0.09 + col[2] * 0.3, pw * 0.75);
  const v = 0.9 + 0.2 * med;
  col[0] *= v; col[1] *= v; col[2] *= v;
  return 0;
}

function build(m) {
  const { id, x0, z0, size, res } = m;
  const G = res + 3, step = size / res;
  const oct = Math.max(1, Math.min(5, Math.floor(Math.log(900 / (2 * step)) / Math.log(2.07)) + 2));
  const hs = new Float32Array(G * G);
  let minY = 1e9, maxY = -1e9;
  for (let j = 0; j < G; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const x = x0 + (i - 1) * step;
      let h = hf.heightAt(x, z, oct);
      // the rendered airfield sits a little below the pavement so it never z-fights with it
      if (hf.pads.length && h === hf.padElev && hf.padWeight(x, z) >= 1) h -= 0.3;
      hs[j * G + i] = h;
      if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
  }
  const pos = new Float32Array(G * G * 3), nrm = new Float32Array(G * G * 3), colr = new Float32Array(G * G * 3), aux = new Float32Array(G * G);
  const half = size / 2, skirt = step * 1.4 + 4;
  for (let j = 0; j < G; j++) {
    const cj = Math.min(G - 2, Math.max(1, j));
    for (let i = 0; i < G; i++) {
      const ci = Math.min(G - 2, Math.max(1, i));
      const o = (j * G + i) * 3;
      const h = hs[cj * G + ci];
      const edge = ci !== i || cj !== j;
      const lx = (ci - 1) * step - half, lz = (cj - 1) * step - half;
      pos[o] = lx; pos[o + 1] = edge ? h - skirt : h; pos[o + 2] = lz;
      let nx = hs[cj * G + ci - 1] - hs[cj * G + ci + 1], nz = hs[(cj - 1) * G + ci] - hs[(cj + 1) * G + ci], ny = 2 * step;
      const il = 1 / Math.hypot(nx, ny, nz);
      nx *= il; ny *= il; nz *= il;
      nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
      const w = shade(x0 + (ci - 1) * step, z0 + (cj - 1) * step, h, ny, step);
      colr[o] = col[0]; colr[o + 1] = col[1]; colr[o + 2] = col[2];
      aux[j * G + i] = w;
    }
  }
  self.postMessage({ type: 'tile', id, pos, nrm, col: colr, aux, minY: minY - 1, maxY: maxY + 1 }, [pos.buffer, nrm.buffer, colr.buffer, aux.buffer]);
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    hf = new HeightField(m.heights, m.flags, m.pads);
    lc = m.lc; LCW = m.lcW; LCH = m.lcH; LCC = m.lcCell; cities = m.cities;
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'tile') build(m);
};
