// Head-up display for the fighters (cockpit view): conformal pitch ladder, flight-path vector,
// speed/altitude boxes, heading tape, g, angle of attack and Mach.
import { RAD, DEG, wrap360, clamp } from '../core/units.js';

const FONT = (px, w = 600) => `${w} ${px}px "Roboto Mono", "DejaVu Sans Mono", Consolas, monospace`;

/** d: { pitch, roll, alpha, beta, ias, alt, hdg (mag), mach, g, vs, ra, fovDeg, gear, ab, ap, ils } */
export function drawFighterHUD(g, W, H, d) {
  g.clearRect(0, 0, W, H);
  const col = '#4dff7a';
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6;
  g.shadowColor = 'rgba(40,255,110,0.55)'; g.shadowBlur = 4;
  const cx = W / 2, cy = H / 2;
  const ppr = (H / 2) / Math.tan((d.fovDeg * DEG) / 2);      // pixels per radian at the centre
  const s = clamp(H / 760, 0.7, 1.5);

  // boresight cross
  g.beginPath(); g.moveTo(cx - 8 * s, cy); g.lineTo(cx - 3 * s, cy); g.moveTo(cx + 3 * s, cy); g.lineTo(cx + 8 * s, cy); g.moveTo(cx, cy - 8 * s); g.lineTo(cx, cy - 3 * s); g.stroke();

  // pitch ladder (conformal with the outside world)
  g.save();
  g.beginPath(); g.rect(cx - 210 * s, cy - 230 * s, 420 * s, 460 * s); g.clip();
  g.translate(cx, cy); g.rotate(-d.roll);
  g.font = FONT(11 * s); g.textBaseline = 'middle';
  for (let p = -90; p <= 90; p += 5) {
    const y = (d.pitch - p * DEG) * ppr;
    if (Math.abs(y) > 320 * s) continue;
    if (p === 0) { g.beginPath(); g.moveTo(-260 * s, y); g.lineTo(-40 * s, y); g.moveTo(40 * s, y); g.lineTo(260 * s, y); g.stroke(); continue; }
    const w = 78 * s, gap = 32 * s, tick = p > 0 ? 8 * s : -8 * s;
    if (p < 0) g.setLineDash([7 * s, 5 * s]);
    g.beginPath();
    g.moveTo(-w, y + tick); g.lineTo(-w, y); g.lineTo(-gap, y);
    g.moveTo(w, y + tick); g.lineTo(w, y); g.lineTo(gap, y);
    g.stroke(); g.setLineDash([]);
    g.textAlign = 'right'; g.fillText(Math.abs(p), -w - 5 * s, y);
    g.textAlign = 'left'; g.fillText(Math.abs(p), w + 5 * s, y);
  }
  g.restore();

  // flight-path vector: where the aircraft is actually going
  const fx = cx + clamp(d.beta * ppr, -200 * s, 200 * s), fy = cy + clamp(d.alpha * ppr, -220 * s, 220 * s);
  g.beginPath(); g.arc(fx, fy, 7 * s, 0, 7);
  g.moveTo(fx - 7 * s, fy); g.lineTo(fx - 20 * s, fy); g.moveTo(fx + 7 * s, fy); g.lineTo(fx + 20 * s, fy); g.moveTo(fx, fy - 7 * s); g.lineTo(fx, fy - 14 * s);
  g.stroke();

  // speed and altitude boxes
  const bx = 250 * s;
  g.font = FONT(17 * s, 700); g.textBaseline = 'middle';
  g.strokeRect(cx - bx - 62 * s, cy - 13 * s, 62 * s, 26 * s);
  g.textAlign = 'right'; g.fillText(Math.round(d.ias), cx - bx - 6 * s, cy + 1);
  g.strokeRect(cx + bx, cy - 13 * s, 76 * s, 26 * s);
  g.fillText(Math.round(d.alt / 10) * 10, cx + bx + 70 * s, cy + 1);
  g.font = FONT(12 * s);
  g.textAlign = 'left';
  g.fillText(`M ${d.mach.toFixed(2)}`, cx - bx - 62 * s, cy + 34 * s);
  g.fillText(`G ${d.g.toFixed(1)}`, cx - bx - 62 * s, cy + 52 * s);
  g.fillText(`α ${(d.alpha * RAD).toFixed(1)}`, cx - bx - 62 * s, cy + 70 * s);
  if (d.ab) g.fillText('AB', cx - bx - 62 * s, cy + 88 * s);
  g.fillText(`VS ${Math.round(d.vs / 100) * 100}`, cx + bx, cy + 34 * s);
  if (d.ra < 3000) g.fillText(`R ${Math.round(d.ra / 10) * 10}`, cx + bx, cy + 52 * s);
  if (d.gear) g.fillText('GEAR', cx + bx, cy + 70 * s);
  if (d.ap) g.fillText(d.ap, cx + bx, cy - 30 * s);

  // heading tape
  const hy = cy - 250 * s, pph = 5 * s;
  g.save();
  g.beginPath(); g.rect(cx - 130 * s, hy - 26 * s, 260 * s, 40 * s); g.clip();
  g.font = FONT(12 * s); g.textAlign = 'center';
  for (let v = Math.floor((d.hdg - 30) / 5) * 5; v <= d.hdg + 30; v += 5) {
    const x = cx + (v - d.hdg) * pph;
    const major = ((v % 10) + 10) % 10 === 0;
    g.beginPath(); g.moveTo(x, hy); g.lineTo(x, hy + (major ? 9 : 5) * s); g.stroke();
    if (major) g.fillText(String(wrap360(v) / 10).padStart(2, '0'), x, hy - 10 * s);
  }
  g.restore();
  g.beginPath(); g.moveTo(cx, hy + 12 * s); g.lineTo(cx - 5 * s, hy + 20 * s); g.lineTo(cx + 5 * s, hy + 20 * s); g.closePath(); g.stroke();

  // ILS steering
  if (d.ils && d.ils.valid) {
    const lx = cx + clamp(-d.ils.loc / 2.5, -1, 1) * 70 * s, gy = cy + clamp(d.ils.gs / 0.7, -1, 1) * 70 * s;
    g.beginPath(); g.moveTo(lx, cy - 60 * s); g.lineTo(lx, cy + 60 * s);
    if (d.ils.gsValid) { g.moveTo(cx - 60 * s, gy); g.lineTo(cx + 60 * s, gy); }
    g.stroke();
  }
  g.shadowBlur = 0;
}
