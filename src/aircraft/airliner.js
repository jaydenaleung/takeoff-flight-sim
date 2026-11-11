// Procedural, to-scale airliner models built from the published dimensions in specs.js.
// Body frame: origin at the centre of gravity, +X right, +Y up, +Z aft. Units are metres.
import * as THREE from 'three';
import { MeshBuilder, loftSurface, hingedSurface, makeLight } from './loft.js';
import { deriveGeometry } from './specs.js';
import { DEG, clamp, lerp, smoothstep } from '../core/units.js';

export const LIVERIES = {
  b738: { accent: '#0b3a82', accent2: '#d8232a', title: 'TAKEOFF', tail: 'chevron' },
  b748: { accent: '#9c1c2b', accent2: '#e9b949', title: 'TAKEOFF', tail: 'sun' },
  b77w: { accent: '#102a54', accent2: '#c9a24a', title: 'TAKEOFF', tail: 'bands' },
  b789: { accent: '#0e6ba8', accent2: '#7fd1f0', title: 'TAKEOFF', tail: 'wave' },
  a20n: { accent: '#00756f', accent2: '#f28c28', title: 'TAKEOFF', tail: 'bands' },
  a333: { accent: '#1d6b3a', accent2: '#b8d94a', title: 'TAKEOFF', tail: 'wave' },
  a359: { accent: '#23272e', accent2: '#3fa7ff', title: 'TAKEOFF', tail: 'chevron' },
  a388: { accent: '#4b2a7b', accent2: '#d9b25a', title: 'TAKEOFF', tail: 'sun' },
};

/** Fuselage radius/centre-line as a function of distance from the nose. */
export function fuselageShape(spec) {
  const L = spec.dims.fuseL || spec.dims.length;
  const a = spec.dims.fuseW / 2, b = spec.dims.fuseH / 2;
  const noseL = (spec.dims.hump ? 1.45 : 1.75) * spec.dims.fuseW;
  const tailL = Math.min(3.1 * spec.dims.fuseW, 0.3 * L);
  const hump = spec.dims.hump;
  const fn = (d) => {
    d = clamp(d, 0.0005 * L, L);
    let k = 1, yc = 0;
    if (d < noseL) {
      const s = d / noseL;
      k = Math.pow(Math.sin((s * Math.PI) / 2), 0.72);
      yc = -0.24 * b * Math.pow(1 - s, 1.7);
    } else if (d > L - tailL) {
      const s = (d - (L - tailL)) / tailL;
      k = 1 - 0.9 * Math.pow(s, 1.45);
      yc = (1 - k) * b * 0.86;
    }
    let hw = 0;
    if (hump) {
      const t = d / L;
      hw = smoothstep(hump.from, hump.from + 0.045, t) * (1 - smoothstep(hump.to - 0.17, hump.to, t)) * Math.sqrt(k);
    }
    return { a: a * k, b: b * k, yc, k, hw, top: yc + b * k + (hump ? hump.h * hw : 0) };
  };
  fn.L = L; fn.noseL = noseL; fn.tailL = tailL;
  return fn;
}

