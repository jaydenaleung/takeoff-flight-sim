// Quadtree level-of-detail terrain. Tiles are generated in workers and swapped in when ready;
// a parent stays visible until all four of its children exist, so there are never holes.
import * as THREE from 'three';
import { HALF_W, HALF_H } from './heightfield.js';

const ROOT = 153600, MAX_LEVEL = 8;
const NX = Math.ceil((2 * HALF_W) / ROOT), NZ = Math.ceil((2 * HALF_H) / ROOT);

function detailTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  // three tiling noise fields at different grain sizes
  const field = (cells) => {
    const r = new Float32Array(cells * cells);
    for (let i = 0; i < r.length; i++) r[i] = Math.random();
    return (x, y) => {
      const fx = (x / S) * cells, fy = (y / S) * cells;
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = r[(j % cells) * cells + (i % cells)], b = r[(j % cells) * cells + ((i + 1) % cells)];
      const cc = r[((j + 1) % cells) * cells + (i % cells)], dd = r[((j + 1) % cells) * cells + ((i + 1) % cells)];
      return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + dd) * sx * sy;
    };
  };
  const f1 = field(64), f1b = field(128), f2 = field(16), f2b = field(40), f3 = field(8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      d[o] = 255 * (0.6 * f1(x, y) + 0.4 * f1b(x, y));
      d[o + 1] = 255 * (0.65 * f2(x, y) + 0.35 * f2b(x, y));
      d[o + 2] = 255 * f3(x, y);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export class Terrain {
  /**
   * o: { scene, heights, flags, lc: {data,w,h,cell}, pads, cities, res, lodK }
   */
  constructor(o) {
    this.scene = o.scene;
    this.res = o.res || 40;
    this.K = o.lodK || 2.2;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.scene.add(this.group);
    this.detail = detailTexture();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const detail = this.detail;
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aux;\nvarying float vAux;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAux = aux;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying float vAux;\nvarying vec3 vWPos;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float dist = length(vWPos - cameraPosition);
            float d1 = texture2D(detailMap, vWPos.xz / 31.0).r;
            float d2 = texture2D(detailMap, vWPos.xz / 420.0).g;
            float d3 = texture2D(detailMap, vWPos.xz / 5200.0).b;
            float nearF = 1.0 - smoothstep(250.0, 2800.0, dist);
            float midF = 1.0 - smoothstep(4000.0, 45000.0, dist);
            float detail = mix(1.0, 0.7 + 0.6 * d1, nearF) * mix(1.0, 0.78 + 0.44 * d2, midF) * (0.88 + 0.24 * d3);
            diffuseColor.rgb *= mix(detail, 1.0, vAux);
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, vAux);');
    };
    // shared index buffer for the (res+3)^2 grid
    const G = this.res + 3, idx = [];
    for (let j = 0; j < G - 1; j++) {
      for (let i = 0; i < G - 1; i++) {
        const a = j * G + i, b = a + 1, c = a + G, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.index = new THREE.BufferAttribute(new Uint32Array(idx), 1);

    this.roots = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) this.roots.push(this.node(0, -HALF_W + i * ROOT, -HALF_H + j * ROOT, ROOT));
    this.tiles = new Map();
    this.nextId = 1;
    this.queue = [];
    this.pending = 0;
    this.frame = 0;
    this.meshCount = 0;

    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    this.workersReady = 0;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => this.onMessage(w, e.data);
      w.postMessage({ type: 'init', heights: o.heights, flags: o.flags, pads: o.pads, lc: o.lc.data, lcW: o.lc.w, lcH: o.lc.h, lcCell: o.lc.cell, cities: o.cities });
      this.workers.push(w);
    }
  }
  node(level, x0, z0, size) {
    return { level, x0, z0, size, state: 0, mesh: null, kids: null, minY: 0, maxY: 3000, used: 0, want: false, id: 0 };
  }
  onMessage(w, m) {
    if (m.type === 'ready') { this.workersReady++; return; }
    w.busy = false; this.pending--;
    const n = this.tiles.get(m.id);
    this.tiles.delete(m.id);
    if (!n) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(m.col, 3));
    g.setAttribute('aux', new THREE.BufferAttribute(m.aux, 1));
    g.setIndex(this.index);
    const cy = (m.minY + m.maxY) / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, cy, 0), Math.hypot(n.size * 0.71, (m.maxY - m.minY) / 2 + n.size * 0.05));
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(n.x0 + n.size / 2, 0, n.z0 + n.size / 2);
    mesh.updateMatrixWorld();
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.group.add(mesh);
    n.mesh = mesh; n.state = 2; n.minY = m.minY; n.maxY = m.maxY;
    this.meshCount++;
  }
  request(n, pri) {
    if (n.state !== 0) { if (n.state === 1) n.pri = pri; return; }
    n.state = 1; n.pri = pri; n.id = this.nextId++;
    this.tiles.set(n.id, n);
    this.queue.push(n);
  }
  dist(n, c) {
    const dx = Math.max(n.x0 - c.x, 0, c.x - (n.x0 + n.size));
    const dz = Math.max(n.z0 - c.z, 0, c.z - (n.z0 + n.size));
    const dy = Math.max(n.minY - c.y, 0, c.y - n.maxY);
    return Math.hypot(dx, dz, dy);
  }
  /** Returns true if the node (or its descendants) fully covers its area with ready meshes. */
  select(n, c) {
    n.used = this.frame;
    const d = this.dist(n, c);
    const split = n.level < MAX_LEVEL && d < n.size * this.K * (n.split ? 1.12 : 1);
    if (split) {
      if (!n.kids) {
        const h = n.size / 2;
        n.kids = [this.node(n.level + 1, n.x0, n.z0, h), this.node(n.level + 1, n.x0 + h, n.z0, h), this.node(n.level + 1, n.x0, n.z0 + h, h), this.node(n.level + 1, n.x0 + h, n.z0 + h, h)];
        for (const k of n.kids) { k.minY = n.minY; k.maxY = n.maxY; }
      }
      let all = true;
      for (const k of n.kids) { if (k.state !== 2) { all = false; this.request(k, d / n.size + n.level * 0.01); k.used = this.frame; } }
      if (all) {
        n.split = true;
        if (n.mesh) n.mesh.visible = false;
        for (const k of n.kids) this.select(k, c);
        return;
      }
    }
    n.split = false;
    if (n.state === 2) { n.mesh.visible = true; this.shown++; } else this.request(n, d / n.size - 10);
    if (n.kids) for (const k of n.kids) this.hide(k);
  }
  hide(n) {
    if (n.mesh) n.mesh.visible = false;
    if (n.kids && n.split !== undefined) for (const k of n.kids) this.hide(k);
    n.split = false;
  }
  update(camPos) {
    this.frame++;
    this.shown = 0;
    for (const r of this.roots) this.select(r, camPos);
    // dispatch work to idle workers, most important first; drop requests nobody wants any more
    if (this.queue.length && this.workersReady === this.workers.length) {
      let sorted = false;
      for (const w of this.workers) {
        if (w.busy || !this.queue.length) continue;
        if (!sorted) { this.queue.sort((a, b) => b.pri - a.pri); sorted = true; }
        let n = null;
        while (this.queue.length) {
          const cand = this.queue.pop();
          if (cand.used >= this.frame - 30) { n = cand; break; }
          cand.state = 0; this.tiles.delete(cand.id);
        }
        if (!n) break;
        w.busy = true; this.pending++;
        w.postMessage({ type: 'tile', id: n.id, x0: n.x0, z0: n.z0, size: n.size, res: this.res });
      }
    }
    if (this.frame % 240 === 0 && this.meshCount > 520) this.gc();
  }
  gc() {
    const walk = (n) => {
      if (n.kids) n.kids.forEach(walk);
      if (n.level > 0 && n.state === 2 && n.used < this.frame - 900) {
        this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; n.state = 0; this.meshCount--;
      }
    };
    this.roots.forEach(walk);
  }
  /** True when nothing is waiting to load (used for the loading screen). */
  get idle() { return this.queue.length === 0 && this.pending === 0 && this.workersReady === this.workers.length; }
  dispose() { for (const w of this.workers) w.terminate(); }
}
