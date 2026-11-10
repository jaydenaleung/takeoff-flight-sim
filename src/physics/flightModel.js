// Six-degree-of-freedom rigid-body flight model.
// World frame: +X east, +Y up, +Z south. Body frame: +X right wing, +Y up, -Z forward.
import * as THREE from 'three';
import { G, KT, FT, DEG, RAD, clamp, moveToward } from '../core/units.js';
import { isa, casFromMach, Weather } from './atmosphere.js';
import { deriveAero, aeroCoeffs, vSpeeds, flapLift } from './aero.js';
import { Engine } from './engine.js';

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _vb = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _omw = new THREE.Vector3();
const _f = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _t = new THREE.Vector3();
const _gearB = new THREE.Vector3();
const _e = new THREE.Euler();
const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

const flatEnv = {
  ground: () => ({ h: 0, water: false, paved: true }),
  weather: null,
  damage: true,
};

export class FlightModel {
  constructor(spec, env = flatEnv) {
    this.spec = spec;
    this.env = { ...flatEnv, ...env };
    if (!this.env.weather) this.env.weather = new Weather('clear');
    this.P = deriveAero(spec);
    this.geo = this.P.geo;
    this.fighter = spec.type === 'fighter';

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.om = new THREE.Vector3();          // body rates in three.js body axes (rad/s)

    this.engines = this.geo.engines.map((m) => new Engine(spec, m));
    this.ctl = {
      elev: 0, ail: 0, rud: 0, throttle: 0, reverse: false, brake: 0, parkBrake: false,
      steer: 0, flapIdx: 0, gearDown: true, spoiler: 0, spoilerArmed: false,
    };
    this.surf = { elev: 0, ail: 0, rud: 0 };
    this.flap = 0; this.gear = 1; this.spoiler = 0; this.groundSpoiler = 0;
    this.fuel = spec.mass.fuel * 0.5;
    this.payload = spec.mass.payload * 0.7;
    this.asym = 0;

    // Landing gear: spring-damper struts at the real wheelbase and track.
    const mRef = (spec.mass.oew + spec.mass.mtow) / 2;
    const ds = this.fighter ? 0.18 : 0.28;
    const mk = (p, frac, steer, brake) => {
      const F = mRef * G * frac;
      const k = F / ds;
      return {
        r: new THREE.Vector3(p.x, p.y - ds, p.z), k, c: 2 * 0.5 * Math.sqrt(k * (F / G)),
        steer, brake, comp: 0, load: 0, contact: false, spin: 0,
      };
    };
    const nl = this.geo.noseLoad;
    this.gears = [
      mk(this.geo.gearNose, nl, true, false),
      mk(this.geo.gearMain[0], (1 - nl) / 2, false, true),
      mk(this.geo.gearMain[1], (1 - nl) / 2, false, true),
    ];
    this.probes = this.geo.probes.map((p) => ({ name: p.name, r: new THREE.Vector3(p.x, p.y, p.z) }));

    this.out = {
      cas: 0, ias: 0, tas: 0, gs: 0, mach: 0, alt: 0, altFt: 0, agl: 0, ra: 0, vs: 0, vsFpm: 0,
      pitch: 0, roll: 0, hdg: 0, track: 0, alpha: 0, beta: 0, gamma: 0, nz: 1, ny: 0,
      p: 0, q: 0, r: 0, qbar: 0, rho: 1.225, a: 340, onGround: true, wow: true, groundH: 0,
      aS: 0.25, stall: false, sigma: 0, thrust: 0, mass: 0, n1: 0, paved: true,
      Ixx: 1, Iyy: 1, Izz: 1, windX: 0, windZ: 0, accel: 0,
    };
    this.time = 0;
    this.airTime = 0; this.groundTime = 10;
    this.crashed = null;
    this.events = [];
    this.overG = 0;
    this.maxG = 1;
    this.reset({ x: 0, z: 0, hdg: 0, onGround: true });
  }

  get mass() { return this.spec.mass.oew + this.payload + this.fuel; }
  vspeeds() {
    return vSpeeds(this.P, this.mass, this.spec.flaps[this.spec.toFlap][1], this.spec.flaps[this.spec.ldgFlap][1]);
  }