function paintFuselage(spec, shape, livery, detail) {
  if (typeof document === 'undefined') return null;
  const W = 1024, H = detail > 0.5 ? 4096 : 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const L = shape.L;
  const circ = Math.PI * (spec.dims.fuseW + spec.dims.fuseH) / 2;
  const sx = H / L, sy = W / circ;            // pixels per metre along / around
  g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, W, H);
  // belly
  g.fillStyle = '#b4bac3';
  g.fillRect(0, 0, W * 0.12, H); g.fillRect(W * 0.88, 0, W * 0.12, H);
  // tail sweep in the accent colours
  const sweep = (col, v0, slope) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      const side = Math.abs(x / W - 0.5);            // 0 at the top, 0.5 at the belly
      g.lineTo(x, (v0 + (0.5 - side) * slope) * H);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  sweep(livery.accent2, 0.705, 0.26);
  sweep(livery.accent, 0.73, 0.26);
  // nose anti-glare panel
  g.fillStyle = '#20242b';
  g.beginPath(); g.ellipse(W / 2, (0.34 * spec.dims.fuseW) * sx, W * 0.045, 0.2 * spec.dims.fuseW * sx, 0, 0, 7); g.fill();

  const dAng = (h) => (Math.asin(clamp(h, -0.9, 0.9)) / (2 * Math.PI));   // height fraction -> u offset
  const rows = [];
  if (spec.id === 'a388') { rows.push({ du: dAng(-0.12), v0: 0.1, v1: 0.83 }, { du: dAng(0.52), v0: 0.12, v1: 0.8 }); }
  else rows.push({ du: dAng(0.2), v0: 0.105, v1: 0.82 });
  if (spec.dims.hump) rows.push({ du: 0.25 - 0.115, v0: spec.dims.hump.from + 0.07, v1: spec.dims.hump.to - 0.11, hump: true });
  const doorsV = L > 55 ? [0.085, 0.3, 0.6, 0.845] : [0.095, 0.84];
  const ww = 0.25 * sx, wh = 0.36 * sy, pitch = 0.53 * sx;
  for (const r of rows) {
    for (const side of [0.25 + r.du, 0.75 - r.du]) {
      const cx = side * W;
      // cheat line under the windows
      if (!r.hump) {
        g.fillStyle = livery.accent;
        const off = (side < 0.5 ? -1 : 1) * 0.36 * sy;
        g.fillRect(cx + off - 2, r.v0 * H, 4, (0.74 - r.v0) * H);
      }
      for (let y = r.v0 * H; y < r.v1 * H; y += pitch) {
        const v = y / H;
        if (doorsV.some((d) => Math.abs(v - d) < 0.9 / L)) continue;
        g.fillStyle = '#1b2430';
        g.beginPath();
        g.roundRect(cx - wh / 2, y - ww / 2, wh, ww, Math.min(ww, wh) * 0.4);
        g.fill();
      }
    }
  }
  // doors
  g.strokeStyle = 'rgba(60,66,76,0.75)'; g.lineWidth = 2;
  for (const dv of doorsV) {
    for (const side of [0.25 + dAng(0.05), 0.75 - dAng(0.05)]) {
      const dh = 1.9 * sy, dw = 0.95 * sx;
      g.strokeRect(side * W - dh / 2, dv * H - dw / 2, dh, dw);
    }
  }
  // flight-deck glazing
  const d0 = 0.4 * spec.dims.fuseW, d1 = 0.72 * spec.dims.fuseW;
  const humpShift = spec.dims.hump ? 0.8 * spec.dims.fuseW : 0;
  g.fillStyle = '#0d1420';
  const panes = [[0.385, 0.42, 0.25], [0.424, 0.461, 0.1], [0.465, 0.497, 0]];
  for (const [u0, u1, skew] of panes) {
    for (const m of [0, 1]) {
      const a0 = m ? 1 - u1 : u0, a1 = m ? 1 - u0 : u1;
      const y0 = (d0 + humpShift + skew * (d1 - d0)) * sx, y1 = (d1 + humpShift + skew * 0.5 * (d1 - d0)) * sx;
      g.fillRect(a0 * W, y0, (a1 - a0) * W, y1 - y0);
    }
  }
  // titles
  const title = livery.title;
  const drawTitle = (u, port) => {
    g.save();
    const hM = Math.min(1.5, spec.dims.fuseW * 0.3);
    const ax = u * W, ay = (0.17 + (port ? 0 : 0.0)) * H;
    if (port) g.setTransform(0, sx * hM / 100, sy * hM / 100, 0, ax, ay);
    else g.setTransform(0, -sx * hM / 100, -sy * hM / 100, 0, ax, ay + title.length * hM * 0.62 * sx);
    g.fillStyle = livery.accent;
    g.font = '700 100px "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  };
  drawTitle(0.75 - dAng(0.2) - 0.075, true);
  drawTitle(0.25 + dAng(0.2) + 0.075, false);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;           // v = 0 at the nose (top of the canvas)
  tex.anisotropy = 8;
  return tex;
}

