// Geometry helpers: skin lists of cross-sections into meshes, build aerofoil surfaces and
// hinged control surfaces. Everything is authored in metres in the aircraft body frame
// (+X right, +Y up, +Z aft).
import * as THREE from 'three';

export class MeshBuilder {
  constructor() { this.p = []; this.uv = []; this.idx = []; this.grp = []; this.g = 0; }
  _v(pt, u, v) {
    this.p.push(pt[0], pt[1], pt[2]); this.uv.push(u, v); this.grp.push(this.g);
    return this.p.length / 3 - 1;
  }
  /** Skin consecutive sections (arrays of [x,y,z], all the same length) into one smooth surface. */
  loft(sections, { closed = false, uv = null } = {}) {
    this.g++;
    const n = sections[0].length, base = this.p.length / 3, ns = sections.length;
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < n; j++) {
        const t = uv ? uv(i, j) : [n > 1 ? j / (n - 1) : 0, ns > 1 ? i / (ns - 1) : 0];
        this._v(sections[i][j], t[0], t[1]);
      }
    }
    const m = closed ? n : n - 1;
    for (let i = 0; i < ns - 1; i++) {
      for (let j = 0; j < m; j++) {
        const a = base + i * n + j, b = base + i * n + ((j + 1) % n);
        const c = base + (i + 1) * n + j, d = base + (i + 1) * n + ((j + 1) % n);
        this.idx.push(a, b, c, b, d, c);
      }
    }
    return this;
  }
  /** Flat cap over a ring of points. */
  cap(ring) {
    this.g++;
    const c = [0, 0, 0];
    for (const p of ring) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= ring.length; c[1] /= ring.length; c[2] /= ring.length;
    const ci = this._v(c, 0.5, 0.5);
    const first = this.p.length / 3;
    for (const p of ring) this._v(p, 0.5, 0.5);
    for (let j = 0; j < ring.length; j++) this.idx.push(ci, first + j, first + ((j + 1) % ring.length));
    return this;
  }
  /** Flat polygon given as a convex/star-shaped outline, extruded to a thin plate. */
  plate(outline, thickness, up = [0, 1, 0]) {
    const h = thickness / 2;
    const top = outline.map((p) => [p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h]);
    const bot = outline.map((p) => [p[0] - up[0] * h, p[1] - up[1] * h, p[2] - up[2] * h]);
    this.cap(top); this.cap(bot);
    this.loft([top, bot], { closed: true });
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // weld normals of coincident vertices inside the same smoothing group (texture seams)
    const nrm = g.attributes.normal.array, pos = this.p, map = new Map();
    for (let i = 0; i < pos.length / 3; i++) {
      const k = `${this.grp[i]}|${Math.round(pos[i * 3] * 500)}|${Math.round(pos[i * 3 + 1] * 500)}|${Math.round(pos[i * 3 + 2] * 500)}`;
      let e = map.get(k);
      if (!e) { e = [0, 0, 0, []]; map.set(k, e); }
      e[0] += nrm[i * 3]; e[1] += nrm[i * 3 + 1]; e[2] += nrm[i * 3 + 2]; e[3].push(i);
    }
    for (const e of map.values()) {
      if (e[3].length < 2) continue;
      const l = Math.hypot(e[0], e[1], e[2]) || 1;
      for (const i of e[3]) { nrm[i * 3] = e[0] / l; nrm[i * 3 + 1] = e[1] / l; nrm[i * 3 + 2] = e[2] / l; }
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** NACA-style half thickness at chord fraction x for thickness ratio t (closed trailing edge). */
const thick = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);

/**
 * Points of an aerofoil section between two chord fractions.
 * sec: { le:[x,y,z], c: chord, t: thickness ratio, up:[x,y,z] thickness direction,
 *        along:[x,y,z] chord direction (default +Z), camber }
 * Returns { upper, lower } arrays of points running from `from` to `to`.
 */
export function aerofoil(sec, from = 0, to = 1, n = 10) {
  const up = sec.up || [0, 1, 0], al = sec.along || [0, 0, 1];
  const cam = sec.camber ?? 0.015;
  const upper = [], lower = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const x = from === 0 ? to * (1 - Math.cos((s * Math.PI) / 2)) : from + (to - from) * s;
    const yt = thick(x, sec.t), yc = cam * 4 * x * (1 - x);
    const bx = sec.le[0] + al[0] * x * sec.c, by = sec.le[1] + al[1] * x * sec.c, bz = sec.le[2] + al[2] * x * sec.c;
    const a = (yc + yt) * sec.c, b = (yc - yt) * sec.c;
    upper.push([bx + up[0] * a, by + up[1] * a, bz + up[2] * a]);
    lower.push([bx + up[0] * b, by + up[1] * b, bz + up[2] * b]);
  }
  return { upper, lower };
}

