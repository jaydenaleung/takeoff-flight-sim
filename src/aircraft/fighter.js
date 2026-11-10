// Procedural, to-scale fighter models. Each type is described by a table of fuselage stations
// (fraction of overall length, half-width, height above/below the reference line, super-ellipse
// exponent) plus tail, canopy and nozzle parameters. Wings come from the shared spec geometry.
import * as THREE from 'three';
import { MeshBuilder, loftSurface, hingedSurface, makeLight } from './loft.js';
import { deriveGeometry } from './specs.js';
import { DEG, lerp } from '../core/units.js';

// station: [t, halfWidth, up, down, yRef, exponent]
const TYPES = {
  f16: {
    color: 0x8b9299, color2: 0x6f767d, canopyTint: 0xb9954a,
    st: [
      [0.0, 0.03, 0.03, 0.03, -0.1, 2], [0.05, 0.2, 0.21, 0.2, -0.08, 2], [0.12, 0.36, 0.38, 0.36, -0.04, 2],
      [0.2, 0.48, 0.5, 0.48, 0, 2], [0.28, 0.56, 0.56, 0.58, 0, 2.2], [0.3, 0.58, 0.57, 0.6, 0, 2.2],
      [0.302, 0.62, 0.57, 1.02, 0, 2.4], [0.42, 0.74, 0.62, 1.0, 0, 2.6], [0.56, 0.8, 0.64, 0.94, 0, 2.6],
      [0.72, 0.78, 0.62, 0.84, 0, 2.4], [0.86, 0.68, 0.6, 0.68, 0, 2.1], [0.935, 0.6, 0.58, 0.6, 0, 2],
    ],
    canopy: { t0: 0.165, t1: 0.4, w: 0.4, h: 0.6 },
    nozzle: { xs: [0], r0: 0.58, r1: 0.46, tEnd: 1.0 },
    fins: { x: 0, cant: 0, t: 0.66, cr: 3.2, ct: 1.05, sweep: 47, yRoot: 0.5 },
    stab: { x: 0.55, cr: 2.45, ct: 0.85, sweep: 40, dih: -10, t: 0.8, y: -0.05 },
    lerx: { t0: 0.25, x0: 0.5, x1: 1.3 },
    ventral: true, missiles: true,
  },
  f18: {
    color: 0x9aa1a8, color2: 0x7c838a, canopyTint: 0x8fa0b0,
    st: [
      [0, 0.03, 0.03, 0.03, -0.05, 2], [0.06, 0.26, 0.27, 0.26, -0.03, 2], [0.14, 0.42, 0.45, 0.42, 0, 2],
      [0.22, 0.52, 0.56, 0.52, 0, 2.1], [0.31, 0.6, 0.62, 0.62, 0, 2.2], [0.375, 0.64, 0.62, 0.7, 0, 2.3],
      [0.378, 1.22, 0.6, 0.82, 0, 3.4], [0.52, 1.25, 0.62, 0.86, 0, 3.4], [0.68, 1.25, 0.58, 0.84, 0, 3.2],
      [0.82, 1.22, 0.52, 0.74, 0, 3.0], [0.905, 1.1, 0.48, 0.6, 0, 2.6],
    ],
    canopy: { t0: 0.15, t1: 0.36, w: 0.42, h: 0.62 },
    nozzle: { xs: [-0.55, 0.55], r0: 0.48, r1: 0.4, tEnd: 0.955 },
    fins: { x: 0.95, cant: 20, t: 0.665, cr: 2.9, ct: 1.15, sweep: 41, yRoot: 0.45 },
    stab: { x: 1.15, cr: 2.5, ct: 1.0, sweep: 47, dih: -2, y: 0.1 },
    lerx: { t0: 0.22, x0: 0.5, x1: 1.95 },
    missiles: true,
  },
  f22: {
    color: 0x7f868d, color2: 0x646b72, canopyTint: 0xc9a13c,
    st: [
      [0, 0.03, 0.03, 0.03, 0, 1.7], [0.05, 0.25, 0.2, 0.18, 0, 1.6], [0.13, 0.55, 0.42, 0.34, 0, 1.6],
      [0.22, 0.82, 0.66, 0.46, 0, 1.7], [0.31, 0.95, 0.68, 0.54, 0, 1.8], [0.345, 1.0, 0.66, 0.56, 0, 1.9],
      [0.348, 1.95, 0.62, 0.78, 0, 3.2], [0.5, 1.95, 0.62, 0.82, 0, 3.4], [0.68, 1.95, 0.56, 0.78, 0, 3.4],
      [0.84, 1.8, 0.46, 0.62, 0, 3.2], [0.915, 1.55, 0.36, 0.46, 0, 3.0],
    ],
    canopy: { t0: 0.14, t1: 0.34, w: 0.46, h: 0.6 },
    nozzle: { xs: [-0.72, 0.72], flat: true, w: 1.0, h: 0.62, tEnd: 0.952 },
    fins: { x: 1.55, cant: 28, t: 0.655, cr: 3.7, ct: 1.3, sweep: 23, yRoot: 0.4 },
    stab: { x: 1.75, cr: 3.2, ct: 1.0, sweep: 42, dih: 0, y: 0.05 },
    lerx: { t0: 0.33, x0: 0.95, x1: 2.1 },
  },
  f35: {
    color: 0x666b71, color2: 0x51565c, canopyTint: 0x6a6f78,
    st: [
      [0, 0.03, 0.03, 0.03, 0, 1.8], [0.06, 0.28, 0.24, 0.22, 0, 1.7], [0.15, 0.56, 0.48, 0.4, 0, 1.8],
      [0.24, 0.76, 0.7, 0.52, 0, 1.9], [0.32, 0.86, 0.74, 0.58, 0, 2], [0.345, 0.9, 0.72, 0.6, 0, 2],
      [0.348, 1.62, 0.72, 0.88, 0, 3], [0.52, 1.65, 0.76, 0.96, 0, 3.2], [0.72, 1.55, 0.66, 0.86, 0, 3],
      [0.86, 1.05, 0.6, 0.68, 0, 2.4], [0.925, 0.66, 0.58, 0.6, 0, 2],
    ],
    canopy: { t0: 0.15, t1: 0.37, w: 0.44, h: 0.58 },
    nozzle: { xs: [0], r0: 0.6, r1: 0.48, tEnd: 0.975 },
    fins: { x: 1.15, cant: 25, t: 0.655, cr: 2.9, ct: 1.2, sweep: 42, yRoot: 0.5 },
    stab: { x: 1.3, cr: 2.8, ct: 1.0, sweep: 35, dih: 0, y: 0.05 },
    lerx: { t0: 0.33, x0: 0.85, x1: 1.75 },
  },
};

