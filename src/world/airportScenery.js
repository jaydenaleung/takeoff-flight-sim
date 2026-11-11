// Airport scenery: painted runways, taxiways, apron, buildings and airfield lighting (edge,
// threshold, approach lights and PAPI), built lazily for airports near the player.
import * as THREE from 'three';
import { DEG, clamp } from '../core/units.js';

const M_PER_FT = 0.3048;

function noiseFill(g, w, h, base, amp, n = 5000) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${amp * Math.random()})` : `rgba(0,0,0,${amp * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 2 + Math.random() * 14);
  }
}
function mkTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  if (repeat) { t.wrapT = THREE.RepeatWrapping; }
  return t;
}

/** Texture for the first 600 m of a runway: threshold, designator, touchdown zone, aiming point. */
function capTexture(end, width, surface) {
  const W = 256, H = 2048, LEN = 600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  noiseFill(g, W, H, surface === 'concrete' ? '#5a5b5c' : '#2f3033', 0.07, 9000);
  const sx = W / width, sy = H / LEN;             // px per metre across / along
  const X = (m) => W / 2 + m * sx, Y = (m) => m * sy;
  const white = 'rgba(238,238,232,0.95)';
  const rect = (x0, y0, w, l) => g.fillRect(X(x0), Y(y0), w * sx, l * sy);
  // tyre rubber in the touchdown zone
  const grd = g.createLinearGradient(0, Y(250), 0, Y(600));
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.25, 'rgba(0,0,0,0.38)'); grd.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grd;
  for (const off of [-6, 6]) g.fillRect(X(off - 4.5), Y(250), 9 * sx, 350 * sy);
  g.fillStyle = white;
  const d = end.displaced || 0;
  // side stripes
  rect(-width / 2 + 0.6, 0, 0.9, LEN); rect(width / 2 - 1.5, 0, 0.9, LEN);
  if (d > 0) {
    // displaced threshold: arrows on the centreline, then a full-width bar
    for (let y = 12; y < d - 20; y += 60) {
      rect(-0.45, y, 0.9, 30);
      g.beginPath(); g.moveTo(X(0), Y(y + 42)); g.lineTo(X(-4), Y(y + 30)); g.lineTo(X(4), Y(y + 30)); g.fill();
    }
    rect(-width / 2 + 2, d - 3.2, width - 4, 3);
  }
  // threshold stripes (150 ft long)
  const nStripes = width >= 55 ? 16 : width >= 42 ? 12 : 8;
  const sw = 1.8, gap = (width - 6 - nStripes * sw - 4) / (nStripes - 2);
  for (let i = 0; i < nStripes / 2; i++) {
    const x = 2 + i * (sw + gap);
    rect(x, d + 6, sw, 45.7); rect(-x - sw, d + 6, sw, 45.7);
  }
  // designator, drawn to be read from the approach
  const num = end.id.replace(/[LRC]$/, ''), letter = end.id.match(/[LRC]$/)?.[0];
  const glyph = (text, y0, hM, wM) => {
    g.save();
    g.font = 'bold 100px Arial, Helvetica, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const m = g.measureText(text);
    const tw = m.width, th = m.actualBoundingBoxAscent;
    g.translate(X(0), Y(y0));
    g.scale((wM * sx * text.length) / tw, -(hM * sy) / th);
    g.fillText(text, 0, 0);
    g.restore();
  };
  let y = d + 64;
  if (letter) { glyph(letter, y, 18, 6); y += 24; }
  glyph(num, y, 18, 7.5);
  y += 30;
  // centreline (120 ft stripes, 80 ft gaps)
  for (let yy = y; yy < LEN; yy += 61) rect(-0.45, yy, 0.9, Math.min(36.6, LEN - yy));
  // touchdown zone bars and aiming point, measured from the threshold
  const bars = (yy, n) => { for (let i = 0; i < n; i++) { rect(9 + i * 3.3, yy, 1.8, 22.5); rect(-9 - i * 3.3 - 1.8, yy, 1.8, 22.5); } };
  if (d + 150 + 23 < LEN) bars(d + 150, 3);
  if (d + 300 + 46 < LEN) { const aw = width >= 55 ? 9 : 6; rect(9, d + 300, aw, 45); rect(-9 - aw, d + 300, aw, 45); }
  if (d + 450 + 23 < LEN) bars(d + 450, 2);
  return mkTex(c);
}
let _midTex = {};
function midTexture(surface) {
  if (_midTex[surface]) return _midTex[surface];
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  noiseFill(g, W, H, surface === 'concrete' ? '#5a5b5c' : '#2f3033', 0.07, 2500);
  g.fillStyle = 'rgba(238,238,232,0.95)';
  g.fillRect(W / 2 - 2, 0, 4, H * 0.6);
  g.fillRect(3, 0, 4, H); g.fillRect(W - 7, 0, 4, H);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(W / 2 - 30, 0, 60, H);
  return (_midTex[surface] = mkTex(c, true));
}
let _taxiTex;
function taxiTexture() {
  if (_taxiTex) return _taxiTex;
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  noiseFill(g, W, H, '#47484a', 0.06, 900);
  g.fillStyle = '#e2b719'; g.fillRect(W / 2 - 1.5, 0, 3, H);
  g.fillStyle = 'rgba(226,183,25,0.6)'; g.fillRect(2, 0, 2, H); g.fillRect(W - 4, 0, 2, H);
  return (_taxiTex = mkTex(c, true));
}
function apronTexture(ap) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  noiseFill(g, W, H, '#6a6b6b', 0.05, 5000);
  const A = ap.apron;
  // concrete slab joints
  g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const X = (s) => ((s + A.hl) / (2 * A.hl)) * W, Y = (t) => ((t + A.hw) / (2 * A.hw)) * H;
  g.strokeStyle = '#e2b719'; g.lineWidth = 2.2;
  const laneT = -A.hw + 70;
  g.beginPath(); g.moveTo(X(-A.hl + 40), Y(laneT)); g.lineTo(X(A.hl - 40), Y(laneT)); g.stroke();
  g.fillStyle = '#e2b719'; g.font = 'bold 15px Arial';
  for (const s of ap.stands) {
    const sx = (s.x - A.c.x) * A.u.x + (s.z - A.c.z) * A.u.z, st = (s.x - A.c.x) * A.n.x + (s.z - A.c.z) * A.n.z;
    g.beginPath(); g.moveTo(X(sx), Y(laneT)); g.lineTo(X(sx), Y(st + 12)); g.stroke();
    g.fillRect(X(sx) - 7, Y(st + 12) - 1.5, 14, 3);
    g.fillText(s.id.replace(/\D+/, ''), X(sx) + 9, Y(st + 4));
  }
  return mkTex(c);
}