/**
 * Add a lifting-surface segment to a MeshBuilder: skins sections between chord fractions,
 * optionally closing the front/back cuts and the end ribs.
 */
export function loftSurface(mb, secs, from = 0, to = 1, { n = 10, front = false, back = false, capA = false, capB = false, uvChord = false } = {}) {
  const prof = secs.map((s) => aerofoil(s, from, to, n));
  // optional texture coordinates: u = chord fraction, v = span fraction (sec.v if given)
  const uv = uvChord ? (i, j) => {
    const t = j / (n - 1);
    const x = from === 0 ? to * (1 - Math.cos((t * Math.PI) / 2)) : from + (to - from) * t;
    return [x, secs[i].v ?? i / (secs.length - 1)];
  } : null;
  mb.loft(prof.map((p) => p.upper), { uv });
  mb.loft(prof.map((p) => p.lower), { uv });
  if (back) mb.loft(prof.map((p) => [p.upper[n - 1], p.lower[n - 1]]));
  if (front) mb.loft(prof.map((p) => [p.upper[0], p.lower[0]]));
  const ring = (p) => p.upper.concat(p.lower.slice().reverse());
  if (capA) mb.cap(ring(prof[0]));
  if (capB) mb.cap(ring(prof[prof.length - 1]));
  return mb;
}

/**
 * Build a hinged control surface (flap, aileron, elevator, rudder, spoiler) as a mesh inside a
 * pivot object. The pivot's local +X is the hinge line, +Z points aft; a positive rotation about
 * X moves the trailing edge "down" (toward -up).
 */
export function hingedSurface(secs, from, to, material, { n = 5, uvChord = false } = {}) {
  const mb = new MeshBuilder();
  loftSurface(mb, secs, from, to, { n, front: true, capA: true, capB: true, uvChord });
  const geo = mb.build();
  const h = (s) => {
    const al = s.along || [0, 0, 1];
    return new THREE.Vector3(s.le[0] + al[0] * from * s.c, s.le[1] + al[1] * from * s.c, s.le[2] + al[2] * from * s.c);
  };
  const A = h(secs[0]), B = h(secs[secs.length - 1]);
  const X = B.clone().sub(A).normalize();
  const al0 = secs[0].along || [0, 0, 1];
  const Z = new THREE.Vector3(al0[0], al0[1], al0[2]);
  Z.addScaledVector(X, -Z.dot(X)).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(A);
  geo.applyMatrix4(m.clone().invert());
  const pivot = new THREE.Group();
  pivot.applyMatrix4(m);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  pivot.add(mesh);
  pivot.userData.chord = (to - from) * secs[0].c;
  return pivot;
}

const _qx = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
/** Deflect a hinged surface by `angle` (rad), optionally sliding it aft/down (Fowler flaps). */
export function deflect(pivot, angle, slideAft = 0, slideDown = 0) {
  // the rest pose is captured on first use (clones of a pivot get their own)
  if (!pivot._base) pivot._base = { pos: pivot.position.clone(), quat: pivot.quaternion.clone() };
  const b = pivot._base;
  pivot.quaternion.copy(b.quat).multiply(_qx.setFromAxisAngle(_ax, angle));
  pivot.position.copy(b.pos);
  if (slideAft || slideDown) {
    _v.set(0, -slideDown, slideAft).applyQuaternion(b.quat);
    pivot.position.add(_v);
  }
}

/** A glowing light sprite that stays visible at long range. */
let glowTex = null;
export function glowTexture() {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
export function makeLight(color, size) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  s.userData.size = size;
  s.renderOrder = 10;
  return s;
}
