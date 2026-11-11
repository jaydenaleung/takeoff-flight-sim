// One flight session: the aircraft, its systems, the weather and the fixed-step simulation loop.
import * as THREE from 'three';
import { FlightModel } from './physics/flightModel.js';
import { Weather } from './physics/atmosphere.js';
import { FlightControls } from './systems/fbw.js';
import { Autopilot, ilsDeviation } from './systems/autopilot.js';
import { AircraftModel } from './aircraft/model.js';
import { settings } from './core/settings.js';
import { KT, FT, NM, DEG, RAD, clamp, wrap360, wrap180 } from './core/units.js';

const H = 1 / 120;
const _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Flight {
  /**
   * o: { spec, dep, dest, start, weather, hour, fuel, payload }
   */
  constructor(world, o) {
    this.world = world;
    this.spec = o.spec;
    this.dep = o.dep; this.dest = o.dest;
    this.weather = new Weather(o.weather || 'clear');
    this.fm = new FlightModel(o.spec, { ground: world.ground, weather: this.weather, damage: settings.damage });
    this.fm.fuel = o.spec.mass.fuel * (o.fuel ?? 0.5);
    this.fm.payload = o.spec.mass.payload * (o.payload ?? 0.7);
    this.fcs = new FlightControls(this.fm);
    this.ap = new Autopilot(this.fm);
    this.ap.magVar = (x, z) => world.db.magVar(x, z);
    this.model = new AircraftModel(o.spec, { detail: 1 });
    world.scene.add(this.model.group);
    this.timeScale = 1;
    this.paused = false;
    this.acc = 0;
    this.time = 0;
    this.pilot = { pitch: 0, roll: 0, yaw: 0 };
    this.lights = { nav: true, beacon: true, strobe: false, landing: false };
    this.pushback = null;
    this.events = [];            // high-level events for the UI / ATC / audio
    this.landing = null;
    this.speedbrake = 0;
    this.taxiRoute = null;
    this.depEnd = this.dep ? this.dep.activeEnds(this.weather.windDir, this.weather.windKt)[0] : null;
    this.arrEnd = this.dest ? this.pickArrival(this.dest) : null;
    this.place(o.start || 'gate');
  }

  pickArrival(ap) {
    const ends = ap.activeEnds(this.weather.windDir, this.weather.windKt);
    return ends.find((e) => e.ils) || ends[0];
  }
  magVar() { return this.world.db.magVar(this.fm.pos.x, this.fm.pos.z); }
  hdgMag() { return wrap360(this.fm.out.hdg - this.magVar()); }

  place(start) {
    const fm = this.fm, s = this.spec, vs = fm.vspeeds();
    this.start = start;
    this.pushback = null;
    const fuelFrac = fm.fuel / s.mass.fuel, payloadFrac = fm.payload / s.mass.payload;
    if (start === 'runway') {
      const e = this.depEnd;
      const d = (e.displaced || 0) + 45 + fm.geo.cgX;
      fm.reset({ x: e.x + e.dir.x * d, z: e.z + e.dir.z * d, hdg: e.hdg, onGround: true, flapIdx: s.toFlap, parkBrake: true, fuelFrac, payloadFrac });
      this.stand = null;
    } else if (start === 'final') {
      const ap = this.dest || this.dep;
      const e = this.dest ? this.arrEnd : this.pickArrival(ap);
      this.arrEnd = e;
      const dist = 10 * NM;
      const alt = ap.elev + 2900 * FT;
      fm.reset({
        x: e.thr.x - e.dir.x * dist, z: e.thr.z - e.dir.z * dist, hdg: e.hdg, onGround: false, alt,
        speed: (vs.vapp + 30 * KT) * 1.04, flapIdx: Math.max(1, s.ldgFlap - 2), gearDown: false, throttle: 0.45, fuelFrac, payloadFrac,
      });
      if (e.ils) this.ap.setILS(e.ils);
      this.ap.sel.spd = Math.round((vs.vapp + 30 * KT) / KT);
      this.ap.sel.alt = Math.round(alt / FT / 100) * 100;
      this.ap.sel.hdg = Math.round(wrap360(e.hdg - this.magVar()));
    } else if (start === 'cruise') {
      const a = this.dep, b = this.dest || this.dep;
      const dx = b.c.x - a.c.x, dz = b.c.z - a.c.z, D = Math.hypot(dx, dz);
      const f = D > 100 * NM ? 0.45 : 0.5;
      const hdg = D > 1000 ? wrap360(Math.atan2(dx, -dz) * RAD) : 0;
      const x = D > 1000 ? a.c.x + dx * f : a.c.x, z = D > 1000 ? a.c.z + dz * f : a.c.z - 60 * NM;
      const altFt = this.cruiseAltitude(D);
      const alt = altFt * FT;
      const aSnd = 340.3 * Math.sqrt(Math.max(216.65, 288.15 - 0.0065 * alt) / 288.15);
      const mach = altFt >= 28000 ? s.cruise.mach : Math.min(s.cruise.mach, 0.6);
      fm.reset({ x, z, hdg, onGround: false, alt, speed: mach * aSnd, flapIdx: 0, gearDown: false, throttle: 0.7, fuelFrac, payloadFrac });
      this.ap.sel.alt = altFt; this.ap.sel.mach = mach; this.ap.sel.useMach = altFt >= 28000;
      this.ap.sel.spd = Math.round(fm.out.ias);
      this.ap.sel.hdg = Math.round(wrap360(hdg - this.magVar()));
      this.ap.engage(true); this.ap.setAT(true);
      if (this.dest && this.dest !== this.dep) { this.ap.nav = { x: b.c.x, z: b.c.z, name: b.icao }; this.ap.lat = 'NAV'; }
    } else {
      const ap = this.dep;
      const st = ap.stands[Math.floor(ap.stands.length / 2)];
      fm.reset({ x: st.x, z: st.z, hdg: st.hdg, onGround: true, flapIdx: 0, parkBrake: true, fuelFrac, payloadFrac });
      this.stand = st;
    }
    this.fcs.reset();
    if (start !== 'cruise' && start !== 'final') {
      this.ap.sel.hdg = Math.round(this.depEnd ? wrap360(this.depEnd.hdg - this.magVar()) : this.hdgMag());
      this.ap.sel.alt = Math.round((this.dep.elev / FT + 5000) / 1000) * 1000;
      this.ap.sel.spd = s.type === 'fighter' ? 300 : 250;
    }
    this.world.env.groundRef = (this.dest || this.dep).elev;
    this.syncModel(0);
  }
  /** Sensible cruise level for a trip distance (metres). */
  cruiseAltitude(D) {
    const nm = D / NM, max = this.spec.cruise.alt;
    if (nm < 60) return 9000;
    if (nm < 120) return 15000;
    if (nm < 220) return 24000;
    if (nm < 320) return Math.min(max, 31000);
    return max;
  }

  // ---------------------------------------------------------------- pilot actions
  setThrottle(v) { this.fm.ctl.throttle = clamp(v, 0, 1); if (this.ap.at) this.ap.setAT(false), this.events.push({ type: 'caution', text: 'AUTOTHROTTLE DISENGAGED' }); }
  flaps(delta) {
    const c = this.fm.ctl, n = this.spec.flaps.length;
    const next = clamp(c.flapIdx + delta, 0, n - 1);
    if (next !== c.flapIdx) { c.flapIdx = next; this.events.push({ type: 'flaps', name: this.spec.flaps[next][0] }); }
  }
  toggleGear() {
    const c = this.fm.ctl;
    if (this.fm.out.wow && c.gearDown) { this.events.push({ type: 'caution', text: 'GEAR LEVER LOCKED ON GROUND' }); return; }
    c.gearDown = !c.gearDown;
    this.events.push({ type: 'gear', down: c.gearDown });
  }
  cycleSpeedbrake() {
    this.speedbrake = this.speedbrake >= 1 ? 0 : this.speedbrake + 0.5;
    this.fm.ctl.spoiler = this.speedbrake;
    this.events.push({ type: 'info', text: `SPEED BRAKE ${this.speedbrake === 0 ? 'RETRACTED' : this.speedbrake === 1 ? 'FULL' : 'HALF'}` });
  }
  toggleEngines() {
    const on = !this.fm.engines.some((e) => e.running);
    for (const e of this.fm.engines) e.setRunning(on);
    this.events.push({ type: 'info', text: on ? 'ENGINE START' : 'ENGINES SHUT DOWN' });
  }
  toggleAP() {
    if (this.ap.on) { this.ap.engage(false); this.events.push({ type: 'apDisconnect' }); return; }
    if (this.fm.out.onGround) { this.events.push({ type: 'caution', text: 'AUTOPILOT NOT AVAILABLE ON GROUND' }); return; }
    if (this.ap.vert === 'ALT' && Math.abs(this.ap.sel.alt - this.fm.out.altFt) < 400) this.ap.sel.alt = Math.round(this.fm.out.altFt / 100) * 100;
    this.ap.engage(true);
  }
  startPushback() {
    if (!this.stand || this.pushback || this.fm.out.gs > 0.5) return false;
    const st = this.stand, d = Math.hypot(st.x - st.lane.x, st.z - st.lane.z);
    this.pushback = { t: 0, dist: d, from: { x: this.fm.pos.x, z: this.fm.pos.z }, hdg: this.fm.out.hdg };
    this.fm.ctl.parkBrake = false;
    return true;
  }

  // ---------------------------------------------------------------- main update
  update(dtReal, input) {
    if (this.paused || this.fm.crashed) { this.syncModel(0); return; }
    const fm = this.fm, c = fm.ctl, o = fm.out;
    this.world.nearGround = o.agl < 120;
    // pilot controls
    if (input) {
      this.pilot.pitch = input.axes.pitch; this.pilot.roll = input.axes.roll; this.pilot.yaw = input.axes.yaw;
      if (input.throttleRate) this.setThrottle(c.throttle + input.throttleRate * 0.33 * dtReal);
      c.reverse = input.reverse && o.wow;
      if (!(this.ap.on && this.ap.lat === 'ROLLOUT' && !input.brake)) c.brake = input.brake;
      if (input.trim) this.fcs.trim = clamp(this.fcs.trim + input.trim * 0.12 * dtReal, -0.9, 0.9);
      // a firm stick input takes over from the autopilot
      if (this.ap.on && (Math.abs(this.pilot.pitch) > 0.6 || Math.abs(this.pilot.roll) > 0.6)) { this.ap.engage(false); this.events.push({ type: 'apDisconnect' }); }
    }
    let dt = Math.min(dtReal, 0.1) * this.timeScale;
    if (this.pushback) { this.runPushback(dt); this.syncModel(dt); return; }
    this.acc += dt;
    let steps = 0;
    while (this.acc >= H && steps < 1200) {
      this.weather.update(H);
      const cmd = this.ap.update(H);
      this.fcs.update(H, this.pilot, cmd);
      fm.step(H);
      this.acc -= H; steps++;
      this.time += H;
      if (fm.events.length) this.handleEvents();
      if (fm.crashed) break;
    }
    // exterior lights follow the phase of flight
    this.lights.beacon = fm.engines.some((e) => e.running);
    const onRunway = o.onGround && this.world.db.surface(fm.pos.x, fm.pos.z)?.type === 'runway';
    this.lights.strobe = !o.onGround || onRunway;
    this.syncModel(dt);
  }

  runPushback(dt) {
    const pb = this.pushback, fm = this.fm;
    pb.t += dt;
    const speed = Math.min(1.6, pb.t * 0.5, Math.max(0.2, (pb.dist - (pb.s || 0)) * 0.6));
    pb.s = Math.min(pb.dist, (pb.s || 0) + speed * dt);
    const h = pb.hdg * DEG;
    fm.pos.x = pb.from.x - Math.sin(h) * pb.s; fm.pos.z = pb.from.z + Math.cos(h) * pb.s;
    fm.vel.set(0, 0, 0); fm.om.set(0, 0, 0);
    fm.out.gs = speed;
    fm.gears.forEach((g) => { g.spin = -speed; });
    if (pb.s >= pb.dist) {
      this.pushback = null;
      fm.ctl.parkBrake = true; fm.out.gs = 0;
      this.events.push({ type: 'pushbackDone' });
    }
  }

  handleEvents() {
    const fm = this.fm, o = fm.out;
    for (const e of fm.events) {
      if (e.type === 'touchdown') {
        const ap = this.world.db.nearest(e.x, e.z);
        const surf = ap ? ap.surface(e.x, e.z) : null;
        const rep = { fpm: Math.round(e.sink / FT * 60), g: 1, kt: Math.round(o.ias), pitch: e.pitch * RAD, roll: e.roll * RAD, onRunway: surf?.type === 'runway', airport: ap, t: this.time };
        if (rep.onRunway) {
          const r = surf.rwy;
          // which end did we land from?
          const end = Math.abs(wrap180(e.track - r.ends[0].hdg)) < 90 ? r.ends[0] : r.ends[1];
          const dx = e.x - end.thr.x, dz = e.z - end.thr.z;
          rep.end = end;
          rep.dist = dx * end.dir.x + dz * end.dir.z;
          rep.offset = dx * -end.dir.z + dz * end.dir.x;
          rep.remaining = end.lda - rep.dist;
        }
        rep.score = this.gradeLanding(rep);
        this.landing = rep;
        this.maxGAfterTd = fm.out.nz;
        this.events.push({ type: 'touchdown', rep });
      } else if (e.type === 'liftoff') this.events.push({ type: 'liftoff' });
      else if (e.type === 'tailstrike') this.events.push({ type: 'warning', text: 'TAIL STRIKE' });
      else if (e.type === 'crash') this.events.push({ type: 'crash', reason: e.reason });
      else if (e.type === 'spoilers') this.events.push({ type: 'info', text: 'GROUND SPOILERS' });
    }
    fm.events.length = 0;
  }
  gradeLanding(r) {
    let s = 100;
    s -= clamp((r.fpm - 180) / 6, 0, 45);
    if (!r.onRunway) return Math.max(5, Math.round(s * 0.3));
    s -= clamp((Math.abs(r.offset) - 2) * 2.2, 0, 25);
    s -= clamp((Math.abs(r.dist - 380) - 220) / 22, 0, 25);
    return Math.max(5, Math.round(s));
  }

  /** ILS deviations for the tuned approach, or null. */
  ils() {
    return this.ap.ils ? ilsDeviation(this.ap.ils, this.fm.pos.x, this.fm.pos.y, this.fm.pos.z) : null;
  }

  syncModel(dt) {
    const fm = this.fm, m = this.model;
    m.group.position.copy(fm.pos);
    m.group.quaternion.copy(fm.quat);
    const cam = this.world.camera;
    let ab = 0, n1 = 0;
    for (const e of fm.engines) { ab = Math.max(ab, e.ab); n1 += e.n1; }
    m.update({
      elev: fm.surf.elev, ail: fm.surf.ail, rud: fm.surf.rud, flap: fm.flap, gear: fm.gear, spoiler: fm.spoiler,
      n1: n1 / fm.engines.length, ab, wheelSpeed: fm.out.onGround ? fm.gears[1].spin || fm.out.gs : 0,
      lights: this.lights, camDist: cam.position.distanceTo(fm.pos),
    }, dt);
  }

  dispose() {
    this.world.scene.remove(this.model.group);
    this.model.dispose();
  }
}
export { H as STEP };