let _flameTex;
function flameTexture() {
  if (_flameTex || typeof document === 'undefined') return _flameTex;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.15, 'rgba(180,210,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,170,70,0.6)');
  grd.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 128);
  _flameTex = new THREE.CanvasTexture(c);
  return _flameTex;
}

function ringAt(st, z) {
  const [, w, up, dn, y, n] = st;
  const N = 28, ring = [];
  for (let j = 0; j < N; j++) {
    const th = (j / N) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const e = 2 / n;
    const x = w * Math.sign(c) * Math.pow(Math.abs(c), e);
    const yy = (s >= 0 ? up : dn) * Math.sign(s) * Math.pow(Math.abs(s), e);
    ring.push([x, y + yy, z]);
  }
  return ring;
}
function stationAt(sts, t) {
  for (let i = 0; i < sts.length - 1; i++) {
    if (t <= sts[i + 1][0]) {
      const f = (t - sts[i][0]) / Math.max(1e-6, sts[i + 1][0] - sts[i][0]);
      return sts[i].map((v, k) => lerp(v, sts[i + 1][k], f));
    }
  }
  return sts[sts.length - 1];
}

export function buildFighter(spec, opts = {}) {
  const T = TYPES[spec.id];
  const geo = deriveGeometry(spec);
  const d = spec.dims, L = d.length, cgX = geo.cgX;
  const zOf = (t) => t * L - cgX;
  const zEnd = L - cgX;
  const group = new THREE.Group();
  group.name = spec.id;
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: T.color, roughness: 0.48, metalness: 0.35, side: THREE.DoubleSide }),
    body2: new THREE.MeshStandardMaterial({ color: T.color2, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.45, metalness: 0.9, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9 }),
    canopy: new THREE.MeshPhysicalMaterial({ color: T.canopyTint, roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe6e7e9, roughness: 0.5, metalness: 0.2 }),
  };

  // ---------------------------------------------------------------- fuselage
  {
    const sts = [];
    for (let i = 0; i < T.st.length - 1; i++) {
      const a = T.st[i], b = T.st[i + 1];
      sts.push(a);
      const gap = b[0] - a[0];
      if (gap > 0.02) {
        const n = Math.ceil(gap / 0.035);
        for (let k = 1; k < n; k++) sts.push(a.map((v, q) => lerp(v, b[q], k / n)));
      }
    }
    sts.push(T.st[T.st.length - 1]);
    const mb = new MeshBuilder(), dk = new MeshBuilder();
    let run = [];
    for (let i = 0; i < sts.length; i++) {
      const ring = ringAt(sts[i], zOf(sts[i][0]));
      run.push(ring);
      const next = sts[i + 1];
      if (next && next[0] - sts[i][0] < 0.006) {       // intake step: dark face
        mb.loft(run, { closed: true }); run = [];
        dk.loft([ring, ringAt(next, zOf(next[0]))], { closed: true });
      }
    }
    mb.loft(run, { closed: true });
    mb.cap(run[run.length - 1]);
    const m = new THREE.Mesh(mb.build(), mats.body); m.castShadow = true; m.receiveShadow = true; group.add(m);
    if (dk.p.length) group.add(new THREE.Mesh(dk.build(), mats.dark));
  }
  // canopy
  {
    const c = T.canopy, mid = (c.t0 + c.t1) / 2, s = stationAt(T.st, mid);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), mats.canopy);
    m.scale.set(c.w, c.h, ((c.t1 - c.t0) * L) / 2);
    m.position.set(0, s[4] + s[2] - c.h * 0.42, zOf(mid));
    group.add(m);
  }

  // ---------------------------------------------------------------- wings, strakes, tails (right side, mirrored)
  const right = new THREE.Group();
  const semi = geo.semi;
  const bodyW = stationAt(T.st, (geo.xLeRoot + geo.cr * 0.5) / L)[1];
  const sec = (y) => ({ le: [y, geo.wingY + y * geo.dih, geo.le(y).z], c: geo.chord(y), t: 0.045, up: [0, 1, 0], camber: 0 });
  const HINGE = 0.76;
  {
    const mb = new MeshBuilder();
    const y0 = bodyW * 0.5;
    loftSurface(mb, [sec(y0), sec(0.94 * semi)], 0, HINGE, { n: 7, back: true });
    loftSurface(mb, [sec(0.94 * semi), sec(semi)], 0, 1, { n: 7, capB: true });
    loftSurface(mb, [sec(y0), sec(bodyW + 0.05)], HINGE, 1, { n: 3 });
    const m = new THREE.Mesh(mb.build(), mats.body); m.castShadow = true; m.receiveShadow = true; right.add(m);
    const fl = hingedSurface([sec(bodyW + 0.1), sec(0.58 * semi)], HINGE, 1, mats.body2); fl.name = 'flapOut'; right.add(fl);
    const al = hingedSurface([sec(0.6 * semi), sec(0.935 * semi)], HINGE, 1, mats.body2); al.name = 'aileron'; right.add(al);
  }
  // leading-edge extension / chine
  {
    const lx = T.lerx, zw = geo.le(lx.x1).z, mb = new MeshBuilder();
    const y = geo.wingY;
    mb.plate([[lx.x0, y, zOf(lx.t0)], [lx.x1, y + lx.x1 * geo.dih, zw], [lx.x1, y, zw + 0.6], [lx.x0 * 0.6, y, zw + 0.6]], 0.1);
    const m = new THREE.Mesh(mb.build(), mats.body); m.castShadow = true; right.add(m);
  }
  // wing-tip launch rail and missile
  if (T.missiles && spec.wing.tipOut) {
    const s = sec(semi), x = d.span / 2 - 0.09;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, s.c * 1.25), mats.body2);
    rail.position.set(semi + 0.06, s.le[1], s.le[2] + s.c * 0.5);
    right.add(rail);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 2.85, 10), mats.white);
    body.rotation.x = Math.PI / 2; body.position.set(x - 0.06, s.le[1], s.le[2] + s.c * 0.45);
    right.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.064, 0.3, 10), mats.dark);
    nose.rotation.x = -Math.PI / 2; nose.position.set(x - 0.06, s.le[1], s.le[2] + s.c * 0.45 - 1.57);
    right.add(nose);
    for (const a of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.4), mats.white);
      fin.rotation.z = a + Math.PI / 4; fin.position.set(x - 0.06, s.le[1], s.le[2] + s.c * 0.45 + 1.2);
      right.add(fin);
    }
  }
  // fin(s)
  const yTip = d.height - spec.gear.cgH;
  const F = T.fins;
  const cant = F.cant * DEG;
  const finLen = (yTip - F.yRoot) / Math.cos(cant);
  const finSec = (s) => ({
    le: [F.x + Math.sin(cant) * s, F.yRoot + Math.cos(cant) * s, zOf(F.t) + s * Math.tan(F.sweep * DEG)],
    c: lerp(F.cr, F.ct, s / finLen), t: 0.045, up: [Math.cos(cant), -Math.sin(cant), 0], camber: 0,
  });
  const finGroup = F.x === 0 ? group : right;
  {
    const mb = new MeshBuilder();
    loftSurface(mb, [finSec(-0.25), finSec(finLen)], 0, 0.7, { n: 6, back: true, capB: true });
    loftSurface(mb, [finSec(-0.25), finSec(0.12 * finLen)], 0.7, 1, { n: 3 });
    const m = new THREE.Mesh(mb.build(), mats.body); m.castShadow = true; finGroup.add(m);
    const rd = hingedSurface([finSec(0.13 * finLen), finSec(0.93 * finLen)], 0.7, 1, mats.body2);
    rd.name = 'rudder'; finGroup.add(rd);
    const tipFair = hingedSurface([finSec(0.94 * finLen), finSec(finLen)], 0.7, 1, mats.body, { n: 3 });
    finGroup.add(tipFair);
  }
  if (T.ventral) {
    const mb = new MeshBuilder();
    const z0 = zOf(0.73), z1 = zOf(0.85);
    mb.plate([[0.5, -0.7, z0], [0.5, -0.7, z1], [0.78, -1.28, z1 + 0.1], [0.74, -1.25, z0 + 0.8]], 0.05, [0.9, 0.44, 0]);
    right.add(new THREE.Mesh(mb.build(), mats.body2));
  }
  // all-moving stabilator
  {
    const S = T.stab, hSemi = spec.tail.hSpan / 2 - S.x;
    const tan = Math.tan(S.sweep * DEG);
    // the aft-most trailing-edge point (root or tip) defines the overall length
    const chordAt = (y) => lerp(S.cr, S.ct, y / hSemi);
    const rootLE = S.t != null ? zOf(S.t) : zEnd - Math.max(hSemi * tan + S.ct, -0.3 * tan + chordAt(-0.3));
    const dih = Math.tan(S.dih * DEG);
    const stSec = (y) => ({ le: [S.x + y, S.y + y * dih, rootLE + y * tan], c: lerp(S.cr, S.ct, y / hSemi), t: 0.04, up: [0, 1, 0], camber: 0 });
    const mb = new MeshBuilder();
    loftSurface(mb, [stSec(-0.3), stSec(hSemi)], 0, 1, { n: 7, capB: true });
    const geoS = mb.build();
    const pivot = new THREE.Group();
    pivot.position.set(S.x, S.y, rootLE + S.cr * 0.55);
    geoS.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    const m = new THREE.Mesh(geoS, mats.body2); m.castShadow = true;
    pivot.add(m); pivot.name = 'stab'; right.add(pivot);
  }
  const left = right.clone(true);
  left.scale.x = -1;
  group.add(right, left);

  // ---------------------------------------------------------------- nozzles and afterburner
  const flames = [];
  {
    const Nz = T.nozzle, last = T.st[T.st.length - 1];
    const z0 = zOf(last[0]) - 0.05, z1 = zOf(Nz.tEnd);
    for (const x of Nz.xs) {
      let noz;
      if (Nz.flat) {
        const mb = new MeshBuilder();
        const r = (z, w, h) => [[x - w, h, z], [x + w, h, z], [x + w, -h, z], [x - w, -h, z]];
        mb.loft([r(z0, Nz.w / 2, Nz.h / 2), r(z1, Nz.w / 2, Nz.h * 0.28)], { closed: true });
        noz = new THREE.Mesh(mb.build(), mats.nozzle);
        noz.position.y = last[4];
        const inner = new THREE.Mesh(new THREE.PlaneGeometry(Nz.w * 0.9, Nz.h * 0.5), mats.dark);
        inner.position.set(x, last[4], z1 - 0.02); group.add(inner);
      } else {
        const prof = [[Nz.r0, 0], [Nz.r0 * 0.98, 0.4], [Nz.r1, 1]].map(([r, f]) => new THREE.Vector2(r, lerp(z0, z1, f)));
        const g = new THREE.LatheGeometry(prof, 24); g.rotateX(Math.PI / 2);
        noz = new THREE.Mesh(g, mats.nozzle);
        noz.position.set(x, last[4] + (last[2] - last[3]) / 2, 0);
        const inner = new THREE.Mesh(new THREE.CircleGeometry(Nz.r1 * 0.97, 20), mats.dark);
        inner.position.set(x, noz.position.y, z1 - 0.25); group.add(inner);
      }
      noz.castShadow = true; group.add(noz);
      if (typeof document !== 'undefined') {
        const r = Nz.flat ? Nz.h * 0.45 : Nz.r1 * 0.92;
        const fg = new THREE.ConeGeometry(r, 1, 16, 1, true);
        fg.translate(0, -0.5, 0); fg.rotateX(-Math.PI / 2);     // apex pointing aft (+Z), base at origin
        const fm = new THREE.MeshBasicMaterial({ map: flameTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
        const fl = new THREE.Mesh(fg, fm);
        fl.position.set(x, Nz.flat ? last[4] : noz.position.y, z1 - 0.1);
        if (Nz.flat) fl.scale.x = 1.6;
        fl.visible = false; fl.renderOrder = 9;
        group.add(fl); flames.push(fl);
      }
    }
  }

  // ---------------------------------------------------------------- landing gear
  const g = spec.gear, rw = g.wheelD / 2, rn = rw * 0.78;
  const mkStrut = (len, r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mats.metal); m.position.y = -len / 2; m.castShadow = true; return m; };
  const mkWheel = (r, w) => { const gg = new THREE.CylinderGeometry(r, r, w, 14); gg.rotateZ(Math.PI / 2); const m = new THREE.Mesh(gg, mats.tire); m.castShadow = true; return m; };
  const gearNose = new THREE.Group();
  {
    const s = stationAt(T.st, g.noseX / L), top = s[4] - s[3] * 0.8;
    gearNose.position.set(0, top, geo.gearNose.z);
    const len = top - (-g.cgH + rn);
    gearNose.add(mkStrut(len, 0.06));
    const ws = [];
    for (let i = 0; i < g.noseWheels; i++) {
      const w = mkWheel(rn, rn * 0.5);
      w.position.set(g.noseWheels === 2 ? (i ? 0.16 : -0.16) : 0, -len, 0);
      gearNose.add(w); ws.push(w);
    }
    gearNose.userData.wheels = ws; gearNose.userData.r = rn;
  }
  group.add(gearNose);
  const gearMain = [];
  for (const side of [-1, 1]) {
    const grp = new THREE.Group();
    const s = stationAt(T.st, (g.noseX + g.wheelbase) / L), top = s[4] - s[3] * 0.6;
    const xTop = side * Math.min(g.track / 2, s[1] * 0.85);
    grp.position.set(xTop, top, geo.gearMain[0].z);
    const ax = side * g.track / 2 - xTop, ay = -g.cgH + rw - top;
    const len = Math.hypot(ax, ay);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 8), mats.metal);
    st.position.set(ax / 2, ay / 2, 0); st.rotation.z = Math.atan2(ax, -ay); st.castShadow = true;
    grp.add(st);
    const w = mkWheel(rw, rw * 0.55); w.position.set(ax, ay, 0); grp.add(w);
    grp.userData.wheels = [w]; grp.userData.r = rw; grp.userData.side = side; grp.userData.fighter = true;
    group.add(grp); gearMain.push(grp);
  }

  // ---------------------------------------------------------------- lights
  const lights = { nav: [], strobe: [], beacon: [], landing: [], all: [] };
  if (typeof document !== 'undefined') {
    const tipS = sec(semi);
    const add = (kind, color, size, x, y, z) => { const l = makeLight(color, size); l.position.set(x, y, z); group.add(l); lights[kind].push(l); lights.all.push(l); };
    add('nav', 0xff2a2a, 0.35, -d.span / 2, tipS.le[1], tipS.le[2] + tipS.c * 0.5);
    add('nav', 0x2aff4a, 0.35, d.span / 2, tipS.le[1], tipS.le[2] + tipS.c * 0.5);
    add('nav', 0xffffff, 0.3, 0, yTip - 0.2, zEnd - 1.2);
    add('strobe', 0xffffff, 1.2, 0, yTip, zEnd - 1.4);
    add('beacon', 0xff2020, 0.8, 0, 0.9, zOf(0.5));
    add('landing', 0xfff6dd, 1.8, 0, -g.cgH + 1.0, geo.gearNose.z - 0.1);
  }

  return { group, geo, right, left, gearNose, gearMain, fans: [], flames, lights, mats, kind: 'fighter' };
}