  /**
   * Place the aircraft. o: { x, z, hdg (true deg), onGround, alt (m MSL), speed (m/s TAS),
   * gamma (rad), flapIdx, gearDown, throttle, fuelFrac, payloadFrac }
   */
  reset(o) {
    const s = this.spec;
    if (o.fuelFrac != null) this.fuel = s.mass.fuel * o.fuelFrac;
    if (o.payloadFrac != null) this.payload = s.mass.payload * o.payloadFrac;
    this.crashed = null; this.events.length = 0;
    this.om.set(0, 0, 0);
    const hdg = (o.hdg || 0) * DEG;
    const g = this.env.ground(o.x, o.z);
    const c = this.ctl;
    c.elev = c.ail = c.rud = 0; c.reverse = false; c.steer = 0; c.spoiler = 0; c.spoilerArmed = false;
    this.surf.elev = this.surf.ail = this.surf.rud = 0;
    this.spoiler = 0; this.groundSpoiler = 0;
    if (o.onGround) {
      this.pos.set(o.x, g.h + s.gear.cgH + 0.02, o.z);
      this.vel.set(0, 0, 0);
      this.quat.setFromEuler(_e.set(0, -hdg, 0, 'YXZ'));
      c.gearDown = true; this.gear = 1;
      c.flapIdx = o.flapIdx ?? 0;
      c.throttle = o.throttle ?? 0;
      c.brake = 0; c.parkBrake = o.parkBrake ?? true;
      this.airTime = 0; this.groundTime = 10;
    } else {
      const alt = o.alt ?? 1000;
      const V = o.speed ?? 130;
      const gamma = o.gamma ?? 0;
      c.flapIdx = o.flapIdx ?? 0;
      c.gearDown = o.gearDown ?? false;
      this.gear = c.gearDown ? 1 : 0;
      const flap = s.flaps[c.flapIdx][1];
      const atm = isa(alt, this.env.weather.dT);
      const qbar = 0.5 * atm.rho * V * V;
      const M = V / atm.a;
      const clReq = (this.mass * G * Math.cos(gamma)) / (qbar * this.P.S);
      const alpha = clamp((clReq - this.P.cl0 - flapLift(this.P, flap)) / (this.P.cla(M) * (1 + 0.12 * flap)), -0.1, 0.3);
      this.pos.set(o.x, alt, o.z);
      const w = this.env.weather.windAt(alt, alt - g.h);
      this.vel.set(Math.sin(hdg) * Math.cos(gamma) * V + w[0], Math.sin(gamma) * V, -Math.cos(hdg) * Math.cos(gamma) * V + w[2]);
      this.quat.setFromEuler(_e.set(alpha + gamma, -hdg, 0, 'YXZ'));
      c.throttle = o.throttle ?? 0.6;
      c.brake = 0; c.parkBrake = false;
      this.airTime = 10; this.groundTime = 0;
    }
    this.flap = s.flaps[c.flapIdx][1];
    for (const e of this.engines) { e.running = true; e.failed = false; e.start = 1; e.x = clamp(c.throttle / (e.e.abThrust ? 0.87 : 1), 0, 1); e.ab = 0; e.rev = 0; }
    for (const gr of this.gears) { gr.comp = 0; gr.load = 0; gr.contact = false; }
    this.maxG = 1; this.overG = 0;
    this.computeOut(0, 1, 0);
  }

