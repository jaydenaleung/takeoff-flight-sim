// Turbofan model: thrust lapse with altitude and Mach, spool dynamics, afterburner, reverse,
// and the gauges (N1, N2, EGT, fuel flow).
import { clamp, moveToward } from '../core/units.js';
import { RHO0 } from './atmosphere.js';

export class Engine {
  constructor(spec, mount) {
    this.spec = spec;
    this.e = spec.eng;
    this.mount = mount;
    this.hb = this.e.kind === 'hbpr';
    this.running = true;
    this.failed = false;
    this.x = 0;          // dry spool state 0..1
    this.ab = 0;         // afterburner 0..1
    this.rev = 0;        // reverser deployment 0..1
    this.start = 1;      // 0..1 start sequence progress
    this.thrust = 0;     // N, along body forward (negative in reverse)
    this.n1 = 20; this.n2 = 60; this.egt = 400; this.ff = 0;
    this.idleFrac = this.hb ? 0.05 : 0.045;
  }
  setRunning(on) {
    if (on && !this.running && !this.failed) { this.running = true; this.start = 0; }
    if (!on) { this.running = false; }
  }
  /**
   * lever: 0..1 thrust lever. reverse: boolean. atm: {rho}. M: Mach. hasFuel: boolean.
   */
  update(dt, lever, reverse, atm, M, onGround, hasFuel) {
    const e = this.e;
    const alive = this.running && !this.failed && hasFuel;
    if (alive && this.start < 1) this.start = Math.min(1, this.start + dt / 18);
    if (!alive) this.start = Math.max(0, this.start - dt / 12);
    const lit = alive && this.start >= 1;

    // Reverser deployment (airliners, on the ground only).
    const wantRev = reverse && e.reverse && onGround && lit;
    this.rev = moveToward(this.rev, wantRev ? 1 : 0, dt / 1.6);

    // Lever mapping: fighters keep the last 13% of travel for afterburner.
    let dryCmd, abCmd = 0;
    if (e.abThrust) {
      dryCmd = clamp(lever / 0.87, 0, 1);
      abCmd = lever > 0.87 ? clamp((lever - 0.87) / 0.13, 0.05, 1) : 0;
    } else {
      dryCmd = clamp(lever, 0, 1);
    }
    if (this.rev > 0.02) dryCmd = wantRev ? Math.max(0.72, dryCmd * 0.85) : 0;
    if (!lit) { dryCmd = 0; abCmd = 0; }

    // Spool dynamics: slow from idle, quick near the top.
    const up = this.hb ? 0.075 + 0.36 * this.x : 0.2 + 0.6 * this.x;
    const down = this.hb ? 0.22 + 0.2 * this.x : 0.4 + 0.4 * this.x;
    this.x = moveToward(this.x, dryCmd, (dryCmd > this.x ? up : down) * dt);
    const abOk = lit && this.x > 0.95;
    this.ab = moveToward(this.ab, abOk ? abCmd : 0, dt / (abCmd > this.ab ? 0.9 : 0.5));

    const sigma = atm.rho / RHO0;
    let thrust = 0, ffRate = 0;
    const xp = Math.pow(this.x, 1.6);
    if (this.hb) {
      const lapse = Math.pow(sigma, 0.8);
      const fM = 1 / (1 + 0.9 * M);
      const idle = this.idleFrac - 0.09 * M;
      const frac = idle * (1 - xp) + fM * xp;
      thrust = e.thrust * lapse * frac * this.start;
      ffRate = e.tsfc * (1 + 0.78 * M) * Math.max(thrust, e.thrust * lapse * 0.035);
    } else {
      const lapse = Math.pow(sigma, 0.7);
      const roll = clamp(1 - (M - (this.spec.limits.mmo - 0.25)) / 0.5, 0.3, 1);
      const fDry = (1 - 0.2 * M + (e.ram || 0.12) * M * M) * roll;
      const fAb = (1 - 0.15 * M + ((e.ram || 0.12) + 0.18) * M * M) * roll;
      const idle = this.idleFrac - 0.06 * M;
      const dry = e.thrust * lapse * (idle * (1 - xp) + fDry * xp);
      const wet = e.abThrust * lapse * fAb;
      thrust = (dry + (wet - dry) * this.ab) * this.start;
      const ffDry = e.tsfc * (1 + 0.25 * M) * Math.max(dry, e.thrust * lapse * 0.04);
      ffRate = ffDry + (e.tsfcAB * wet - ffDry) * this.ab;
    }
    if (!lit) { ffRate = 0; thrust *= 0.0; }
    // Windmilling drag when shut down in flight.
    if (!lit && M > 0.1) thrust = -0.012 * e.thrust * sigma * M * 4;
    // Reverse: about 40% of forward thrust, directed aft.
    if (this.rev > 0.02) thrust = thrust * (1 - this.rev) - 0.42 * thrust * this.rev;
    this.thrust = thrust;
    this.ff = ffRate;

    // Gauges.
    const sp = this.start;
    const n1t = lit ? (this.hb ? 20.5 + 80 * Math.pow(this.x, 0.85) : 62 + 38 * this.x) : (alive ? 20 * sp : Math.min(18, M * 40));
    const n2t = lit ? 59 + 41 * Math.pow(this.x, 0.7) : (alive ? 58 * sp : Math.min(20, M * 35));
    this.n1 += (n1t - this.n1) * Math.min(1, dt * 3);
    this.n2 += (n2t - this.n2) * Math.min(1, dt * 3);
    const egtT = lit ? 410 + 480 * this.x + 650 * this.ab * 0 + (sp < 1 ? 250 * Math.sin(sp * Math.PI) : 0) : 25 + 380 * sp;
    this.egt += (egtT - this.egt) * Math.min(1, dt * 0.8);
  }
}
