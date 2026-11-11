// Cockpit warnings and ground-proximity call-outs.
import { KT, FT, DEG } from '../core/units.js';

const CALLOUTS = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
const WORDS = { 2500: 'twenty five hundred', 1000: 'one thousand', 500: 'five hundred', 400: 'four hundred', 300: 'three hundred', 200: 'two hundred', 100: 'one hundred', 50: 'fifty', 40: 'forty', 30: 'thirty', 20: 'twenty', 10: 'ten' };

export class Warnings {
  constructor(flight, world) {
    this.f = flight; this.world = world;
    this.active = [];
    this.lastRa = 99999;
    this.said = {};
    this.t = 0;
    this.callout = null;          // { text } to be spoken by the audio system
    this.terrainT = 0;
  }
  speakOnce(key, text, gap = 4) {
    if (this.t - (this.said[key] || -99) < gap) return;
    this.said[key] = this.t;
    this.callout = { text, key };
  }
  update(dt) {
    this.t += dt;
    const f = this.f, fm = f.fm, o = fm.out, s = f.spec, c = fm.ctl, L = s.limits;
    const fighter = s.type === 'fighter';
    const w = [];
    const add = (level, text) => w.push({ level, text });
    const ra = o.ra, air = !o.onGround;
    if (fm.crashed) { this.active = w; return; }

    if (o.stall && air) add('warning', 'STALL');
    if (o.ias > L.vmo + 3 || o.mach > L.mmo + 0.006) add('warning', 'OVERSPEED');
    if (!fighter && air && Math.abs(o.roll) > 40 * DEG && o.agl > 20) { add('caution', 'BANK ANGLE'); this.speakOnce('bank', 'bank angle, bank angle', 5); }
    if (fm.gear > 0.05 && o.ias > L.vle + 5) add('caution', 'GEAR SPEED');
    if (fm.flap > 0.05 && o.ias > L.vfe + (1 - fm.flap) * 45 + 5) add('caution', 'FLAP SPEED');
    if (fm.fuel / s.mass.fuel < 0.05) add('caution', 'FUEL LOW');
    if (fm.fuel <= 0) add('warning', 'FUEL EXHAUSTED');
    if (fm.engines.some((e) => !e.running)) add('caution', fm.engines.every((e) => !e.running) ? 'ALL ENGINES OFF' : 'ENGINE OFF');
    if (Math.abs(o.nz) > (fighter ? L.gPos : 2.3) && air) add('caution', `${o.nz.toFixed(1)} G`);

    // take-off configuration
    if (o.onGround && c.throttle > 0.7 && o.gs < 45) {
      const fl = s.flaps[c.flapIdx][1];
      if (!fighter && (fl < 0.05 || fl > 0.65)) add('warning', 'CONFIG FLAPS');
      if (fm.spoiler > 0.1) add('warning', 'CONFIG SPOILERS');
      if (c.parkBrake) add('warning', 'CONFIG PARK BRAKE');
    }
    // ground proximity
    if (air) {
      const sink = -o.vsFpm;
      if (ra < 2500 && sink > 1600 + ra * 1.6) { add('warning', sink > 2400 + ra * 2.2 ? 'PULL UP' : 'SINK RATE'); this.speakOnce('sink', sink > 2400 + ra * 2.2 ? 'pull up' : 'sink rate', 3); }
      // look-ahead along the flight path
      this.terrainT -= dt;
      if (this.terrainT <= 0 && o.gs > 50) {
        this.terrainT = 0.4;
        let worst = 1e9;
        for (const tt of [10, 20, 32]) {
          const x = fm.pos.x + fm.vel.x * tt, z = fm.pos.z + fm.vel.z * tt, y = fm.pos.y + Math.min(fm.vel.y, 0) * tt + (fm.vel.y > 0 ? fm.vel.y * tt * 0.5 : 0);
          const cl = y - this.world.elevation(x, z);
          if (cl < worst) { worst = cl; this.terrT = tt; }
        }
        const landing = fm.gear > 0.9 && fm.flap > 0.3 && ra < 2000;
        this.terrain = !landing && worst < 90 ? (this.terrT <= 20 && worst < 30 ? 2 : 1) : 0;
      }
      if (this.terrain === 2) { add('warning', 'TERRAIN — PULL UP'); this.speakOnce('terr', 'terrain, terrain. pull up', 3); }
      else if (this.terrain === 1) { add('caution', 'TERRAIN AHEAD'); this.speakOnce('terr', 'caution, terrain', 6); }
      if (!fighter && ra < 500 && fm.gear < 0.9 && o.ias < 190 && o.vs < 1) { add('warning', 'TOO LOW — GEAR'); this.speakOnce('gear', 'too low, gear', 4); }
      else if (!fighter && ra < 250 && fm.gear > 0.9 && fm.flap < s.flaps[Math.max(1, s.ldgFlap - 2)][1] - 0.02 && o.vs < 0 && o.ias < 180) { add('caution', 'TOO LOW — FLAPS'); this.speakOnce('flaps', 'too low, flaps', 5); }
      // radio-altitude call-outs on the way down
      if (o.vs < -0.5 && fm.gear > 0.5) {
        for (const h of CALLOUTS) {
          if (this.lastRa > h && ra <= h) { this.callout = { text: WORDS[h], key: `ra${h}` }; if (h === 200) this.said.mins = this.t; }
        }
        if (!fighter && ra < 22 && this.lastRa >= 22 && c.throttle > 0.1) this.callout = { text: 'retard, retard', key: 'retard' };
      }
    }
    this.lastRa = ra;
    if (f.ap.disconnectWarn > 0) add('warning', 'AUTOPILOT DISCONNECT');
    if (f.fcs.direct) add('caution', 'DIRECT LAW');
    this.active = w;
    this.stall = w.some((x) => x.text === 'STALL');
    this.overspeed = w.some((x) => x.text === 'OVERSPEED');
    this.master = w.some((x) => x.level === 'warning');
  }
}
export { KT, FT };