/** Flat oriented quad: centre c, direction u (unit), half length/width, height y. */
function quad(c, u, hl, hw, y, vRepeat = 1, flipV = false) {
  const n = { x: -u.z, z: u.x };
  const p = (s, t) => [c.x + u.x * s + n.x * t, y, c.z + u.z * s + n.z * t];
  const g = new THREE.BufferGeometry();
  const a = p(-hl, -hw), b = p(-hl, hw), cc = p(hl, -hw), d = p(hl, hw);
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...cc, ...d], 3));
  const v0 = flipV ? vRepeat : 0, v1 = flipV ? 0 : vRepeat;
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, 1, v0, 0, v1, 1, v1], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}
function merge(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nrm = new Float32Array(n * 3), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); uv.set(g.attributes.uv.array, o * 2); nrm.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + o;
    o += g.attributes.position.count; oi += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------------------------------------------------------------- airfield lights
const lightVert = `
  attribute vec3 color2; attribute vec3 axis; attribute float size;
  uniform float scale, intensity;
  varying vec3 vColor; varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 toCam = cameraPosition - wp.xyz;
    float dist = length(toCam);
    vec3 col = color;
    float a = 1.0;
    if (axis.y > 0.5) {
      // PAPI unit: white above its setting angle, red below; visible from the approach only
      float ang = atan(toCam.y, length(toCam.xz));
      col = ang > axis.z ? vec3(1.0, 1.0, 0.95) : vec3(1.0, 0.08, 0.05);
      a = dot(normalize(toCam.xz), color2.xz) > 0.2 ? 1.0 : 0.0;
    } else if (length(axis.xz) > 0.5) {
      // directional pair: one colour seen from each side
      col = dot(toCam.xz, axis.xz) > 0.0 ? color : color2;
      if (col.r + col.g + col.b < 0.05) a = 0.0;
    }
    vColor = col;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    float px = size * scale / max(dist, 1.0);
    vAlpha = a * intensity * clamp(px / 1.4, 0.25, 1.0) * exp(-dist / 60000.0);
    gl_PointSize = clamp(px, 1.6, 22.0);
    #include <logdepthbuf_vertex>
  }`;
