// Three-view drawing (plan, side and front silhouettes with dimensions) of an aircraft, rendered
// from the real 3D model so it is exactly to scale.
import * as THREE from 'three';
import { AircraftModel } from '../aircraft/model.js';

let renderer = null;
const ink = new THREE.MeshBasicMaterial({ color: 0x1c1e21, side: THREE.DoubleSide });

export function drawThreeView(canvas, spec) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth || 560, ch = canvas.clientHeight || 230;
  const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
  canvas.width = W; canvas.height = H;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const model = new AircraftModel(spec, { detail: 0 });
  for (const l of model.lights.all) l.visible = false;
  if (model.flames) for (const f of model.flames) f.visible = false;
  const scene = new THREE.Scene();
  scene.add(model.group);
  scene.overrideMaterial = ink;

  const d = spec.dims, cgX = model.geo.cgX, cgH = spec.gear.cgH;
  const m = 18 * dpr, gap = 26 * dpr;
  const wL = W * 0.44, wR = W - wL;
  // one scale for all three views
  const s = Math.min((wL - 2 * m) / d.span, (H - 2 * m - gap) / d.length, (wR - 2 * m - gap) / Math.max(d.length, d.span), (H - 2 * m - 2 * gap) / (2 * d.height));
  const cz = d.length / 2 - cgX, cy = d.height / 2 - cgH;
  const views = [
    // plan view, nose up
    { x: 0, y: 0, w: wL, h: H, pos: [0, 400, cz], up: [0, 0, -1], at: [0, 0, cz] },
    // side view, nose left
    { x: wL, y: H / 2, w: wR, h: H / 2, pos: [-400, cy, cz], up: [0, 1, 0], at: [0, cy, cz] },
    // front view
    { x: wL, y: 0, w: wR, h: H / 2, pos: [0, cy, -400], up: [0, 1, 0], at: [0, cy, 0] },
  ];
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  for (const v of views) {
    const cam = new THREE.OrthographicCamera(-v.w / (2 * s), v.w / (2 * s), v.h / (2 * s), -v.h / (2 * s), 1, 2000);
    cam.position.set(...v.pos); cam.up.set(...v.up); cam.lookAt(...v.at);
    renderer.setViewport(v.x, v.y, v.w, v.h); renderer.setScissor(v.x, v.y, v.w, v.h);
    renderer.render(scene, cam);
  }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.drawImage(renderer.domElement, 0, 0);
  model.dispose();

  // dimension lines
  g.strokeStyle = '#d9480f'; g.fillStyle = '#d9480f'; g.lineWidth = Math.max(1, dpr);
  g.font = `${11 * dpr}px "B612 Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const dim = (x0, y0, x1, y1, label) => {
    const horiz = Math.abs(y1 - y0) < 1, t = 4 * dpr;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    if (horiz) { g.moveTo(x0, y0 - t); g.lineTo(x0, y0 + t); g.moveTo(x1, y1 - t); g.lineTo(x1, y1 + t); }
    else { g.moveTo(x0 - t, y0); g.lineTo(x0 + t, y0); g.moveTo(x1 - t, y1); g.lineTo(x1 + t, y1); }
    g.stroke();
    const tw = g.measureText(label).width + 8 * dpr;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    g.save(); g.translate(mx, my); if (!horiz) g.rotate(-Math.PI / 2);
    g.globalCompositeOperation = 'destination-out'; g.fillRect(-tw / 2, -8 * dpr, tw, 16 * dpr);
    g.globalCompositeOperation = 'source-over'; g.fillText(label, 0, 1);
    g.restore();
  };
  // plan: span below the silhouette
  const pcx = wL / 2, pcy = H / 2;
  dim(pcx - (d.span * s) / 2, pcy + (d.length * s) / 2 + gap * 0.5, pcx + (d.span * s) / 2, pcy + (d.length * s) / 2 + gap * 0.5, `${d.span.toFixed(2)} m`);
  // side: length below, height to the right
  const scx = wL + wR / 2, scy = H / 4;
  dim(scx - (d.length * s) / 2, scy + (d.height * s) / 2 + gap * 0.45, scx + (d.length * s) / 2, scy + (d.height * s) / 2 + gap * 0.45, `${d.length.toFixed(2)} m`);
  dim(scx + (d.length * s) / 2 + gap * 0.5, scy - (d.height * s) / 2, scx + (d.length * s) / 2 + gap * 0.5, scy + (d.height * s) / 2, `${d.height.toFixed(2)} m`);
}
