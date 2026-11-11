// Autopilot / flight director and autothrottle. Produces attitude-rate and bank demands for the
// flight control laws and a thrust-lever position.
import { clamp, DEG, RAD, G, KT, FT, NM, wrap180, wrap360, moveToward } from '../core/units.js';
import { casFromMach } from '../physics/atmosphere.js';

/**
 * ILS geometry for a runway end.
 * end: { x, z, hdg (grid deg), elev, displaced }, length: runway length (m).
 * Returns deviations for a position: loc (deg, + = aircraft right of course), gs (deg, + = above),
 * dist (m, along-track distance to the threshold, + before it), cross (m), valid.
 */
export function ilsDeviation(ils, x, y, z) {
  const c = ils.crs * DEG;
  const dx = x - ils.x, dz = z - ils.z;
  const along = dx * Math.sin(c) - dz * Math.cos(c);     // metres past the threshold
  const cross = dx * Math.cos(c) + dz * Math.sin(c);     // metres right of the centreline
  const locDist = ils.length + 300 - along;
  const aim = 305;                                        // glide path aiming point past threshold
  const D = aim - along;
  const loc = Math.atan2(cross, Math.max(locDist, 1)) * RAD;
  const gsAngle = Math.atan2(y - ils.elev, Math.max(D, 1)) * RAD;
  return {
    loc, gs: gsAngle - ils.gp, dist: -along, cross, D,
    pathAlt: ils.elev + Math.max(D, 0) * Math.tan(ils.gp * DEG),
    valid: locDist > 0 && -along < 60000 && Math.abs(loc) < 35,
    gsValid: D > 0 && D < 45000 && Math.abs(loc) < 8,
  };
}

export class Autopilot {
  constructor(fm) {
    this.fm = fm;
    const s = fm.spec;
    this.fighter = s.type === 'fighter';
    this.on = false;
    this.at = false;
    this.lat = 'HDG';
    this.vert = 'ALT';
    this.sel = { spd: 250, mach: s.cruise.mach, useMach: false, hdg: 0, alt: 5000, vs: 0 };
    this.armed = { loc: false, gs: false };
    this.ils = null;
    this.nav = null;
    this.magVar = () => 0;          // east declination in degrees at (x, z)
    this.cmd = { active: false, thetaDot: 0, phi: 0, yaw: null };
    this.thr = 0;
    this.phiCmd = 0;
    this.autobrake = false;
    this.disconnectWarn = 0;
    this.fma = { thr: '', lat: '', vert: '', ap: '', armed: '' };
  }

  engage(on) {
    const o = this.fm.out;
    if (on && !this.on) {
      if (o.onGround) return false;
      this.on = true;
      if (this.lat === 'ROLLOUT') this.lat = 'HDG';
      if (this.vert === 'FLARE') this.vert = 'ALT';
      this.phiCmd = o.roll;
    } else if (!on && this.on) {
      this.on = false; this.disconnectWarn = 3;
    }
    return true;
  }
  setAT(on) {
    this.at = on;
    if (on) this.thr = this.fm.ctl.throttle;
  }
  syncToCurrent() {
    const o = this.fm.out;
    this.sel.hdg = Math.round(wrap360(o.hdg - this.magVar(this.fm.pos.x, this.fm.pos.z)));
    this.sel.alt = Math.round(o.altFt / 100) * 100;
    this.sel.spd = Math.round(o.ias);
  }
  setILS(ils) { this.ils = ils; this.armed.loc = false; this.armed.gs = false; if (this.lat === 'LOC') this.lat = 'HDG'; if (this.vert === 'GS') this.vert = 'ALT'; }
  armApproach() {
    if (!this.ils) return false;
    this.armed.loc = true; this.armed.gs = true;
    return true;
  }
  targetCas() {
    const o = this.fm.out;
    return this.sel.useMach ? casFromMach(this.sel.mach, o.pStat || 101325) : this.sel.spd * KT;
  }

