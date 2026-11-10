// Flight control laws: turns pilot (or autopilot) demands into surface deflections.
//  - 'fbw'          attitude-rate command / attitude hold, auto-trim, optional envelope protection
//  - 'conventional' the same augmentation but with no protections (737, 747)
//  - 'fighter'      g-command pitch, roll-rate command, alpha and g limiters
//  - direct law     stick moves the surfaces directly, manual pitch trim
import { clamp, DEG, G, moveToward } from '../core/units.js';

export class FlightControls {
  constructor(fm) {
    this.fm = fm;
    this.direct = false;
    this.trim = 0;          // manual trim (direct law)
    this.autoTrim = 0;      // auto-trim integrator (elevator units)
    this.thetaRef = 0;
    this.phiHold = 0;
    this.blend = 0;         // 0 = ground law, 1 = flight law
    this.protection = '';   // active protection name for the FMA
    this.reset();
  }
  reset() {
    const o = this.fm.out;
    this.blend = o.onGround ? 0 : 1;
    this.thetaRef = o.pitch;
    this.phiHold = Math.abs(o.roll) < 2 * DEG ? 0 : o.roll;
    this.autoTrim = 0;
    this.protection = '';
  }

  /**
   * inp: { pitch, roll, yaw } in -1..1 (pitch + = nose up, roll + = right, yaw + = right)
   * ap:  null or { thetaDot (rad/s), phi (rad), yaw (-1..1, ground steering), active }
   */
  update(dt, inp, ap) {
    const fm = this.fm, o = fm.out, c = fm.ctl, P = fm.P, s = fm.spec, law = s.ctl;
    const fighter = law.law === 'fighter';
    const V = Math.max(o.tas, fighter ? 50 : 40);
    const qbar = Math.max(o.qbar, 0.5 * 1.0 * V * V * 0.6);
    const target = o.wow ? 0 : 1;
    const wasGround = this.blend < 0.02;
    this.blend = moveToward(this.blend, target, dt / (target ? 1.0 : 0.4));
    if (wasGround && this.blend >= 0.02) { this.thetaRef = o.pitch; this.autoTrim = clamp(c.elev - (this.eFF || 0), -0.5, 0.5); this.phiHold = 0; }
    const apOn = !!(ap && ap.active);
    this.protection = '';

    const sinPhi = Math.sin(o.roll), cosPhi = Math.cos(o.roll);
    const cosTh = Math.cos(o.pitch);

    // ------------------------------------------------------------------ direct law
    if (this.direct && !apOn) {
      const rCoord = (G / V) * sinPhi * cosTh;
      c.elev = clamp(inp.pitch * 0.9 + this.trim, -1, 1);
      c.ail = inp.roll;
      const damp = o.wow ? 0 : clamp((o.Izz * 1.0 * (rCoord - o.r)) / (qbar * P.S * P.b * P.cnCtl), -0.4, 0.4);
      c.rud = clamp(inp.yaw + damp, -1, 1);
      c.steer = o.onGround ? inp.yaw : 0;
      this.thetaRef = o.pitch; this.phiHold = o.roll; this.autoTrim = this.trim;
      return;
    }

    // ------------------------------------------------------------------ pitch
    const flapped = fm.flap > 0.02;
    const gPos = fighter ? s.limits.gPos : (flapped ? 2.0 : 2.5);
    const gNeg = fighter ? s.limits.gNeg : (flapped ? 0 : -1);
    let qCmd;
    if (fighter && !apOn) {
      // g command: neutral stick holds 1 g
      const stick = inp.pitch;
      let nzCmd = stick >= 0 ? 1 + stick * (gPos - 1) : 1 + stick * (1 - gNeg);
      // pitch-rate ceiling at low speed
      const qLim = law.pitchRate * DEG;
      qCmd = clamp(((nzCmd - cosTh * cosPhi) * G) / V, -qLim, qLim);
      // gentle attitude hold when hands-off and near level, so the jet does not wander
      if (Math.abs(stick) < 0.03 && Math.abs(o.roll) < 8 * DEG) {
        const cP = Math.max(cosPhi, 0.5);
        qCmd = (1.2 * (this.thetaRef - o.pitch)) / cP + o.r * (sinPhi / cP);
      } else this.thetaRef = o.pitch;
    } else {
      let thetaDot;
      if (apOn) {
        thetaDot = ap.thetaDot;
        this.thetaRef = o.pitch;
      } else {
        const stick = inp.pitch;
        const rateMax = Math.min(law.pitchRate * DEG, ((gPos - 1) * G) / V);
        const rateMin = Math.max(-law.pitchRate * DEG, ((gNeg - 1) * G) / V);
        if (Math.abs(stick) > 0.02) {
          thetaDot = stick > 0 ? stick * rateMax : -stick * rateMin;
          this.thetaRef = o.pitch + thetaDot * 0.12;
        } else {
          thetaDot = clamp(1.6 * (this.thetaRef - o.pitch), rateMin, rateMax);
        }
        if (law.pitchLimit) {
          const lo = law.pitchLimit[0] * DEG, hi = law.pitchLimit[1] * DEG;
          thetaDot = clamp(thetaDot, 1.5 * (lo - o.pitch), 1.5 * (hi - o.pitch));
          this.thetaRef = clamp(this.thetaRef, lo, hi);
        }
      }
      const cP = Math.max(Math.abs(cosPhi), 0.45) * (cosPhi < 0 ? -1 : 1);
      qCmd = thetaDot / cP + o.r * (sinPhi / cP);
    }

    // angle-of-attack protection
    const hasAlphaProt = fighter || law.alphaProt;
    if (hasAlphaProt && !o.onGround) {
      const aMax = fighter ? Math.min(law.alphaMax * DEG, o.aS - 2 * DEG) : o.aS - 1.6 * DEG;
      const lim = 1.6 * (aMax - o.alpha);
      if (qCmd > lim) { qCmd = lim; this.protection = fighter ? 'AOA LIM' : 'ALPHA PROT'; this.thetaRef = o.pitch; }
    }
    // load-factor limit as a pitch-rate limit
    const qG = ((gPos - cosTh * cosPhi) * G) / V;
    if (qCmd > qG && qG > 0) qCmd = qG;
    // high-speed protection (FBW airliners): nose up above VMO + 6 / MMO + 0.01
    if (law.law === 'fbw' && !o.onGround) {
      const over = Math.max(o.ias - (s.limits.vmo + 6), (o.mach - (s.limits.mmo + 0.01)) * 600);
      if (over > 0) { qCmd += Math.min(0.03, over * 0.0015); this.protection = 'HIGH SPEED PROT'; }
    }

    const mDen = qbar * P.S * P.c * P.cmCtl;
    const eP = clamp((o.Iyy * 2.6 * (qCmd - o.q)) / mDen, -1.2, 1.2);
    // feed-forward that cancels the static pitching moment, so the loop only shapes pitch rate
    const eFF = clamp(-(P.cm0 + P.cmA * o.alpha + P.cmFlap * fm.flap) / P.cmCtl, -0.9, 0.9);
    this.eFF = eFF;
    let elevFlight = eFF + this.autoTrim + eP;
    // integrate into auto-trim with anti-windup
    if (!((elevFlight > 1 && eP > 0) || (elevFlight < -1 && eP < 0))) this.autoTrim = clamp(this.autoTrim + eP * 1.6 * dt, -0.95, 0.95);
    elevFlight = clamp(elevFlight, -1, 1);
    // ground law: direct elevator with pitch-rate damping so rotation is smooth
    const qRef = (fighter ? 10 : 3.6) * DEG;
    const elevGround = clamp((apOn ? 0 : inp.pitch) - o.q / qRef, -1, 1);
    c.elev = elevGround + (elevFlight - elevGround) * this.blend;
    if (this.blend < 0.02) this.autoTrim = 0;

    // ------------------------------------------------------------------ roll
    let pMax = law.rollRate * DEG;
    if (fighter) pMax *= clamp(1 - (o.alpha - 14 * DEG) / (26 * DEG), 0.35, 1);
    let pCmd;
    if (apOn) {
      const lim = fighter ? 0.6 : 0.1;
      pCmd = clamp(1.6 * (ap.phi - o.roll), -lim, lim);
      this.phiHold = o.roll;
    } else if (Math.abs(inp.roll) > 0.02) {
      pCmd = inp.roll * pMax;
      this.phiHold = o.roll + pCmd * 0.15;
      if (law.bankLimit) {
        const bl = law.bankLimit * DEG;
        pCmd = clamp(pCmd, 2 * (-bl - o.roll), 2 * (bl - o.roll));
      }
    } else if (fighter) {
      pCmd = Math.abs(o.roll) < 4 * DEG && Math.abs(o.p) < 0.05 ? -1.5 * o.roll : 0;
    } else {
      if (law.bankLimit && Math.abs(this.phiHold) > 33 * DEG) this.phiHold = Math.sign(this.phiHold) * 33 * DEG;
      if (Math.abs(this.phiHold) < 2 * DEG) this.phiHold = 0;
      pCmd = clamp(2.0 * (this.phiHold - o.roll), -pMax * 0.6, pMax * 0.6);
    }
    const ailEff = fighter ? 1 : Math.min(1, (P.qRudRef * 3.2) / qbar);
    const clc = P.clCtl * ailEff * (1 - 0.55 * o.sigma);
    const ailFlight = clamp((-P.clP * ((pCmd * P.b) / (2 * V))) / clc + (o.Ixx * 3.5 * (pCmd - o.p)) / (qbar * P.S * P.b * clc), -1, 1);
    c.ail = (o.wow ? (apOn ? 0 : inp.roll * 0.5) : ailFlight) * (o.wow ? 1 : 1);
    if (!o.wow) c.ail = ailFlight * Math.max(this.blend, 0.3);

    // ------------------------------------------------------------------ yaw
    const rudEff = Math.min(1, P.qRudRef / qbar);
    const rCoord = (G / V) * sinPhi * cosTh;
    const yawIn = apOn && ap.yaw != null ? ap.yaw : inp.yaw;
    const betaCmd = -yawIn * (fighter ? 8 : 13) * DEG * Math.min(1, 90 / V);
    const rudFlight = clamp(3.0 * (o.beta - betaCmd) + (o.Izz * 1.3 * (rCoord - o.r)) / (qbar * P.S * P.b * P.cnCtl * rudEff), -1, 1);
    c.rud = yawIn + (rudFlight - yawIn) * this.blend;
    c.steer = o.onGround ? yawIn : 0;
  }
}