  /** Advance the simulation by one fixed step. */
  step(dt) {
    if (this.crashed) return;
    const s = this.spec, P = this.P, c = this.ctl, o = this.out, env = this.env;
    this.time += dt;
    const pos = this.pos, vel = this.vel, q = this.quat, om = this.om;

    // ---------------------------------------------------------------- systems
    const flapTarget = s.flaps[clamp(c.flapIdx, 0, s.flaps.length - 1)][1];
    this.flap = moveToward(this.flap, flapTarget, dt / (this.fighter ? 3.5 : 26));
    const gearTarget = c.gearDown || o.wow ? 1 : 0;
    this.gear = moveToward(this.gear, gearTarget, dt / (this.fighter ? 4 : 9));
    const idle = c.throttle < 0.12;
    const gsWanted = o.wow && idle && (c.spoilerArmed || c.reverse) && o.gs > 15 ? 1 : 0;
    if (gsWanted && this.groundSpoiler < 0.01) this.events.push({ type: 'spoilers' });
    this.groundSpoiler = moveToward(this.groundSpoiler, gsWanted, dt / 0.6);
    this.spoiler = moveToward(this.spoiler, Math.max(c.spoiler, this.groundSpoiler), dt / 0.7);
    const rate = this.fighter ? 5 : 2.4;
    this.surf.elev = moveToward(this.surf.elev, clamp(c.elev, -1, 1), rate * dt);
    this.surf.ail = moveToward(this.surf.ail, clamp(c.ail, -1, 1), rate * 1.2 * dt);
    this.surf.rud = moveToward(this.surf.rud, clamp(c.rud, -1, 1), rate * dt);

    // ---------------------------------------------------------------- mass
    const m = this.mass;
    const L = s.dims.length, b = s.dims.span;
    const kx = this.fighter ? 0.23 : 0.24, ky = this.fighter ? 0.38 : 0.36, kz = this.fighter ? 0.52 : 0.44;
    const Ixx = m * (kx * b / 2) ** 2, Iyy = m * (ky * L / 2) ** 2, Izz = m * (kz * (b + L) / 4) ** 2;

    // ---------------------------------------------------------------- air data
    const gi = env.ground(pos.x, pos.z);
    const atm = isa(pos.y, env.weather.dT);
    const rho = atm.rho, aSnd = atm.a, pStat = atm.p;
    const w = env.weather.windAt(pos.y, pos.y - gi.h);
    _qi.copy(q).invert();
    _vb.set(vel.x - w[0], vel.y - w[1], vel.z - w[2]).applyQuaternion(_qi);
    const V = Math.max(_vb.length(), 0.01);
    const u = -_vb.z, vv = _vb.x, ww = -_vb.y;
    const alpha = V > 1 ? Math.atan2(ww, u) : 0;
    const beta = V > 1 ? Math.asin(clamp(vv / V, -1, 1)) : 0;
    const qbar = 0.5 * rho * V * V;
    const M = V / aSnd;
    const pR = -om.z, qR = om.x, rR = -om.y;
    const Vd = Math.max(V, 5);
    const hw = Math.max(0, pos.y + this.geo.wingY - gi.h);
    const ge = Math.exp((-4.5 * hw) / b);

    // slow random asymmetry used for wing drop at the stall
    this.asym += (Math.sin(this.time * 0.7) + Math.sin(this.time * 1.9 + 1) - this.asym) * dt;

    const co = aeroCoeffs(P, {
      alpha, beta, M, pHat: (pR * b) / (2 * Vd), qHat: (qR * P.c) / (2 * Vd), rHat: (rR * b) / (2 * Vd),
      elev: this.surf.elev, ail: this.surf.ail, rud: this.surf.rud,
      flap: this.flap, gear: this.gear, spoiler: this.spoiler, groundSpoiler: this.groundSpoiler,
      ge, qbar, asym: this.asym,
    });
    const qS = qbar * P.S;
    const lift = qS * co.CL, drag = qS * co.CD, side = qS * co.CY;

    // lift is perpendicular to the airflow in the plane of symmetry; drag opposes the airflow
    const ln = Math.hypot(_vb.z, _vb.y) || 1;
    _fb.set(
      side - (drag * _vb.x) / V,
      (lift * -_vb.z) / ln - (drag * _vb.y) / V,
      (lift * _vb.y) / ln - (drag * _vb.z) / V,
    );
    _tb.set(qS * P.c * co.Cm, -qS * b * co.Cn, -qS * b * co.Cl);

    // ---------------------------------------------------------------- engines
    let thrustSum = 0, ffSum = 0, n1Sum = 0;
    const hasFuel = this.fuel > 0;
    for (const e of this.engines) {
      e.update(dt, c.throttle, c.reverse, atm, M, o.wow, hasFuel);
      const T = e.thrust;
      thrustSum += T; ffSum += e.ff; n1Sum += e.n1;
      _fb.z -= T;
      _tb.x += -e.mount.y * T;
      _tb.y += e.mount.x * T;
    }
    this.fuel = Math.max(0, this.fuel - ffSum * dt);

    // ---------------------------------------------------------------- ground reaction
    _fw.copy(_fb).applyQuaternion(q);          // aerodynamic + thrust, world axes
    const aeroBodyY = _fb.y;
    _gearB.set(0, 0, 0);
    let contacts = 0;
    _omw.copy(om).applyQuaternion(q);
    _fwd.copy(FWD).applyQuaternion(q);
    const gearOk = this.gear > 0.92;
    const brake = c.parkBrake ? 1 : clamp(c.brake, 0, 1);
    // nose-wheel steering authority shrinks with speed so lateral acceleration stays near 0.3 g
    const steerMax = Math.min(70 * DEG, Math.atan((s.gear.wheelbase * 0.3 * G) / Math.max(o.gs * o.gs, 1)));
    // horizontal acceleration from everything except the tyres (for static friction)
    const axo = _fw.x / m, azo = _fw.z / m;
    let gfx = 0, gfy = 0, gfz = 0;
    for (let i = 0; i < 3; i++) {
      const gr = this.gears[i];
      gr.contact = false; gr.load = 0;
      if (!gearOk) continue;
      _r.copy(gr.r).applyQuaternion(q);
      const px = pos.x + _r.x, pz = pos.z + _r.z, py = pos.y + _r.y;
      const gh = i === 0 || Math.abs(_r.x) + Math.abs(_r.z) > 6 ? env.ground(px, pz).h : gi.h;
      const pen = gh - py;
      if (pen <= 0) { gr.comp = 0; continue; }
      _vp.crossVectors(_omw, _r).add(vel);
      let N = gr.k * pen - gr.c * _vp.y;
      if (pen > 0.6) N += gr.k * 6 * (pen - 0.6);
      if (N <= 0) { gr.comp = pen; continue; }
      gr.contact = true; gr.load = N; gr.comp = pen; contacts++;
      // wheel heading on the ground plane
      _f.copy(_fwd); _f.y = 0;
      if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
      _f.normalize();
      if (gr.steer) {
        const d = -c.steer * steerMax;
        const cs = Math.cos(d), sn = Math.sin(d);
        const fx = _f.x * cs + _f.z * sn, fz = -_f.x * sn + _f.z * cs;
        _f.x = fx; _f.z = fz;
      }
      _right.set(-_f.z, 0, _f.x);            // cross(f, up)
      // velocity the contact patch would have after this step without tyre forces
      const vlong = _vp.x * _f.x + _vp.z * _f.z + (axo * _f.x + azo * _f.z) * dt;
      const vlat = _vp.x * _right.x + _vp.z * _right.z + (axo * _right.x + azo * _right.z) * dt;
      const meff = N / G;
      const mu = gi.paved ? 1 : 0.8;
      const muRoll = gi.paved ? 0.016 : 0.07;
      const maxLong = (muRoll + (gr.brake ? 0.42 * brake * mu : 0)) * N;
      // braked wheels carry the whole aircraft's inertia between them, so it truly stops
      const mLong = gr.brake ? m * 0.5 : meff;
      let Flong = -clamp((vlong * mLong) / dt, -maxLong, maxLong);
      // tyre cornering grip falls off with speed
      const muLat = clamp(0.5 - 0.2 * (o.gs - 15) / 40, 0.3, 0.5) * mu;
      let Flat = -clamp((vlat * meff) / dt * 0.25, -muLat * N, muLat * N);
      const fmag = Math.hypot(Flong, Flat), fmax = 0.62 * mu * N;
      if (fmag > fmax) { Flong *= fmax / fmag; Flat *= fmax / fmag; }
      const Fx = _f.x * Flong + _right.x * Flat, Fz = _f.z * Flong + _right.z * Flat;
      gfx += Fx; gfy += N; gfz += Fz;
      _t.set(_r.y * Fz - _r.z * N, _r.z * Fx - _r.x * Fz, _r.x * N - _r.y * Fx);   // r x F (world)
      _t.applyQuaternion(_qi);
      _tb.add(_t);
      gr.spin = _vp.x * _f.x + _vp.z * _f.z;
    }

    // Airframe points that must not touch the ground.
    for (const pr of this.probes) {
      _r.copy(pr.r).applyQuaternion(q);
      const gh = env.ground(pos.x + _r.x, pos.z + _r.z).h;
      const pen = gh - (pos.y + _r.y);
      if (pen <= 0.02) continue;
      if (pr.name === 'tail' && gearOk && vel.y > -4 && pen < 0.8) {
        // tail strike: scrape, with a stiff contact so the fuselage cannot sink through
        _vp.crossVectors(_omw, _r).add(vel);
        const N = Math.max(0, m * G * 4 * pen - m * 1.5 * _vp.y);
        gfy += N;
        _t.set(-_r.z * N, 0, _r.x * N).applyQuaternion(_qi);
        _tb.add(_t);
        if (!this._tailstrike) { this._tailstrike = true; this.events.push({ type: 'tailstrike' }); }
        continue;
      }
      if (pr.name === 'belly' && gearOk) continue;
      const reason = !gearOk && (pr.name === 'belly' || pr.name === 'nose' || pr.name === 'tail' || pr.name === 'engine')
        ? (o.gs < 110 && vel.y > -5 ? 'Gear-up landing' : 'Terrain impact')
        : pr.name === 'engine' ? 'Engine pod strike'
          : pr.name.includes('wing') ? 'Wing strike'
            : pr.name === 'nose' ? 'Nose impact' : 'Terrain impact';
      this.crash(gi.water ? 'Crashed into the water' : reason);
      return;
    }
    if (pos.y < gi.h + 0.3) { this.crash(gi.water ? 'Crashed into the water' : 'Terrain impact'); return; }
    if (contacts > 0 && gi.water) { this.crash('Ditched in the water'); return; }

    // touchdown / lift-off bookkeeping
    if (contacts > 0) {
      if (this.airTime > 1.0) {
        const sink = -vel.y;
        this.events.push({
          type: 'touchdown', sink, gs: o.gs, x: pos.x, z: pos.z, pitch: o.pitch, roll: o.roll,
          hdg: o.hdg, track: o.track, time: this.time, paved: gi.paved,
        });
        if (sink > 6.6 && env.damage) { this.crash(`Hard landing - gear collapse (${Math.round(sink / FT * 60)} fpm)`); return; }
      }
      this.airTime = 0; this.groundTime += dt;
    } else {
      if (this.groundTime > 1.0 && this.airTime === 0) this.events.push({ type: 'liftoff', x: pos.x, z: pos.z, time: this.time });
      this.airTime += dt;
      if (this.airTime > 0.5) { this.groundTime = 0; this._tailstrike = false; }
    }

    // ---------------------------------------------------------------- integrate
    _fw.x += gfx; _fw.y += gfy - m * G; _fw.z += gfz;
    const ax = _fw.x / m, ay = _fw.y / m, az = _fw.z / m;
    vel.x += ax * dt; vel.y += ay * dt; vel.z += az * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;

    const Ix = Iyy, Iy = Izz, Iz = Ixx;       // three.js body axes: X pitch, Y yaw, Z roll
    const wx = om.x, wy = om.y, wz = om.z;
    om.x += ((_tb.x - (wy * Iz * wz - wz * Iy * wy)) / Ix) * dt;
    om.y += ((_tb.y - (wz * Ix * wx - wx * Iz * wz)) / Iy) * dt;
    om.z += ((_tb.z - (wx * Iy * wy - wy * Ix * wx)) / Iz) * dt;
    const wmag = om.length();
    if (wmag > 1e-9) {
      _q.setFromAxisAngle(_t.copy(om).multiplyScalar(1 / wmag), wmag * dt);
      q.multiply(_q).normalize();
    }
    if (!(pos.x === pos.x) || !(q.w === q.w)) { this.crash('Simulation diverged'); return; }

    // load factor along body up (what the airframe and pilot feel)
    _t.set(gfx, gfy, gfz).applyQuaternion(_qi);
    const nz = (aeroBodyY + _t.y) / (m * G);

    // structural limits
    this.maxG = Math.max(this.maxG, nz);
    if (env.damage) {
      const lim = s.limits;
      if (nz > lim.gPos * 1.5 + 0.4 || nz < lim.gNeg * 1.5 - 0.4) {
        this.overG += dt;
        if (this.overG > 0.35 && contacts === 0) { this.crash(`Structural failure (${nz.toFixed(1)} g)`); return; }
      } else this.overG = Math.max(0, this.overG - dt);
      const cas = casFromMach(M, pStat) / KT;
      if ((cas > lim.vmo + (this.fighter ? 90 : 65) || M > lim.mmo + (this.fighter ? 0.25 : 0.1)) && contacts === 0) {
        this.overspeedT = (this.overspeedT || 0) + dt;
        if (this.overspeedT > 6) { this.crash('Overspeed - structural failure'); return; }
      } else this.overspeedT = 0;
    }

    o.Ixx = Ixx; o.Iyy = Iyy; o.Izz = Izz;
    o.thrust = thrustSum; o.ff = ffSum; o.n1 = n1Sum / this.engines.length;
    o.sigma = co.sigma; o.aS = co.aS;
    o.accel = ax * _fwd.x + ay * _fwd.y + az * _fwd.z;
    o.windX = w[0]; o.windZ = w[2];
    this.computeOut(contacts, nz, dt, gi, M, V, alpha, beta, qbar, rho, aSnd, pStat);
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = { reason, time: this.time, x: this.pos.x, z: this.pos.z };
    this.events.push({ type: 'crash', reason });
  }

