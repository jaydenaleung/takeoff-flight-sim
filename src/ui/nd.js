// Navigation display: heading-up moving map with airports, runways, taxi route, navaids,
// traffic, wind and flight-plan line.
import { DEG, RAD, NM, wrap360, wrap180, clamp } from '../core/units.js';

const FONT = (px, w = 600) => `${w} ${px}px "B612 Mono", "Roboto Mono", "DejaVu Sans Mono", Consolas, monospace`;
export const ND_RANGES = [1, 2.5, 5, 10, 20, 40, 80, 160, 320];

/**
 * d: { x, z, hdg (grid), magVar, track, gs, tas, range (nm), wind: {dir, kt}, airports, navaids,
 *      dest, route: [{x,z}], ils, selHdg (mag), traffic: [{x,z,alt,vs,callsign}], alt, onGround,
 *      taxi: {pts, hold}, big }
 */
export function drawND(g, W, H, d) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
  const k = W / 300;
  g.save(); g.scale(k, k);
  const cx = 150, cy = d.big ? 150 : 232, R = d.big ? 128 : 190;
  const scale = R / (d.range * NM);
  const a = d.hdg * DEG, ca = Math.cos(a), sa = Math.sin(a);
  const P = (x, z) => { const e = x - d.x, n = -(z - d.z); return [cx + (e * ca - n * sa) * scale, cy - (e * sa + n * ca) * scale]; };
  const inView = (p, m = 20) => p[0] > -m && p[0] < 300 + m && p[1] > -m && p[1] < 300 + m;

  // ---- surface detail when zoomed in
  const closeIn = d.range <= 10;
  g.lineCap = 'butt';
  for (const ap of d.airports) {
    const dist = Math.hypot(ap.c.x - d.x, ap.c.z - d.z);
    if (dist > d.range * NM * 1.8 + ap.radius) continue;
    if (closeIn) {
      // taxiways
      g.strokeStyle = '#3d4854'; g.lineWidth = Math.max(1, 23 * scale);
      for (const s of ap.taxiSegments) { const p = P(s.a.x, s.a.z), q = P(s.b.x, s.b.z); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
      const A = ap.apron;
      g.fillStyle = '#2b333d';
      g.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([s, t], i) => { const p = P(A.c.x + A.u.x * A.hl * s + A.n.x * A.hw * t, A.c.z + A.u.z * A.hl * s + A.n.z * A.hw * t); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
      g.fill();
      if (d.range <= 2.5) {
        g.fillStyle = '#8fa0b2'; g.font = FONT(7); g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const s of ap.taxiSegments) { const p = P((s.a.x + s.b.x) / 2, (s.a.z + s.b.z) / 2); if (inView(p, 0) && !/\d/.test(s.name)) g.fillText(s.name, p[0], p[1]); }
      }
    }
    if (d.range <= 40) {
      for (const r of ap.runways) {
        const p = P(r.ends[0].x, r.ends[0].z), q = P(r.ends[1].x, r.ends[1].z);
        g.strokeStyle = closeIn ? '#cfd6dd' : '#aab4bf'; g.lineWidth = Math.max(1.6, r.width * scale);
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
        if (d.range <= 10) {
          g.fillStyle = '#55e0ff'; g.font = FONT(7.5, 700); g.textAlign = 'center'; g.textBaseline = 'middle';
          for (const e of r.ends) { const t = P(e.x - e.dir.x * (260 + 30 / scale * 0.02), e.z - e.dir.z * (260 + 30 / scale * 0.02)); if (inView(t, 0)) g.fillText(e.id, t[0], t[1]); }
        }
      }
    }
  }
  // ---- extended centreline of the tuned approach
  if (d.ils) {
    const e = d.ils;
    const p = P(e.x, e.z), q = P(e.x - Math.sin(e.crs * DEG) * 15 * NM, e.z + Math.cos(e.crs * DEG) * 15 * NM);
    g.strokeStyle = '#ff5cf4'; g.lineWidth = 1; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); g.setLineDash([]);
  }
  // ---- flight-plan line / direct-to
  if (d.route && d.route.length > 1) {
    g.strokeStyle = '#ff5cf4'; g.lineWidth = 1.4;
    g.beginPath();
    d.route.forEach((w, i) => { const p = P(w.x, w.z); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.stroke();
  }
  // ---- taxi guidance
  if (d.taxi && d.taxi.pts && closeIn) {
    g.strokeStyle = '#3df08c'; g.lineWidth = 2.2; g.lineJoin = 'round';
    g.beginPath();
    d.taxi.pts.forEach((w, i) => { const p = P(w.x, w.z); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.stroke();
    if (d.taxi.hold) { const p = P(d.taxi.hold.x, d.taxi.hold.z); g.strokeStyle = '#ffb52e'; g.lineWidth = 2; g.beginPath(); g.arc(p[0], p[1], 5, 0, 7); g.stroke(); }
  }
  // ---- navaids
  if (d.range >= 10 && d.range <= 160) {
    g.strokeStyle = '#55e0ff'; g.fillStyle = '#55e0ff'; g.lineWidth = 1; g.font = FONT(7.5); g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const n of d.navaids) {
      if (Math.abs(n.x - d.x) > d.range * NM * 1.5 || Math.abs(n.z - d.z) > d.range * NM * 1.5) continue;
      const p = P(n.x, n.z);
      if (!inView(p, 0)) continue;
      g.beginPath();
      for (let i = 0; i < 6; i++) { const t = (i / 6) * 6.283; const x = p[0] + Math.cos(t) * 4, y = p[1] + Math.sin(t) * 4; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.stroke();
      if (d.range <= 80) g.fillText(n.id, p[0] + 6, p[1]);
    }
  }
  // ---- airport symbols
  g.font = FONT(8.5, 700); g.textAlign = 'left'; g.textBaseline = 'middle';
  for (const ap of d.airports) {
    if (d.range <= 10) continue;
    const p = P(ap.c.x, ap.c.z);
    if (!inView(p, 0)) continue;
    const isDest = ap === d.dest;
    g.strokeStyle = g.fillStyle = isDest ? '#ff5cf4' : ap.military ? '#b79cff' : '#55e0ff';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(p[0], p[1], 4, 0, 7); g.stroke();
    if (d.range <= 160 || isDest || !ap.military) g.fillText(ap.icao, p[0] + 7, p[1] + 1);
  }
  // ---- traffic
  for (const t of d.traffic || []) {
    const p = P(t.x, t.z);
    if (!inView(p, 0)) continue;
    const rel = Math.round((t.alt - d.alt) / 0.3048 / 100);
    const near = Math.hypot(t.x - d.x, t.z - d.z) < 6 * NM && Math.abs(rel) < 12;
    g.strokeStyle = g.fillStyle = near ? '#ffb52e' : '#e8edf2'; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(p[0], p[1] - 5); g.lineTo(p[0] + 4, p[1]); g.lineTo(p[0], p[1] + 5); g.lineTo(p[0] - 4, p[1]); g.closePath();
    if (near) g.fill(); else g.stroke();
    g.font = FONT(7.5); g.textAlign = 'center';
    g.fillText(`${rel >= 0 ? '+' : '-'}${String(Math.abs(rel)).padStart(2, '0')}${t.vs > 2.5 ? '↑' : t.vs < -2.5 ? '↓' : ''}`, p[0], p[1] + (rel >= 0 ? -10 : 11));
  }

  // ---- compass rose, range rings
  g.strokeStyle = '#e8edf2'; g.fillStyle = '#e8edf2'; g.lineWidth = 1.2;
  const hm = d.hdg - d.magVar;
  if (d.big) { g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke(); }
  else { g.beginPath(); g.arc(cx, cy, R, -Math.PI * 0.86, -Math.PI * 0.14); g.stroke(); }
  g.font = FONT(9, 700); g.textAlign = 'center'; g.textBaseline = 'middle';
  const span = d.big ? 180 : 62;
  for (let v = Math.ceil((hm - span) / 5) * 5; v <= hm + span; v += 5) {
    const t = (v - hm - 90) * DEG;
    const major = ((v % 10) + 10) % 10 === 0;
    const r1 = R - (major ? 8 : 4);
    g.beginPath(); g.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); g.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); g.stroke();
    if (((v % 30) + 30) % 30 === 0) { const hv = wrap360(v); g.fillText(hv === 0 ? 'N' : hv === 90 ? 'E' : hv === 180 ? 'S' : hv === 270 ? 'W' : hv / 10, cx + Math.cos(t) * (R - 17), cy + Math.sin(t) * (R - 17)); }
  }
  g.strokeStyle = '#66727f'; g.setLineDash([3, 4]);
  g.beginPath(); if (d.big) g.arc(cx, cy, R / 2, 0, 7); else g.arc(cx, cy, R / 2, -Math.PI * 0.9, -Math.PI * 0.1); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#93a1b0'; g.font = FONT(8); g.textAlign = 'left';
  g.fillText(d.range / 2, cx + 4, cy - R / 2 + 8);
  // heading bug and track line
  if (d.selHdg != null) {
    const t = (wrap180(d.selHdg - hm) - 90) * DEG;
    g.strokeStyle = '#ff5cf4'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx + Math.cos(t) * (R - 1), cy + Math.sin(t) * (R - 1)); g.lineTo(cx + Math.cos(t) * (R + 8), cy + Math.sin(t) * (R + 8)); g.stroke();
  }
  if (d.gs > 15) {
    const t = (wrap180(d.track - d.hdg) - 90) * DEG;
    g.strokeStyle = '#3df08c'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); g.stroke();
  }
  // own ship
  g.strokeStyle = '#ffd400'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 8); g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy); g.moveTo(cx - 4, cy + 7); g.lineTo(cx + 4, cy + 7); g.stroke();
  // heading read-out
  g.fillStyle = '#05080c'; g.fillRect(cx - 19, d.big ? 4 : cy - R - 20, 38, 15);
  g.strokeStyle = '#e8edf2'; g.lineWidth = 1; g.strokeRect(cx - 19, d.big ? 4 : cy - R - 20, 38, 15);
  g.fillStyle = '#e8edf2'; g.font = FONT(10.5, 700); g.textAlign = 'center';
  g.fillText(`${String(Math.round(wrap360(hm)) % 360).padStart(3, '0')}`, cx, (d.big ? 4 : cy - R - 20) + 8);

  // ---- data blocks
  g.textAlign = 'left'; g.font = FONT(9, 600); g.fillStyle = '#e8edf2';
  g.fillText(`GS ${Math.round(d.gs / 0.5144)}  TAS ${Math.round(d.tas / 0.5144)}`, 5, 9);
  if (d.wind) {
    const wm = wrap360(d.wind.dir - d.magVar);
    g.fillText(`${String(Math.round(wm)).padStart(3, '0')}°/${Math.round(d.wind.kt)}`, 5, 21);
    if (d.wind.kt > 1) {
      const t = (d.wind.dir - d.hdg + 180 - 90) * DEG;        // arrow points where the wind blows to
      g.strokeStyle = '#e8edf2'; g.lineWidth = 1.4;
      const ax = 18, ay = 38;
      g.beginPath(); g.moveTo(ax - Math.cos(t) * 9, ay - Math.sin(t) * 9); g.lineTo(ax + Math.cos(t) * 9, ay + Math.sin(t) * 9); g.stroke();
      g.beginPath(); g.moveTo(ax + Math.cos(t) * 9, ay + Math.sin(t) * 9); g.lineTo(ax + Math.cos(t - 2.6) * 5 + Math.cos(t) * 9, ay + Math.sin(t - 2.6) * 5 + Math.sin(t) * 9); g.stroke();
      g.beginPath(); g.moveTo(ax + Math.cos(t) * 9, ay + Math.sin(t) * 9); g.lineTo(ax + Math.cos(t + 2.6) * 5 + Math.cos(t) * 9, ay + Math.sin(t + 2.6) * 5 + Math.sin(t) * 9); g.stroke();
    }
  }
  if (d.dest) {
    const dist = Math.hypot(d.dest.c.x - d.x, d.dest.c.z - d.z) / NM;
    g.textAlign = 'right'; g.fillStyle = '#ff5cf4';
    g.fillText(d.dest.icao, 295, 9);
    g.fillStyle = '#e8edf2';
    g.fillText(`${dist.toFixed(dist < 100 ? 1 : 0)} NM`, 295, 21);
    if (d.gs > 30) { const min = (dist * NM) / d.gs / 60; g.fillText(`${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`, 295, 33); }
  }
  g.textAlign = 'right'; g.fillStyle = '#93a1b0'; g.font = FONT(8);
  g.fillText(`RNG ${d.range}`, 295, 293);
  g.restore();
}
export { clamp, RAD };