/** Tail artwork: u runs from the leading edge to the trailing edge, v from root to tip. */
function paintTail(livery) {
  if (typeof document === 'undefined') return null;
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = livery.accent; g.fillRect(0, 0, W, H);
  const a2 = livery.accent2, wh = 'rgba(255,255,255,0.92)';
  // canvas y = 0 is the fin tip, y = H the root
  if (livery.tail === 'sun') {
    for (let i = 5; i >= 0; i--) {
      g.beginPath(); g.arc(W * 0.42, H * 1.02, 70 + i * 62, 0, Math.PI * 2);
      g.fillStyle = i % 2 ? livery.accent : a2; g.globalAlpha = i % 2 ? 1 : 0.95 - i * 0.1; g.fill();
    }
    g.globalAlpha = 1;
  } else if (livery.tail === 'bands') {
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.62);
    g.fillStyle = a2; g.fillRect(-400, 30, 800, 86);
    g.fillStyle = wh; g.fillRect(-400, 132, 800, 22);
    g.fillStyle = a2; g.fillRect(-400, 170, 800, 34);
    g.restore();
  } else if (livery.tail === 'wave') {
    g.fillStyle = a2;
    g.beginPath(); g.moveTo(0, H); g.bezierCurveTo(W * 0.5, H * 0.92, W * 0.55, H * 0.42, W, H * 0.2); g.lineTo(W, H); g.fill();
    g.strokeStyle = wh; g.lineWidth = 12;
    g.beginPath(); g.moveTo(0, H * 0.98); g.bezierCurveTo(W * 0.48, H * 0.9, W * 0.53, H * 0.4, W, H * 0.17); g.stroke();
  } else {
    g.lineJoin = 'miter'; g.lineCap = 'butt';
    for (let i = 0; i < 4; i++) {
      const y = H * 0.9 - i * 96;
      g.strokeStyle = i === 1 ? wh : a2; g.lineWidth = i === 1 ? 16 : 40;
      g.beginPath(); g.moveTo(-20, y + 70); g.lineTo(W * 0.5, y - 40); g.lineTo(W + 20, y + 70); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function fanTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#16181c'; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  for (let i = 0; i < 22; i++) {
    g.rotate((Math.PI * 2) / 22);
    g.fillStyle = i % 2 ? '#3a3f47' : '#565c66';
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(40, -6, 126, -22); g.lineTo(126, 2); g.quadraticCurveTo(50, 10, 0, 0); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let _fanTex;

function wheel(r, w, mat) {
  const g = new THREE.CylinderGeometry(r, r, w, 16);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
function strut(x0, y0, z0, x1, y1, z1, r, mat) {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  m.castShadow = true;
  return m;
}

/** Winglet / sharklet sections from the wing-tip section to the top. */
function wingletSections(tipSec, out, up, curved) {
  const r = curved ? Math.min(out, up) * 0.8 : Math.min(out * 0.9, up * 0.3);
  let lo = 0.2, hi = Math.PI / 2;
  const f = (p) => (out - r * Math.sin(p)) * Math.sin(p) - (up - r * (1 - Math.cos(p))) * Math.cos(p);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  const psi = (lo + hi) / 2;
  const ex = r * Math.sin(psi), ey = r * (1 - Math.cos(psi));
  const straight = Math.hypot(out - ex, up - ey);
  const S = r * psi + straight;
  const pts = [];
  const nArc = curved ? 7 : 4;
  for (let k = 1; k <= nArc; k++) { const p = (psi * k) / nArc; pts.push({ s: r * p, x: r * Math.sin(p), y: r * (1 - Math.cos(p)), p }); }
  for (const q of [0.5, 1]) pts.push({ s: r * psi + straight * q, x: ex + (out - ex) * q, y: ey + (up - ey) * q, p: psi });
  return pts.map((q) => {
    const f2 = q.s / S;
    const c = tipSec.c * (1 - 0.7 * Math.pow(f2, 0.85));
    return {
      le: [tipSec.le[0] + q.x, tipSec.le[1] + q.y, tipSec.le[2] + q.s * 0.95 + (tipSec.c - c) * 0.15],
      c, t: 0.09, up: [-Math.sin(q.p), Math.cos(q.p), 0], camber: 0,
    };
  });
}

function buildNacelle(spec, mats) {
  const e = spec.eng, R = e.nacD / 2, Ln = e.nacL;
  const grp = new THREE.Group();
  // outer cowl (lathe about the engine axis)
  const prof = [
    [R * 0.80, -0.5], [R * 0.9, -0.497], [R * 0.955, -0.47], [R * 1.0, -0.3], [R * 0.99, -0.1],
    [R * 0.93, 0.12], [R * 0.84, 0.3], [R * 0.8, 0.33],
  ].map(([r, z]) => new THREE.Vector2(r, z * Ln));
  const cowl = new THREE.LatheGeometry(prof, 28); cowl.rotateX(Math.PI / 2);
  grp.add(new THREE.Mesh(cowl, mats.nacelle));
  // intake lip ring (bare metal) and inner duct
  const lip = new THREE.LatheGeometry([[R * 0.8, -0.5], [R * 0.76, -0.49], [R * 0.74, -0.46]].map(([r, z]) => new THREE.Vector2(r, z * Ln)), 28);
  lip.rotateX(Math.PI / 2);
  grp.add(new THREE.Mesh(lip, mats.metal));
  const duct = new THREE.LatheGeometry([[R * 0.74, -0.46], [R * 0.76, -0.36]].map(([r, z]) => new THREE.Vector2(r, z * Ln)), 28);
  duct.rotateX(Math.PI / 2);
  grp.add(new THREE.Mesh(duct, mats.dark));
  // fan face and spinner
  const fanMat = mats.fan;
  const fan = new THREE.Mesh(new THREE.CircleGeometry(R * 0.76, 28), fanMat);
  fan.position.z = -0.37 * Ln; fan.rotation.y = Math.PI;
  grp.add(fan);
  const spin = new THREE.Mesh(new THREE.ConeGeometry(R * 0.2, R * 0.42, 16), mats.spinner);
  spin.rotation.x = -Math.PI / 2; spin.position.z = -0.37 * Ln - R * 0.2;
  grp.add(spin);
  // core cowl, exhaust and plug
  const core = new THREE.LatheGeometry([
    [R * 0.62, 0.3], [R * 0.56, 0.42], [R * 0.42, 0.5], [R * 0.4, 0.5],
  ].map(([r, z]) => new THREE.Vector2(r, z * Ln)), 20);
  core.rotateX(Math.PI / 2);
  grp.add(new THREE.Mesh(core, mats.metal));
  const plug = new THREE.Mesh(new THREE.ConeGeometry(R * 0.3, Ln * 0.2, 16), mats.metalDark);
  plug.rotation.x = Math.PI / 2; plug.position.z = 0.55 * Ln;
  grp.add(plug);
  grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  grp.userData.fan = fan;
  return grp;
}

export function buildAirliner(spec, opts = {}) {
  const detail = opts.detail ?? 1;
  const geo = deriveGeometry(spec);
  const d = spec.dims, cgX = geo.cgX;
  const livery = { ...(LIVERIES[spec.id] || LIVERIES.b738), ...(opts.livery || {}) };
  const shape = fuselageShape(spec);
  const fuseL = shape.L;
  const zNose = -cgX, zEnd = d.length - cgX, zFuseEnd = fuseL - cgX;
  const group = new THREE.Group();
  group.name = spec.id;

  const tex = paintFuselage(spec, shape, livery, detail);
  if (!_fanTex) _fanTex = fanTexture();
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0xf0f1f3, map: tex, roughness: 0.38, metalness: 0.15, side: THREE.DoubleSide }),
    wing: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.42, metalness: 0.45, side: THREE.DoubleSide }),
    paint: new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.38, metalness: 0.15, side: THREE.DoubleSide }),
    accent: new THREE.MeshStandardMaterial({ color: livery.accent, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide }),
    nacelle: new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.36, metalness: 0.2, side: THREE.DoubleSide }),
    tail: null,
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9, metalness: 0 }),
    fan: new THREE.MeshStandardMaterial({ color: 0xffffff, map: _fanTex, roughness: 0.6, metalness: 0.5 }),
    spinner: new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.3, metalness: 0.6 }),
  };

  const tailTex = paintTail(livery);
  mats.tail = tailTex
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: tailTex, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide })
    : mats.accent;

  // ---------------------------------------------------------------- fuselage
  {
    const mb = new MeshBuilder();
    const N = detail > 0.5 ? 32 : 20;
    const ds = [];
    for (let i = 0; i <= 12; i++) ds.push(shape.noseL * Math.pow(i / 12, 1.7));
    const midN = Math.max(6, Math.round((fuseL - shape.noseL - shape.tailL) / (spec.dims.hump ? 2.2 : 5)));
    for (let i = 1; i < midN; i++) ds.push(shape.noseL + ((fuseL - shape.noseL - shape.tailL) * i) / midN);
    for (let i = 0; i <= 9; i++) ds.push(fuseL - shape.tailL + (shape.tailL * i) / 9);
    const rings = ds.map((dd) => {
      const s = shape(dd), ring = [];
      for (let j = 0; j <= N; j++) {
        const th = (j / N) * Math.PI * 2;
        const cs = -Math.cos(th);                  // +1 at the top
        let x = s.a * Math.sin(th), y = s.yc + s.b * cs;
        if (s.hw > 0 && cs > 0) {
          y += d.hump.h * s.hw * Math.pow(cs, 1.1);
          x *= 1 - 0.3 * s.hw * cs * cs;
        }
        ring.push([x, y, zNose + dd]);
      }
      return ring;
    });
    mb.loft(rings, { uv: (i, j) => [j / N, ds[i] / fuseL] });
    mb.cap(rings[rings.length - 1]);
    const mesh = new THREE.Mesh(mb.build(), mats.body);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------------------------------------------------------- wing
  const semi = geo.semi, tip = spec.wing.tip;
  const yF = d.fuseW / 2;
  const yk = spec.eng.span[0] + 0.05 * semi;
  const yr = tip === 'raked' ? 0.9 * semi : semi;
  const trap = (y) => geo.cr + ((geo.ct - geo.cr) * y) / semi;
  const zLE = (y) => (y <= yr ? geo.le(y).z : geo.le(yr).z + (y - yr) * Math.tan(57 * DEG));
  const zTEk = geo.le(yk).z + trap(yk);
  const chord = (y) => {
    if (y < yk) return zTEk - (yk - y) * 0.035 - zLE(y);
    if (y > yr) return lerp(trap(yr), 0.3 * trap(yr), (y - yr) / (semi - yr));
    return trap(y);
  };
  const sec = (y) => ({
    le: [y, geo.wingY + y * geo.dih, zLE(y)], c: chord(y),
    t: lerp(0.14, 0.1, clamp(y / semi, 0, 1)), up: [0, 1, 0], camber: 0.018,
  });
  const HINGE = 0.72;
  const right = new THREE.Group();
  const yDev = Math.min(0.9 * semi, yr - 0.2);
  {
    const mb = new MeshBuilder();
    const ys = [0, yF, yk, (yk + yDev) / 2, yDev];
    loftSurface(mb, ys.map(sec), 0, HINGE, { n: 9, back: true });
    const outer = tip === 'raked' ? [yDev, yr, (yr + semi) / 2, semi] : [yDev, semi];
    loftSurface(mb, outer.map(sec), 0, 1, { n: 9, capA: true, capB: true });
    // fixed trailing edge inside the fuselage fairing
    loftSurface(mb, [0, yF + 0.2].map(sec), HINGE, 1, { n: 4 });
    const m = new THREE.Mesh(mb.build(), mats.wing);
    m.castShadow = true; m.receiveShadow = true;
    right.add(m);
  }
  const dev = (name, y0, y1, from, to, mat) => {
    const p = hingedSurface([sec(y0), sec(y1)], from, to, mat || mats.wing);
    p.name = name;
    right.add(p);
    return p;
  };
  dev('flapIn', yF + 0.25, yk - 0.12, HINGE, 1);
  dev('flapOut', yk + 0.12, 0.69 * semi, HINGE, 1);
  dev('aileron', 0.71 * semi, yDev - 0.1, HINGE, 1);
  // spoiler panels: thin plates lying on the upper surface ahead of the flaps
  const spoilerSec = (y) => { const s = sec(y); return { ...s, le: [s.le[0], s.le[1] + s.c * 0.052, s.le[2]], t: 0.012, camber: 0 }; };
  for (const [name, y0, y1] of [['spoilerIn', yF + 0.8, yk - 0.4], ['spoilerOut', yk + 0.5, 0.66 * semi]]) {
    const p = hingedSurface([spoilerSec(y0), spoilerSec(y1)], 0.6, 0.715, mats.wing, { n: 3 });
    p.name = name; right.add(p);
  }
  // tip device
  if (tip === 'blended' || tip === 'sharklet' || tip === 'curved') {
    const mb = new MeshBuilder();
    const secs = [sec(semi), ...wingletSections(sec(semi), spec.wing.tipOut, spec.wing.tipH, tip === 'curved')];
    loftSurface(mb, secs, 0, 1, { n: 7, capB: true });
    const m = new THREE.Mesh(mb.build(), mats.accent);
    m.castShadow = true; right.add(m);
  } else if (tip === 'fence') {
    const s0 = sec(semi), mb = new MeshBuilder();
    const mk = (dy, c, dz) => ({ le: [s0.le[0] - 0.11, s0.le[1] + dy, s0.le[2] + dz], c, t: 0.06, up: [1, 0, 0], camber: 0 });
    const h = spec.wing.tipH;
    loftSurface(mb, [mk(-h * 0.45, s0.c * 0.25, s0.c * 0.75), mk(0, s0.c * 1.0, 0.1), mk(h * 0.55, s0.c * 0.25, s0.c * 0.95)], 0, 1, { n: 5, capA: true, capB: true });
    const m = new THREE.Mesh(mb.build(), mats.paint); m.castShadow = true; right.add(m);
  }

  // ---------------------------------------------------------------- horizontal tail
  const hSemi = spec.tail.hSpan / 2;
  const hMean = spec.tail.hArea / spec.tail.hSpan;
  const hCr = (2 * hMean) / 1.32, hCt = 0.32 * hCr;
  const hTanLE = Math.tan(36 * DEG);
  const hTipLE = zEnd - hCt - 0.02;
  const hRootLE = hTipLE - hSemi * hTanLE;
  const hY0 = shape(clamp(hRootLE + cgX + hCr * 0.4, 0, fuseL)).yc * 0.9 + 0.1 * d.fuseH / 2;
  const hSec = (y) => ({
    le: [y, hY0 + y * Math.tan(7 * DEG), hRootLE + y * hTanLE], c: lerp(hCr, hCt, y / hSemi),
    t: 0.1, up: [0, 1, 0], camber: -0.005,
  });
  {
    const mb = new MeshBuilder();
    loftSurface(mb, [hSec(0), hSec(hSemi)], 0, 0.68, { n: 7, back: true, capB: true });
    loftSurface(mb, [hSec(0), hSec(0.13 * hSemi)], 0.68, 1, { n: 3 });
    const m = new THREE.Mesh(mb.build(), mats.wing); m.castShadow = true; right.add(m);
    const el = hingedSurface([hSec(0.14 * hSemi), hSec(hSemi - 0.05)], 0.68, 1, mats.wing);
    el.name = 'elevator'; right.add(el);
  }

  const left = right.clone(true);
  left.scale.x = -1;
  group.add(right, left);

  // ---------------------------------------------------------------- wing-to-body fairing
  {
    const rootC = chord(0);
    const f = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.paint);
    f.scale.set(d.fuseW * 0.56, d.fuseH * 0.2, rootC * 0.72);
    f.position.set(0, -d.fuseH * 0.4, zLE(0) + rootC * 0.5);
    f.castShadow = true;
    group.add(f);
  }

  // ---------------------------------------------------------------- fin and rudder
  const yTip = d.height - spec.gear.cgH;
  const finZ = clamp(zFuseEnd - cgX * 0 - 0.0, zFuseEnd - 1, zFuseEnd);
  const vTipTE = Math.min(zEnd, finZ + 0.6);
  const topAt = (z) => shape(clamp(z + cgX, 0, fuseL)).top;
  const yFuseTop = topAt(vTipTE - 0.25 * d.length * 0.2);
  const hExp = yTip - yFuseTop;
  const vMean = spec.tail.vArea / hExp;
  const vCr = (2 * vMean) / 1.3, vCt = 0.3 * vCr;
  const vTanLE = Math.tan(43 * DEG);
  const yRoot = yFuseTop - 0.9;
  const hFin = yTip - yRoot;
  const vTipLE = vTipTE - vCt;
  const vSec = (h) => {
    const f = h / hFin;
    const c = vCr + (vCt - vCr) * ((h - 0.9) / (hFin - 0.9));
    return { le: [0, yRoot + h, vTipLE - (hFin - h) * vTanLE], c, t: 0.09, up: [1, 0, 0], camber: 0, f, v: f };
  };
  {
    const mb = new MeshBuilder();
    loftSurface(mb, [vSec(0), vSec(hFin)], 0, 0.68, { n: 7, back: true, capB: true, uvChord: true });
    const m = new THREE.Mesh(mb.build(), mats.tail); m.castShadow = true; group.add(m);
    const rud = hingedSurface([vSec(1.0), vSec(hFin - 0.05)], 0.68, 1, mats.tail, { uvChord: true });
    rud.name = 'rudder'; group.add(rud);
  }

  // ---------------------------------------------------------------- engines
  const fans = [];
  for (const mnt of geo.engines) {
    const nac = buildNacelle(spec, mats);
    nac.position.set(mnt.x, mnt.y, mnt.z);
    group.add(nac);
    fans.push(nac.userData.fan);
    // pylon
    const s = sec(Math.abs(mnt.x));
    const mb = new MeshBuilder();
    const yTop = s.le[1] - 0.02 * s.c, zA = mnt.z - spec.eng.nacL * 0.18, zB = s.le[2] + s.c * 0.42;
    const yN = mnt.y + spec.eng.nacD * 0.42;
    mb.plate([[mnt.x, yN, zA], [mnt.x, yTop + 0.25, s.le[2] - 0.15], [mnt.x, yTop, zB], [mnt.x, yN - 0.2, mnt.z + spec.eng.nacL * 0.3]], 0.34, [1, 0, 0]);
    const p = new THREE.Mesh(mb.build(), mats.paint); p.castShadow = true; group.add(p);
  }

  // ---------------------------------------------------------------- landing gear
  const g = spec.gear;
  const rw = g.wheelD / 2, rn = rw * 0.72;
  const gearNose = new THREE.Group();
  {
    const top = shape(g.noseX).yc - shape(g.noseX).b * 0.7;
    gearNose.position.set(0, top, geo.gearNose.z);
    const axleY = -g.cgH + rn - top;
    gearNose.add(strut(0, 0, 0, 0, axleY, 0, 0.11, mats.metal));
    const wl = wheel(rn, rn * 0.55, mats.tire), wr = wheel(rn, rn * 0.55, mats.tire);
    wl.position.set(-rn * 0.42, axleY, 0); wr.position.set(rn * 0.42, axleY, 0);
    gearNose.add(wl, wr);
    gearNose.userData.wheels = [wl, wr];
    gearNose.userData.r = rn;
  }
  group.add(gearNose);
  const gearMain = [];
  const mkBogie = (x, z, wheels, inner) => {
    const grp = new THREE.Group();
    const top = inner ? -d.fuseH * 0.38 : sec(Math.min(Math.abs(x), yk)).le[1] - 0.2;
    grp.position.set(x, top, z);
    const axleY = -g.cgH + rw - top;
    grp.add(strut(0, 0, 0, 0, axleY + rw * 0.2, 0, rw * 0.2, mats.metal));
    const axles = Math.max(1, Math.round(wheels / 2));
    const ws = [];
    for (let i = 0; i < axles; i++) {
      const dz = (i - (axles - 1) / 2) * rw * 2.25;
      for (const sx of [-1, 1]) {
        const w = wheel(rw, rw * 0.72, mats.tire);
        w.position.set(sx * rw * 0.62, axleY, dz);
        grp.add(w); ws.push(w);
      }
    }
    if (axles > 1) grp.add(strut(0, axleY, -(axles - 1) * rw * 1.12, 0, axleY, (axles - 1) * rw * 1.12, rw * 0.16, mats.metal));
    grp.userData.wheels = ws; grp.userData.r = rw; grp.userData.side = Math.sign(x) || 1; grp.userData.inner = inner;
    group.add(grp); gearMain.push(grp);
  };
  const zMain = geo.gearMain[0].z;
  if (g.bogies === 4) {
    const wingW = spec.id === 'a388' ? 4 : 4, bodyW = spec.id === 'a388' ? 6 : 4;
    mkBogie(-g.track / 2, zMain - 1.4, wingW, false); mkBogie(g.track / 2, zMain - 1.4, wingW, false);
    mkBogie(-g.track * 0.19, zMain + 1.9, bodyW, true); mkBogie(g.track * 0.19, zMain + 1.9, bodyW, true);
  } else {
    mkBogie(-g.track / 2, zMain, g.mainWheels, false); mkBogie(g.track / 2, zMain, g.mainWheels, false);
  }

  // ---------------------------------------------------------------- lights
  const lights = { nav: [], strobe: [], beacon: [], landing: [], all: [] };
  if (typeof document !== 'undefined') {
    const tipS = sec(semi);
    const tx = d.span / 2, ty = tipS.le[1] + (spec.wing.tipH && tip !== 'fence' ? 0 : 0), tz = tipS.le[2] + tipS.c * 0.4;
    const add = (kind, color, size, x, y, z) => { const l = makeLight(color, size); l.position.set(x, y, z); group.add(l); lights[kind].push(l); lights.all.push(l); return l; };
    add('nav', 0xff2a2a, 0.55, -semi, ty, tz); add('nav', 0x2aff4a, 0.55, semi, ty, tz); add('nav', 0xffffff, 0.5, 0, shape(fuseL - 0.3).yc, zFuseEnd + 0.1);
    add('strobe', 0xffffff, 1.8, -tx + 0.2, ty, tz + 0.3); add('strobe', 0xffffff, 1.8, tx - 0.2, ty, tz + 0.3);
    add('beacon', 0xff2020, 1.3, 0, d.fuseH / 2 + (d.hump ? d.hump.h * 0.0 : 0) + 0.15, zLE(0) + 2); add('beacon', 0xff2020, 1.3, 0, -d.fuseH / 2 - 0.3, zLE(0) + 4);
    add('landing', 0xfff6dd, 2.6, -yF - 0.7, geo.wingY + 0.1, zLE(yF) + 0.3); add('landing', 0xfff6dd, 2.6, yF + 0.7, geo.wingY + 0.1, zLE(yF) + 0.3);
    add('landing', 0xfff6dd, 2.0, 0, -g.cgH + 1.6, geo.gearNose.z - 0.2);
  }

  return { group, geo, right, left, gearNose, gearMain, fans, lights, mats, kind: 'airliner' };
}
