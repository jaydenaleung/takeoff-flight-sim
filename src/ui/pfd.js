// Primary flight display: attitude, speed and altitude tapes, vertical speed, heading,
// flight mode annunciator and ILS deviation scales.
import { RAD, DEG, clamp, wrap180, wrap360 } from '../core/units.js';

const C = {
  sky: '#2f7fd0', ground: '#8a5a2b', white: '#f2f4f6', mag: '#ff5cf4', green: '#3df08c', amber: '#ffb52e',
  red: '#ff4136', cyan: '#55e0ff', tape: 'rgba(22,30,40,0.92)', box: '#05080c', dim: '#93a1b0',
};
const FONT = (px, w = 600) => `${w} ${px}px "B612 Mono", "Roboto Mono", "DejaVu Sans Mono", Consolas, monospace`;

export function drawPFD(g, W, H, d) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a0e13'; g.fillRect(0, 0, W, H);
  const k = W / 300;
  g.save(); g.scale(k, k);
  const cx = 138, cy = 148, hw = 76, hh = 80;      // attitude window

  // ------------------------------------------------------------ attitude
  g.save();
  g.beginPath(); g.roundRect(cx - hw, cy - hh, hw * 2, hh * 2, 10); g.clip();
  const ppd = 4.2;
  g.translate(cx, cy); g.rotate(-d.roll);
  const py = d.pitch * RAD * ppd;
  g.fillStyle = C.sky; g.fillRect(-300, -600 + py, 600, 600);
  g.fillStyle = C.ground; g.fillRect(-300, py, 600, 600);
  g.strokeStyle = C.white; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(-300, py); g.lineTo(300, py); g.stroke();
  g.font = FONT(8.5); g.fillStyle = C.white; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let p = -90; p <= 90; p += 2.5) {
    if (p === 0) continue;
    const y = py - p * ppd;
    if (y < -hh - 10 || y > hh + 10) continue;
    const len = p % 10 === 0 ? 26 : p % 5 === 0 ? 14 : 7;
    g.beginPath(); g.moveTo(-len, y); g.lineTo(len, y); g.stroke();
    if (p % 10 === 0) { g.fillText(Math.abs(p), -len - 9, y); g.fillText(Math.abs(p), len + 9, y); }
  }
  g.restore();
  // bank scale and pointer
  g.save(); g.translate(cx, cy);
  g.strokeStyle = C.white; g.lineWidth = 1.3;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r0 = hh - 3, r1 = r0 + (a % 30 === 0 ? 8 : 5), t = (a - 90) * DEG;
    g.beginPath(); g.moveTo(Math.cos(t) * r0, Math.sin(t) * r0); g.lineTo(Math.cos(t) * r1, Math.sin(t) * r1); g.stroke();
  }
  g.rotate(-d.roll);
  g.fillStyle = Math.abs(d.roll) > 35 * DEG ? C.amber : C.white;
  g.beginPath(); g.moveTo(0, -hh + 3); g.lineTo(-5, -hh + 12); g.lineTo(5, -hh + 12); g.fill();
  const slip = clamp(d.beta * RAD * 2.2, -14, 14);
  g.fillRect(-6 - slip, -hh + 13.5, 12, 3);
  g.restore();
  // flight director
  if (d.fd) {
    g.strokeStyle = C.mag; g.lineWidth = 2;
    const fy = clamp(-d.fd.pitch * RAD * ppd, -40, 40), fx = clamp(d.fd.roll * RAD * 1.6, -40, 40);
    g.beginPath(); g.moveTo(cx - 38, cy + fy); g.lineTo(cx + 38, cy + fy); g.moveTo(cx + fx, cy - 38); g.lineTo(cx + fx, cy + 38); g.stroke();
  }
  // aircraft symbol
  g.fillStyle = '#111'; g.strokeStyle = '#ffd400'; g.lineWidth = 1.6;
  for (const s of [-1, 1]) { g.beginPath(); g.rect(cx + s * 22 - (s < 0 ? 26 : 0), cy - 2, 26, 4); g.fill(); g.stroke(); }
  g.fillRect(cx - 2, cy - 2, 4, 4); g.strokeRect(cx - 2, cy - 2, 4, 4);

  // radio altitude
  if (d.ra < 2500) {
    g.font = FONT(12, 700); g.textAlign = 'center';
    g.fillStyle = d.ra < 400 ? C.amber : C.green;
    const ra = d.ra > 100 ? Math.round(d.ra / 10) * 10 : Math.max(0, Math.round(d.ra));
    g.fillText(ra, cx, cy + hh - 12);
  }
  // ILS scales
  if (d.ils) {
    g.fillStyle = C.white; g.strokeStyle = C.white; g.lineWidth = 1;
    const ly = cy + hh + 9, gx = cx + hw + 9;
    for (const dot of [-2, -1, 1, 2]) {
      g.beginPath(); g.arc(cx + dot * 16, ly, 2, 0, 7); g.stroke();
      g.beginPath(); g.arc(gx, cy + dot * 16, 2, 0, 7); g.stroke();
    }
    g.fillRect(cx - 0.5, ly - 5, 1, 10); g.fillRect(gx - 5, cy - 0.5, 10, 1);
    g.fillStyle = C.mag;
    const diamond = (x, y) => { g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.fill(); };
    if (d.ils.valid) diamond(cx + clamp(-d.ils.loc / 1.0, -2.4, 2.4) * 16, ly);
    if (d.ils.gsValid) diamond(gx, cy + clamp(d.ils.gs / 0.35, -2.4, 2.4) * 16);
    g.font = FONT(8); g.textAlign = 'left'; g.fillStyle = C.white;
    g.fillText(`${d.ils.id} ${d.ils.freq.toFixed(2)}`, cx - hw, cy - hh - 7);
    g.fillText(`DME ${(Math.max(0, d.ils.dist) / 1852).toFixed(1)}`, cx - hw + 78, cy - hh - 7);
  }

  // ------------------------------------------------------------ speed tape
  const sx0 = 6, sw = 46, top = cy - hh, bot = cy + hh;
  g.save();
  g.beginPath(); g.rect(sx0, top, sw + 12, hh * 2); g.clip();
  g.fillStyle = C.tape; g.fillRect(sx0, top, sw, hh * 2);
  const ppk = 2.6;
  const sy = (v) => cy - (v - d.ias) * ppk;
  g.strokeStyle = C.white; g.fillStyle = C.white; g.lineWidth = 1; g.font = FONT(10); g.textAlign = 'right'; g.textBaseline = 'middle';
  const s0 = Math.max(0, Math.floor((d.ias - 40) / 10) * 10);
  for (let v = s0; v <= d.ias + 40; v += 10) {
    const y = sy(v);
    g.beginPath(); g.moveTo(sx0 + sw - 7, y); g.lineTo(sx0 + sw, y); g.stroke();
    if (v % 20 === 0) g.fillText(v, sx0 + sw - 10, y);
  }
  // limit bands
  if (d.vmax) { g.fillStyle = C.red; const y = sy(d.vmax); for (let yy = y; yy > top - 8; yy -= 8) g.fillRect(sx0 + sw, yy - 4, 5, 4); }
  if (d.vstall && !d.onGround) {
    g.fillStyle = C.amber; g.fillRect(sx0 + sw, sy(d.vstall * 1.13), 3, (d.vstall * 0.13) * ppk);
    g.fillStyle = C.red; for (let yy = sy(d.vstall); yy < bot + 8; yy += 8) g.fillRect(sx0 + sw, yy, 5, 4);
  }
  // V-speed bugs
  g.font = FONT(8, 700); g.textAlign = 'left';
  for (const b of d.bugs || []) {
    const y = sy(b.v);
    if (y < top + 4 || y > bot - 4) continue;
    g.fillStyle = C.green; g.fillRect(sx0 + sw - 2, y - 0.6, 6, 1.2); g.fillText(b.n, sx0 + sw + 5, y);
  }
  // selected speed bug
  if (d.selSpd != null) {
    const y = clamp(sy(d.selSpd), top + 3, bot - 3);
    g.fillStyle = C.mag; g.beginPath(); g.moveTo(sx0 + sw, y); g.lineTo(sx0 + sw + 7, y - 5); g.lineTo(sx0 + sw + 7, y + 5); g.fill();
  }
  // trend arrow (10 s)
  if (Math.abs(d.trend) > 1.5) {
    const y1 = clamp(sy(d.ias + d.trend), top + 4, bot - 4);
    g.strokeStyle = C.green; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(sx0 + sw + 2, cy); g.lineTo(sx0 + sw + 2, y1); g.stroke();
    g.beginPath(); g.moveTo(sx0 + sw + 2, y1 + (d.trend > 0 ? -4 : 4)); g.lineTo(sx0 + sw - 1, y1); g.lineTo(sx0 + sw + 5, y1); g.fillStyle = C.green; g.fill();
  }
  g.restore();
  g.fillStyle = C.box; g.strokeStyle = d.stall ? C.red : C.white; g.lineWidth = 1.3;
  g.beginPath(); g.rect(sx0 + 1, cy - 10, sw - 9, 20); g.fill(); g.stroke();
  g.font = FONT(14, 700); g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillStyle = d.stall ? C.red : d.ias > d.vmax ? C.red : C.white;
  g.fillText(Math.round(Math.max(d.ias, 0)), sx0 + sw - 12, cy + 0.5);
  g.font = FONT(10, 700); g.textAlign = 'center';
  if (d.selSpdText) { g.fillStyle = C.mag; g.fillText(d.selSpdText, sx0 + sw / 2, top - 8); }
  if (d.mach > 0.4) { g.fillStyle = C.white; g.fillText(`M${d.mach.toFixed(3).slice(1)}`, sx0 + sw / 2, bot + 9); }

  // ------------------------------------------------------------ altitude tape
  const ax0 = cx + hw + 20, aw = 50;
  g.save();
  g.beginPath(); g.rect(ax0 - 8, top, aw + 8, hh * 2); g.clip();
  g.fillStyle = C.tape; g.fillRect(ax0, top, aw, hh * 2);
  const ppf = 0.2;
  const ay = (v) => cy - (v - d.alt) * ppf;
  g.strokeStyle = C.white; g.fillStyle = C.white; g.font = FONT(9); g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineWidth = 1;
  const a0 = Math.floor((d.alt - 450) / 100) * 100;
  for (let v = a0; v <= d.alt + 450; v += 100) {
    const y = ay(v);
    g.beginPath(); g.moveTo(ax0, y); g.lineTo(ax0 + (v % 500 === 0 ? 8 : 5), y); g.stroke();
    if (v % 200 === 0) g.fillText(v, ax0 + 11, y);
  }
  if (d.selAlt != null) {
    const y = clamp(ay(d.selAlt), top + 3, bot - 3);
    g.strokeStyle = C.mag; g.lineWidth = 1.6; g.strokeRect(ax0 - 6, y - 7, 6, 14);
  }
  if (d.groundAlt != null) { g.fillStyle = 'rgba(170,110,40,0.85)'; const y = ay(d.groundAlt); if (y < bot) g.fillRect(ax0, y, aw, bot - y); }
  g.restore();
  g.fillStyle = C.box; g.strokeStyle = C.white; g.lineWidth = 1.3;
  g.beginPath(); g.rect(ax0 + 5, cy - 10, aw - 4, 20); g.fill(); g.stroke();
  g.font = FONT(13, 700); g.textAlign = 'right'; g.fillStyle = C.white;
  g.fillText(Math.round(d.alt / 10) * 10, ax0 + aw - 2, cy + 0.5);
  g.font = FONT(10, 700); g.textAlign = 'center';
  if (d.selAlt != null) { g.fillStyle = C.mag; g.fillText(d.selAlt, ax0 + aw / 2, top - 8); }
  g.fillStyle = C.green; g.font = FONT(9, 600);
  g.fillText(d.qnh, ax0 + aw / 2, bot + 9);

  // ------------------------------------------------------------ vertical speed
  const vx = ax0 + aw + 6;
  g.fillStyle = C.tape; g.fillRect(vx, cy - 62, 18, 124);
  const vsY = (fpm) => { const a = Math.abs(fpm), s = Math.sign(fpm); const f = a <= 1000 ? a / 1000 * 26 : a <= 2000 ? 26 + (a - 1000) / 1000 * 16 : 42 + Math.min(1, (a - 2000) / 4000) * 16; return cy - s * f; };
  g.strokeStyle = C.white; g.fillStyle = C.white; g.lineWidth = 1; g.font = FONT(7); g.textAlign = 'left';
  for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) { const y = vsY(v); g.beginPath(); g.moveTo(vx, y); g.lineTo(vx + 5, y); g.stroke(); if (v) g.fillText(Math.abs(v / 1000), vx + 7, y); }
  g.strokeStyle = C.green; g.lineWidth = 2;
  g.beginPath(); g.moveTo(vx + 18, cy); g.lineTo(vx + 2, vsY(d.vs)); g.stroke();
  if (Math.abs(d.vs) > 300) { g.font = FONT(8, 700); g.textAlign = 'right'; g.fillStyle = C.white; g.fillText(Math.round(d.vs / 50) * 50, vx + 18, d.vs > 0 ? cy - 70 : cy + 70); }

  // ------------------------------------------------------------ heading tape
  const hy = bot + 22, hwid = 104;
  g.save();
  g.beginPath(); g.rect(cx - hwid, hy, hwid * 2, 30); g.clip();
  g.fillStyle = C.tape; g.fillRect(cx - hwid, hy, hwid * 2, 30);
  const pph = 3.4;
  g.strokeStyle = C.white; g.fillStyle = C.white; g.font = FONT(9.5, 600); g.textAlign = 'center'; g.textBaseline = 'top'; g.lineWidth = 1;
  const h0 = Math.floor((d.hdg - 32) / 5) * 5;
  for (let v = h0; v <= d.hdg + 32; v += 5) {
    const x = cx + (v - d.hdg) * pph;
    const major = ((v % 10) + 10) % 10 === 0;
    g.beginPath(); g.moveTo(x, hy); g.lineTo(x, hy + (major ? 7 : 4)); g.stroke();
    if (major) { const hv = wrap360(v); g.fillText(hv % 30 === 0 ? String(hv / 10).padStart(2, '0') : String(hv / 10), x, hy + 9); }
  }
  if (d.selHdg != null) {
    const x = cx + clamp(wrap180(d.selHdg - d.hdg), -30, 30) * pph;
    g.strokeStyle = C.mag; g.lineWidth = 1.6; g.strokeRect(x - 5, hy, 10, 5);
  }
  const tx = cx + clamp(wrap180(d.track - d.hdg), -30, 30) * pph;
  g.fillStyle = C.green; g.beginPath(); g.moveTo(tx, hy + 1); g.lineTo(tx + 3, hy + 6); g.lineTo(tx, hy + 11); g.lineTo(tx - 3, hy + 6); g.fill();
  g.restore();
  g.fillStyle = C.white; g.beginPath(); g.moveTo(cx, hy + 1); g.lineTo(cx - 4, hy - 6); g.lineTo(cx + 4, hy - 6); g.fill();
  g.font = FONT(10, 700); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${String(Math.round(wrap360(d.hdg)) % 360).padStart(3, '0')}°`, cx + hwid + 20, hy + 9);
  if (d.selHdg != null) { g.fillStyle = C.mag; g.fillText(String(d.selHdg).padStart(3, '0'), cx - hwid - 18, hy + 9); }

  // ------------------------------------------------------------ flight mode annunciator
  g.fillStyle = 'rgba(16,22,30,0.95)'; g.fillRect(sx0, 4, 284, 30);
  g.strokeStyle = '#3a4654'; g.lineWidth = 1;
  for (const x of [77, 148, 219]) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, 32); g.stroke(); }
  g.font = FONT(10.5, 700); g.textAlign = 'center';
  const f = d.fma || {};
  g.fillStyle = C.green;
  g.fillText(f.thr || '', 42, 13); g.fillText(f.lat || '', 112, 13); g.fillText(f.vert || '', 183, 13);
  g.fillStyle = f.ap ? C.white : C.dim; g.fillText(f.ap || (d.fd ? 'FD' : ''), 254, 13);
  g.font = FONT(8.5, 600); g.fillStyle = C.cyan;
  g.fillText(f.armed || '', 148, 26);
  if (d.law) { g.fillStyle = C.amber; g.fillText(d.law, 254, 26); }
  if (d.prot) { g.fillStyle = C.amber; g.fillText(d.prot, 42, 26); }
  if (d.stall) {
    g.fillStyle = C.red; g.font = FONT(15, 800); g.fillText('STALL', cx, cy - 34);
  }
  g.restore();
}