const lightFrag = `
  varying vec3 vColor; varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    float a = (1.0 - smoothstep(0.25, 1.0, r)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (1.0 + 1.5 * (1.0 - smoothstep(0.0, 0.5, r))), a);
  }`;
export const lightMaterial = new THREE.ShaderMaterial({
  uniforms: { scale: { value: 900 }, intensity: { value: 1 } },
  vertexShader: lightVert, fragmentShader: lightFrag,
  vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

class LightSet {
  constructor() { this.p = []; this.c = []; this.c2 = []; this.ax = []; this.s = []; }
  add(x, y, z, col, size = 1, col2 = null, axis = null) {
    this.p.push(x, y, z); this.c.push(col[0], col[1], col[2]);
    const b = col2 || col; this.c2.push(b[0], b[1], b[2]);
    if (axis) this.ax.push(axis[0], axis[1], axis[2]); else this.ax.push(0, 0, 0);
    this.s.push(size);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('color2', new THREE.Float32BufferAttribute(this.c2, 3));
    g.setAttribute('axis', new THREE.Float32BufferAttribute(this.ax, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.s, 1));
    const pts = new THREE.Points(g, lightMaterial);
    pts.frustumCulled = false; pts.renderOrder = 8;
    return pts;
  }
}

const WHITE = [1, 0.97, 0.88], YELLOW = [1, 0.75, 0.2], GREEN = [0.1, 1, 0.3], RED = [1, 0.08, 0.05], BLUE = [0.15, 0.3, 1], OFF = [0, 0, 0];

export function buildAirportScenery(ap) {
  const group = new THREE.Group();
  group.name = `airport-${ap.icao}`;
  const y0 = ap.elev;
  const disposables = [];
  const pave = (map) => { const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 }); disposables.push(m); return m; };
  const lights = new LightSet();

  // ---- apron
  {
    const A = ap.apron;
    const tex = apronTexture(ap); disposables.push(tex);
    const m = new THREE.Mesh(quad(A.c, A.u, A.hl, A.hw, y0 + 0.02), pave(tex));
    m.receiveShadow = true; group.add(m);
  }
  // ---- taxiways
  {
    const geos = [];
    for (const s of ap.taxiSegments) {
      const L = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      if (L < 2) continue;
      const u = { x: (s.b.x - s.a.x) / L, z: (s.b.z - s.a.z) / L };
      const c = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
      geos.push(quad(c, u, L / 2 + s.w / 2, s.w / 2, y0 + 0.05, (L + s.w) / 30));
      const n = { x: -u.z, z: u.x };
      for (let d = 0; d <= L; d += 60) {
        for (const sd of [-1, 1]) lights.add(s.a.x + u.x * d + n.x * sd * (s.w / 2 + 1), y0 + 0.4, s.a.z + u.z * d + n.z * sd * (s.w / 2 + 1), BLUE, 0.55);
      }
    }
    if (geos.length) { const m = new THREE.Mesh(merge(geos), pave(taxiTexture())); m.receiveShadow = true; group.add(m); }
  }
  // ---- runways
  for (const r of ap.runways) {
    const CAP = Math.min(600, r.length / 2 - 10);
    const mid = r.length - 2 * CAP;
    for (const e of r.ends) {
      const tex = capTexture(e, r.width, r.surface); disposables.push(tex);
      const c = { x: e.x + e.dir.x * CAP / 2, z: e.z + e.dir.z * CAP / 2 };
      const g = quad(c, e.dir, CAP / 2, r.width / 2, y0 + 0.09, CAP / 600);
      const m = new THREE.Mesh(g, pave(tex)); m.receiveShadow = true; group.add(m);
    }
    if (mid > 1) {
      const g = quad(r.c, r.u, mid / 2, r.width / 2, y0 + 0.09, Math.max(1, Math.round(mid / 61)));
      const m = new THREE.Mesh(g, pave(midTexture(r.surface))); m.receiveShadow = true; group.add(m);
    }
    // blast pads / shoulders
    const sh = new THREE.Mesh(quad(r.c, r.u, r.length / 2 + 60, r.width / 2 + 7.5, y0 + 0.06), new THREE.MeshStandardMaterial({ color: 0x3b3c3e, roughness: 0.95 }));
    sh.receiveShadow = true; group.add(sh); disposables.push(sh.material);

    // edge lights: white, yellow for the last 600 m; one colour per viewing direction
    const hw = r.width / 2 + 2;
    for (let d = 0; d <= r.length; d += 60) {
      const fromA = d, fromB = r.length - d;
      for (const sd of [-1, 1]) {
        const x = r.ends[0].x + r.u.x * d + r.n.x * sd * hw, z = r.ends[0].z + r.u.z * d + r.n.z * sd * hw;
        // seen while rolling from end 0 toward end 1: caution zone is the last 600 m (fromB < 600)
        lights.add(x, y0 + 0.5, z, fromB < 600 ? YELLOW : WHITE, 1.0, fromA < 600 ? YELLOW : WHITE, [-r.u.x, 0, -r.u.z]);
      }
    }
    for (const e of r.ends) {
      const right = { x: -e.dir.z, z: e.dir.x };
      // threshold bar: green from the approach, red from the runway side
      for (let k = -8; k <= 8; k++) {
        const t = (k / 8) * (r.width / 2);
        lights.add(e.thr.x + right.x * t - e.dir.x * 3, y0 + 0.5, e.thr.z + right.z * t - e.dir.z * 3, GREEN, 1.3, RED, [-e.dir.x, 0, -e.dir.z]);
      }
      // approach lighting: centreline bars every 30 m out to 720 m, crossbar at 300 m
      if (r.length > 2200) {
        for (let d = 30; d <= 720; d += 30) {
          for (let k = -2; k <= 2; k++) {
            lights.add(e.thr.x - e.dir.x * d + right.x * k * 1.3, y0 + 0.6 + d * 0.004, e.thr.z - e.dir.z * d + right.z * k * 1.3, WHITE, 1.25, OFF, [-e.dir.x, 0, -e.dir.z]);
          }
          if (d === 300) for (let k = -10; k <= 10; k++) if (Math.abs(k) > 2) lights.add(e.thr.x - e.dir.x * d + right.x * k * 1.5, y0 + 1.8, e.thr.z - e.dir.z * d + right.z * k * 1.5, WHITE, 1.25, OFF, [-e.dir.x, 0, -e.dir.z]);
        }
      }
      // PAPI: four units left of the runway abeam the aiming point
      const ax = 305, base = r.width / 2 + 15;
      const angles = [3.5, 3.1667, 2.8333, 2.5];   // nearest the runway is the highest setting
      for (let k = 0; k < 4; k++) {
        const t = -(base + k * 9);
        lights.add(e.thr.x + e.dir.x * ax + right.x * t, y0 + 0.6, e.thr.z + e.dir.z * ax + right.z * t, WHITE, 2.4, [-e.dir.x, 0, -e.dir.z], [0, 1, angles[k] * DEG]);
      }
      // centreline lights
      if (r.length > 2500) for (let d = 15; d < r.length; d += 30) lights.add(e.x + e.dir.x * d, y0 + 0.12, e.z + e.dir.z * d, WHITE, 0.55, OFF, [-e.dir.x, 0, -e.dir.z]);
    }
  }
  group.add(lights.build());

  // ---- buildings
  const bMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.7, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x4a6a86, roughness: 0.12, metalness: 0.85, emissive: 0x443c22, emissiveIntensity: 0 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x7c8086, roughness: 0.8 });
  disposables.push(bMat, glass, roof);
  const box = (c, u, hl, hw, h, mat, yBase = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hl * 2, h, hw * 2), mat);
    m.position.set(c.x, y0 + yBase + h / 2, c.z);
    m.rotation.y = Math.atan2(-u.z, u.x);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const T = ap.terminal;
  if (ap.military) {
    // row of hangars behind the flight line
    const n = 4;
    for (let k = 0; k < n; k++) {
      const c = { x: T.c.x + T.u.x * (k - (n - 1) / 2) * 110, z: T.c.z + T.u.z * (k - (n - 1) / 2) * 110 };
      box(c, T.u, 42, 32, 16, bMat);
      const rf = new THREE.Mesh(new THREE.CylinderGeometry(32, 32, 84, 16, 1, false, 0, Math.PI), roof);
      rf.position.set(c.x, y0 + 16, c.z); rf.rotation.z = Math.PI / 2; rf.rotation.y = Math.atan2(-T.u.z, T.u.x);
      rf.scale.set(0.35, 1, 1); group.add(rf);
    }
  } else {
    box(T.c, T.u, T.hl, T.hw, T.h, bMat);
    box(T.c, T.u, T.hl + 0.4, T.hw + 0.4, T.h * 0.42, glass, T.h * 0.3);
    box(T.c, T.u, T.hl * 0.985, T.hw * 0.9, 1.6, roof, T.h);
    // piers toward the stands
    const A = ap.apron;
    for (let k = 0; k < ap.stands.length; k += 2) {
      const s = ap.stands[k];
      const c = { x: s.x + A.n.x * 62 + A.u.x * 20, z: s.z + A.n.z * 62 + A.u.z * 20 };
      box(c, A.n, 26, 2.2, 3.2, bMat, 4.2);
    }
  }
  // control tower
  {
    const h = ap.towerH, t = ap.tower;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, h, 12), bMat);
    shaft.position.set(t.x, y0 + h / 2, t.z); shaft.castShadow = true; group.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 5.5, 6, 12), glass);
    cab.position.set(t.x, y0 + h + 3, t.z); cab.castShadow = true; group.add(cab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.8, 12), roof);
    cap.position.set(t.x, y0 + h + 6.4, t.z); group.add(cap);
    const beacon = new LightSet();
    beacon.add(t.x, y0 + h + 9, t.z, [0.3, 1, 0.4], 3.5);
    beacon.add(t.x, y0 + h + 9.01, t.z, WHITE, 3.5);
    const bp = beacon.build(); bp.userData.beacon = true; group.add(bp);
  }
  group.userData = { ap, disposables, glass };
  return group;
}