  computeOut(contacts, nz, dt, gi, M, V, alpha, beta, qbar, rho, aSnd, pStat) {
    const o = this.out, pos = this.pos, vel = this.vel, q = this.quat, s = this.spec;
    if (!gi) {
      gi = this.env.ground(pos.x, pos.z);
      const atm = isa(pos.y, this.env.weather.dT);
      rho = atm.rho; aSnd = atm.a; pStat = atm.p;
      const w = this.env.weather.windAt(pos.y, pos.y - gi.h);
      _qi.copy(q).invert();
      _vb.set(vel.x - w[0], vel.y - w[1], vel.z - w[2]).applyQuaternion(_qi);
      V = Math.max(_vb.length(), 0.01);
      alpha = V > 1 ? Math.atan2(_vb.y * -1, -_vb.z) : 0;
      beta = V > 1 ? Math.asin(clamp(_vb.x / V, -1, 1)) : 0;
      M = V / aSnd; qbar = 0.5 * rho * V * V;
      contacts = this.groundTime > 0 ? 3 : 0;
      o.aS = this.P.alphaStall;
    }
    _fwd.copy(FWD).applyQuaternion(q);
    _right.set(1, 0, 0).applyQuaternion(q);
    _up.copy(UP).applyQuaternion(q);
    o.pitch = Math.asin(clamp(_fwd.y, -1, 1));
    o.roll = Math.atan2(-_right.y, _up.y);
    o.hdg = (Math.atan2(_fwd.x, -_fwd.z) * RAD + 360) % 360;
    o.gs = Math.hypot(vel.x, vel.z);
    o.track = o.gs > 1 ? (Math.atan2(vel.x, -vel.z) * RAD + 360) % 360 : o.hdg;
    o.tas = V; o.mach = M; o.cas = casFromMach(M, pStat); o.ias = o.cas / KT;
    o.alt = pos.y; o.altFt = pos.y / FT;
    o.groundH = gi.h; o.paved = gi.paved; o.water = gi.water;
    o.agl = Math.max(0, pos.y - gi.h - s.gear.cgH);
    o.ra = o.agl / FT;
    o.vs = vel.y; o.vsFpm = vel.y / FT * 60;
    o.gamma = Math.atan2(vel.y, Math.max(o.gs, 0.1));
    o.alpha = alpha; o.beta = beta; o.qbar = qbar; o.rho = rho; o.a = aSnd; o.pStat = pStat;
    o.nz = nz;
    o.p = -this.om.z; o.q = this.om.x; o.r = -this.om.y;
    o.onGround = contacts > 0;
    o.wow = contacts > 0 && (this.gears[1].contact || this.gears[2].contact || this.groundTime > 0.3);
    o.noseOnGround = this.gears[0].contact;
    o.stall = !o.onGround && V > 20 && (alpha > o.aS - 1.5 * DEG);
    o.mass = this.mass;
    o.fuel = this.fuel;
    o.flap = this.flap; o.gear = this.gear; o.spoiler = this.spoiler;
  }
}
