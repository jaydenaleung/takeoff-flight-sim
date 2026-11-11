// Engine and systems display: N1, EGT, fuel flow, fuel, weight, flaps, gear, spoilers, brakes.
import { clamp } from '../core/units.js';

const FONT = (px, w = 600) => `${w} ${px}px "Roboto Mono", "DejaVu Sans Mono", Consolas, monospace`;
const C = { white: '#e8edf2', green: '#3df08c', amber: '#ffb52e', red: '#ff4136', cyan: '#55e0ff', dim: '#93a1b0' };

function gauge(g, x, y, r, val, max, label, color, text) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.lineWidth = 2; g.strokeStyle = '#3a4654';
  g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
  g.strokeStyle = C.red; g.beginPath(); g.arc(x, y, r, a1 - 0.14, a1); g.stroke();
  const f = clamp(val / max, 0, 1.03);
  g.strokeStyle = color; g.lineWidth = 2.6;
  g.beginPath(); g.arc(x, y, r, a0, a0 + (a1 - a0) * f); g.stroke();
  const t = a0 + (a1 - a0) * f;
  g.lineWidth = 1.6; g.strokeStyle = C.white;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r); g.stroke();
  g.fillStyle = '#05080c'; g.fillRect(x - r * 0.1, y + r * 0.22, r * 1.15, r * 0.62);
  g.strokeStyle = '#3a4654'; g.lineWidth = 1; g.strokeRect(x - r * 0.1, y + r * 0.22, r * 1.15, r * 0.62);
  g.fillStyle = color; g.font = FONT(r * 0.5, 700); g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(text, x + r * 1.0, y + r * 0.55);
  if (label) { g.fillStyle = C.dim; g.font = FONT(7.5); g.textAlign = 'center'; g.fillText(label, x, y - r - 6); }
}

/**
 * d: { engines: [{n1, n2, egt, ff, rev, ab, running, start}], fighter, fuel, fuelMax, mass, mtow,
 *      flap, flapName, gear, gearDown, spoiler, spoilerArmed, parkBrake, brake, trim, thrLever, sat }
 */
export function drawEICAS(g, W, H, d) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
  const k = W / 320;
  g.save(); g.scale(k, k);
  const n = d.engines.length;
  const r = n > 2 ? 19 : 24;
  const gap = n > 2 ? 46 : 62;
  const x0 = 12 + r + (n === 1 ? 30 : 0);
  d.engines.forEach((e, i) => {
    const x = x0 + i * gap, y = 34;
    const col = !e.running ? C.dim : e.n1 > 101 ? C.red : C.white;
    gauge(g, x, y, r, e.n1, 104, i === 0 ? (d.fighter ? 'RPM %' : 'N1 %') : '', col, e.n1.toFixed(1));
    g.font = FONT(8.5, 600); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = e.egt > 900 ? C.amber : C.white;
    g.fillText(Math.round(e.egt), x + 2, y + r + 14);
    g.fillStyle = C.white;
    g.fillText((e.ff * 3.6).toFixed(e.ff * 3.6 < 10 ? 2 : 1), x + 2, y + r + 26);
    if (e.rev > 0.05) { g.fillStyle = e.rev > 0.95 ? C.green : C.amber; g.font = FONT(8, 800); g.fillText('REV', x, y - 6); }
    if (e.ab > 0.03) { g.fillStyle = C.amber; g.font = FONT(8, 800); g.fillText(`AB ${Math.ceil(e.ab * 5)}`, x, y - 6); }
    if (e.start < 1 && e.running) { g.fillStyle = C.cyan; g.font = FONT(7.5, 800); g.fillText('START', x, y - 6); }
  });
  g.fillStyle = C.dim; g.font = FONT(7.5); g.textAlign = 'left';
  const lx = x0 + (n - 1) * gap + r + 6;
  g.fillText('EGT°C', lx, 34 + r + 14); g.fillText('FF t/h', lx, 34 + r + 26);

  // right column: fuel and weight
  const cx = 250;
  g.textAlign = 'left'; g.font = FONT(8); g.fillStyle = C.dim;
  g.fillText('FUEL kg', cx, 12); g.fillText('GW kg', cx, 40); g.fillText('SAT', cx, 68);
  g.font = FONT(11, 700);
  g.fillStyle = d.fuel / d.fuelMax < 0.06 ? C.amber : C.green;
  g.fillText(Math.round(d.fuel / 10) * 10, cx, 25);
  g.fillStyle = d.mass > d.mtow ? C.amber : C.white;
  g.fillText(Math.round(d.mass / 10) * 10, cx, 53);
  g.fillStyle = C.white; g.fillText(`${Math.round(d.sat)}°C`, cx, 81);

  // bottom strip: flaps, gear, spoilers, brakes
  const by = 112;
  g.strokeStyle = '#27313c'; g.lineWidth = 1; g.beginPath(); g.moveTo(6, by - 8); g.lineTo(314, by - 8); g.stroke();
  // flaps
  g.fillStyle = C.dim; g.font = FONT(8); g.textAlign = 'left'; g.fillText('FLAPS', 10, by);
  g.fillStyle = '#1b232c'; g.fillRect(10, by + 8, 86, 7);
  g.fillStyle = d.flapMoving ? C.amber : C.green; g.fillRect(10, by + 8, 86 * d.flap, 7);
  g.font = FONT(12, 700); g.fillText(d.flapName, 10, by + 28);
  // gear
  g.fillStyle = C.dim; g.font = FONT(8); g.fillText('GEAR', 112, by);
  const gcol = d.gear > 0.99 ? C.green : d.gear < 0.01 ? null : C.red;
  [[132, by + 10], [118, by + 24], [146, by + 24]].forEach(([x, y]) => {
    g.strokeStyle = '#3a4654'; g.strokeRect(x - 6, y - 5, 12, 10);
    if (gcol) { g.fillStyle = gcol; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x - 5, y - 4); g.lineTo(x + 5, y - 4); g.fill(); }
  });
  if (d.gear < 0.01) { g.fillStyle = C.white; g.font = FONT(9, 700); g.fillText('UP', 162, by + 18); }
  // speed brake
  g.fillStyle = C.dim; g.font = FONT(8); g.fillText('SPD BRK', 186, by);
  g.fillStyle = '#1b232c'; g.fillRect(186, by + 8, 52, 7);
  g.fillStyle = C.amber; g.fillRect(186, by + 8, 52 * d.spoiler, 7);
  g.font = FONT(9, 700); g.fillStyle = d.spoilerArmed ? C.green : C.dim; g.fillText(d.spoilerArmed ? 'ARMED' : 'DISARM', 186, by + 27);
  // brakes
  g.fillStyle = C.dim; g.font = FONT(8); g.fillText('BRAKES', 252, by);
  g.font = FONT(9, 800);
  if (d.parkBrake) { g.fillStyle = C.red; g.fillText('PARK', 252, by + 13); }
  else if (d.brake > 0.05) { g.fillStyle = C.amber; g.fillText('ON', 252, by + 13); }
  else { g.fillStyle = C.dim; g.fillText('OFF', 252, by + 13); }
  if (d.autobrake) { g.fillStyle = C.green; g.fillText('AUTO', 252, by + 27); }
  // thrust lever
  g.fillStyle = C.dim; g.font = FONT(8); g.fillText('THR', 292, by);
  g.fillStyle = '#1b232c'; g.fillRect(296, by + 8, 8, 30);
  g.fillStyle = d.thrLever > 0.87 && d.fighter ? C.amber : C.cyan;
  g.fillRect(296, by + 38 - 30 * d.thrLever, 8, 30 * d.thrLever);
  g.restore();
}