export function disposeAirportScenery(group) {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  for (const d of group.userData.disposables) d.dispose();
}

/** Instanced city blocks for scale cues. cities: [{x, z, r, n, hMax}], heightAt(x, z). */
export function buildCities(cities, heightAt) {
  let total = 0;
  for (const c of cities) total += c.n;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  let seed = 9173;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let i = 0;
  for (const c of cities) {
    for (let k = 0; k < c.n; k++) {
      const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 1.7) * c.r;
      const gx = Math.round((c.x + Math.cos(a) * rr) / 95) * 95, gz = Math.round((c.z + Math.sin(a) * rr) / 95) * 95;
      const central = 1 - rr / c.r;
      const h = 18 + Math.pow(rnd(), 2.2) * c.hMax * (0.25 + 0.75 * central * central);
      const w = 26 + rnd() * 34, d = 26 + rnd() * 34;
      const gy = heightAt(gx, gz);
      if (gy < 0.5) { s.set(0, 0, 0); } else s.set(w, h, d);
      p.set(gx, gy - 2, gz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
      const v = 0.42 + rnd() * 0.3;
      col.setRGB(v * (0.95 + rnd() * 0.1), v, v * (1 + rnd() * 0.12));
      mesh.setColorAt(i, col);
      i++;
    }
  }
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'cities';
  return mesh;
}
export { M_PER_FT, clamp };