  update(dt) {
    const fm = this.fm, o = fm.out, c = fm.ctl, sel = this.sel;
    const cmd = this.cmd;
    this.disconnectWarn = Math.max(0, this.disconnectWarn - dt);
    const V = Math.max(o.tas, 30);
    const dev = this.ils ? ilsDeviation(this.ils, fm.pos.x, fm.pos.y, fm.pos.z) : null;
    this.dev = dev;

    // ------------------------------------------------------------ mode transitions
    if (dev && this.armed.loc && dev.valid && Math.abs(dev.loc) < 2.2 && Math.abs(wrap180(o.track - this.ils.crs)) < 100) {
      this.lat = 'LOC'; this.armed.loc = false;
    }
    // glideslope capture, normally from below; from above if only slightly high
    if (dev && this.armed.gs && this.lat === 'LOC' && dev.gsValid && dev.gs > -0.12 && dev.gs < 0.9) {
      this.vert = 'GS'; this.armed.gs = false;
    }
    const flareH = 14 + 8 * clamp(o.mass / 250000, 0, 1.6);
    if (this.vert === 'GS' && o.agl < flareH && this.on) this.vert = 'FLARE';
    if (this.vert === 'FLARE' && o.wow && this.on) { this.lat = 'ROLLOUT'; }

    // ------------------------------------------------------------ autothrottle
    if (this.at) {
      if (this.vert === 'FLARE' && this.on) {
        if (o.agl < 9 || o.wow) this.thr = moveToward(this.thr, 0, dt / 2.5);
        if (o.wow) { this.at = false; }
      } else if (o.onGround && !this.on) {
        // armed on the ground: follow the lever
        this.thr = c.throttle;
      } else {
        const errKt = (this.targetCas() - o.cas) / KT;
        const aCmd = clamp(0.14 * errKt, -1.6, 1.6);
        const aNow = (o.accel || 0) / KT;
        const max = this.fighter ? 0.86 : 1;
        this.thr = clamp(this.thr + 0.085 * (aCmd - aNow) * dt, 0, max);
      }
      c.throttle = this.thr;
    } else this.thr = c.throttle;

    // ------------------------------------------------------------ flight director
    cmd.active = this.on;
    cmd.yaw = null;
    const bankLim = (this.fighter ? 45 : 25) * DEG;

    // lateral
    let phi = 0;
    if (this.lat === 'HDG') {
      const hdgTrue = sel.hdg + this.magVar(fm.pos.x, fm.pos.z);
      phi = clamp(1.5 * wrap180(hdgTrue - o.hdg) * DEG, -bankLim, bankLim);
    } else if (this.lat === 'NAV' && this.nav) {
      const dx = this.nav.x - fm.pos.x, dz = this.nav.z - fm.pos.z;
      const brg = Math.atan2(dx, -dz) * RAD;
      phi = clamp(1.5 * wrap180(brg - o.track) * DEG, -bankLim, bankLim);
      if (Math.hypot(dx, dz) < 1.5 * NM) { this.lat = 'HDG'; sel.hdg = Math.round(wrap360(o.hdg - this.magVar(fm.pos.x, fm.pos.z))); }
    } else if ((this.lat === 'LOC' || this.lat === 'ROLLOUT') && dev) {
      const Lref = clamp(V * 22, 900, 4000);
      const trackCmd = this.ils.crs - clamp(Math.atan(dev.cross / Lref) * RAD, -32, 32);
      const tErr = wrap180(trackCmd - o.track);
      phi = clamp(1.3 * tErr * DEG, -bankLim, bankLim);
      if (this.lat === 'ROLLOUT') {
        phi = 0;
        cmd.yaw = clamp(-dev.cross * 0.03 + wrap180(this.ils.crs - o.track) * 0.12, -1, 1);
      }
    }
    // de-crab just before touchdown: align the nose with the runway
    if (this.vert === 'FLARE' && this.lat === 'LOC' && o.agl < 7 && dev) {
      cmd.yaw = clamp(wrap180(this.ils.crs - o.hdg) / (this.fighter ? 8 : 13), -1, 1);
    }
    this.phiCmd = moveToward(this.phiCmd, phi, (this.fighter ? 0.5 : 0.09) * dt);
    cmd.phi = this.vert === 'FLARE' && o.agl < 4 ? this.phiCmd * 0.3 : this.phiCmd;

    // vertical
    let vsCmd = 0;
    const altSel = sel.alt * FT;
    const defVs = (this.fighter ? 5000 : (o.altFt > 28000 ? 1200 : o.altFt > 15000 ? 1800 : 2400)) * FT / 60;
    if (this.vert === 'ALT') {
      const lim = sel.vs !== 0 ? Math.abs(sel.vs) * FT / 60 : defVs;
      const limDn = sel.vs !== 0 ? lim : (this.fighter ? 6000 : 2200) * FT / 60;
      vsCmd = clamp(0.11 * (altSel - o.alt), -limDn, lim);
    } else if (this.vert === 'VS') {
      vsCmd = sel.vs * FT / 60;
      const toGo = altSel - o.alt;
      if ((Math.sign(toGo) === Math.sign(vsCmd) || vsCmd === 0) && Math.abs(toGo) < Math.max(40, Math.abs(vsCmd) * 8)) {
        this.vert = 'ALT'; sel.vs = 0;
      }
    } else if (this.vert === 'GS' && dev) {
      vsCmd = -o.gs * Math.tan(this.ils.gp * DEG) + clamp(0.3 * (dev.pathAlt - o.alt), -4, 4);
    } else if (this.vert === 'FLARE') {
      const sink0 = Math.max(2.5, o.gs * Math.tan(3 * DEG));
      const tau = flareH / Math.max(0.5, sink0 - 0.45);
      vsCmd = -(0.45 + Math.max(0, o.agl) / tau);
      if (o.wow) vsCmd = -1.2;
    }
    // speed protection: do not climb into a stall or dive through the limit
    if (this.at && this.on && (this.vert === 'ALT' || this.vert === 'VS')) {
      const errKt = (this.targetCas() - o.cas) / KT;
      const max = this.fighter ? 0.86 : 1;
      if (vsCmd > 0 && this.thr > max - 0.03 && errKt > 4) vsCmd *= clamp(1 - (errKt - 4) / 12, -0.3, 1);
      if (vsCmd < 0 && this.thr < 0.03 && errKt < -12) vsCmd *= clamp(1 + (errKt + 12) / 28, 0.35, 1);
    }
    const gammaCmd = Math.asin(clamp(vsCmd / V, -0.35, 0.35));
    const lim = (0.28 * G) / V;
    cmd.thetaDot = clamp((this.vert === 'FLARE' ? 1.6 : 0.9) * (gammaCmd - o.gamma), -lim, lim);
    if (this.lat === 'ROLLOUT') {
      cmd.thetaDot = o.noseOnGround ? 0 : -1.2 * DEG;
      if (this.autobrake) c.brake = o.gs > 12 ? 0.45 : 0;
      c.spoilerArmed = true;
      if (o.gs < 12) { this.on = false; this.lat = 'HDG'; this.vert = 'ALT'; cmd.active = false; this.disconnectWarn = 2; }
    }

    // ------------------------------------------------------------ annunciations
    const f = this.fma;
    f.thr = this.at ? (this.vert === 'FLARE' ? 'RETARD' : this.sel.useMach ? 'MACH' : 'SPD') : '';
    f.lat = this.on ? (this.lat === 'HDG' ? 'HDG SEL' : this.lat) : '';
    f.vert = this.on ? (this.vert === 'ALT' ? (Math.abs(altSel - o.alt) < 60 ? 'ALT HOLD' : (altSel > o.alt ? 'CLB' : 'DES')) : this.vert === 'VS' ? 'V/S' : this.vert === 'GS' ? 'G/S' : this.vert) : '';
    f.ap = this.on ? (this.vert === 'FLARE' || this.lat === 'ROLLOUT' || (this.vert === 'GS' && o.ra < 1500) ? 'LAND 3' : 'CMD') : '';
    f.armed = (this.armed.loc ? 'LOC ' : '') + (this.armed.gs ? 'G/S' : '');
    return cmd;
  }
}
