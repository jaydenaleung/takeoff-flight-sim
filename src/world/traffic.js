// AI traffic: arrivals and departures on the active runway of the nearby airport, and
// high-altitude overflights. Kinematic (no flight model), with their own radio calls.
import { AIRCRAFT_BY_ID } from '../aircraft/specs.js';
import { AircraftModel } from '../aircraft/model.js';
import { makeCallsign, runway as RW, wind as WIND, AIRLINES } from '../atc/phraseology.js';
import { KT, FT, NM, DEG, clamp, moveToward } from '../core/units.js';
import * as THREE from 'three';

const TYPES = ['b738', 'a20n', 'b738', 'a20n', 'b789', 'a333', 'b77w', 'a359'];
const _e = new THREE.Euler();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Traffic {
  constructor(world, flight) {
    this.world = world; this.f = flight;
    this.list = [];
    this.arrT = rnd(25, 60); this.depT = rnd(50, 110); this.cruiseT = 5;
    this.atc = null;
  }
  airport() {
    const p = this.f.fm.pos;
    return this.world.db.nearest(p.x, p.z, (a) => !a.military || a === this.f.dep || a === this.f.dest);
  }
  activeEnd(ap) { const w = this.f.weather; return ap.activeEnds(w.windDir, w.windKt)[0]; }

  /** Is the runway occupied, or is someone on final within `finalDist` metres? */
  runwayBusy(rwy, finalDist = 0, departOnly = false) {
    for (const a of this.list) {
      if (!a.end || a.end.rwy !== rwy) continue;
      if (['roll', 'rollout', 'lineup'].includes(a.state)) return { onFinal: false, dist: 0, a };
      if (!departOnly && a.state === 'final' && a.dist < finalDist) return { onFinal: true, dist: a.dist, a };
    }
    return null;
  }
  spawn(kind, ap, end) {
    const spec = AIRCRAFT_BY_ID[TYPES[Math.floor(Math.random() * TYPES.length)]];
    const al = AIRLINES[Math.floor(Math.random() * (AIRLINES.length - 1))];
    const cs = makeCallsign(spec, al.icao, String(Math.floor(rnd(100, 2999))));
    const model = new AircraftModel(spec, { detail: 0 });
    if (this.world.env.envTexture) model.setEnvironment(this.world.env.envTexture, this.world.env.envIntensity);
    const a = { spec, cs, model, kind, end, ap, x: 0, y: 0, z: 0, hdg: 0, pitch: 0, spd: 0, vs: 0, t: 0, gear: 1, flap: 0.6, state: '', dist: 0, alt: 0 };
    if (kind === 'arrival') {
      a.dist = 13 * NM; a.state = 'final'; a.spd = 165 * KT; a.hdg = end.hdg; a.flap = 0.8;
    } else if (kind === 'departure') {
      a.state = 'lineup'; a.hdg = end.hdg; a.s = (end.displaced || 0) + 60; a.flap = 0.3;
    } else {
      // overflight: crosses 20-40 nm from the player at cruise level
      const p = this.f.fm.pos, ang = Math.random() * Math.PI * 2, off = rnd(15, 45) * NM;
      a.hdg = (ang / DEG + 90 + rnd(-25, 25)) % 360;
      const d = 95 * NM;
      a.x = p.x + Math.cos(ang) * off - Math.sin(a.hdg * DEG) * d; a.z = p.z + Math.sin(ang) * off + Math.cos(a.hdg * DEG) * d;
      a.y = (Math.round(rnd(280, 390) / 10) * 1000) * FT; a.spd = 240; a.state = 'cruise'; a.gear = 0; a.flap = 0;
    }
    this.world.scene.add(model.group);
    this.list.push(a);
    return a;
  }
  remove(a) {
    this.world.scene.remove(a.model.group);
    a.model.dispose();
    this.list.splice(this.list.indexOf(a), 1);
  }
  say(a, role, fromTower, parts) {
    if (!this.atc) return;
    const fac = this.atc.fac(a.ap, role);
    if (fromTower) this.atc.chatter(fac.id, fac.name, parts, fac.id);
    else this.atc.chatter(fac.id, a.cs.text, parts, a.cs.code);
  }

  update(dt) {
    if (dt <= 0) return;
    const f = this.f, p = f.fm.pos, out = f.fm.out;
    const ap = this.airport();
    const dAp = ap ? Math.hypot(ap.c.x - p.x, ap.c.z - p.z) : 1e9;
    const local = this.list.filter((a) => a.kind !== 'cruise');
    // ---- spawning
    if (ap && dAp < 45 * NM) {
      const end = this.activeEnd(ap);
      // where is the player relative to this runway?
      const dx = p.x - end.thr.x, dz = p.z - end.thr.z;
      const along = -(dx * end.dir.x + dz * end.dir.z), cross = Math.abs(dx * -end.dir.z + dz * end.dir.x);
      const playerFinal = !out.onGround && along > -500 && along < 9 * NM && cross < 1.5 * NM && out.agl < 1500;
      const surf = out.onGround ? ap.surface(p.x, p.z) : null;
      const playerOnRwy = surf && surf.type === 'runway' && surf.rwy === end.rwy;
      const holdingNear = out.onGround && this.atc && ['holdshort', 'lineup', 'tkof'].includes(this.atc.phase);
      this.arrT -= dt; this.depT -= dt;
      if (this.arrT <= 0) {
        this.arrT = rnd(140, 260);
        if (local.length < 3 && !playerFinal && !playerOnRwy && !this.runwayBusy(end.rwy, 14 * NM) && !(holdingNear && Math.random() < 0.5)) {
          const a = this.spawn('arrival', ap, end);
          this.say(a, 'tower', false, [this.atc ? this.atc.fac(ap, 'tower').name : 'Tower', ', ', a.cs.part, ', ILS ', RW(end.id), '.']);
          a.callT = 6;
        }
      }
      if (this.depT <= 0) {
        this.depT = rnd(150, 300);
        if (local.length < 3 && !playerFinal && !playerOnRwy && !this.runwayBusy(end.rwy, 5 * NM) && !holdingNear) {
          const a = this.spawn('departure', ap, end);
          const w = f.weather, v = this.world.db.magVar(ap.c.x, ap.c.z);
          this.say(a, 'tower', true, [a.cs.part, ', ', WIND(w.windDir - v, Math.round(w.windKt), w.gustKt), ', ', RW(end.id), ', cleared for takeoff.']);
          a.callT = 4; a.readback = ['Cleared for takeoff ', RW(end.id), ', ', a.cs.part, '.'];
        }
      }
    }
    this.cruiseT -= dt;
    if (this.cruiseT <= 0) { this.cruiseT = rnd(60, 150); if (this.list.filter((a) => a.kind === 'cruise').length < 3) this.spawn('cruise'); }

    // ---- motion
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i], e = a.end;
      a.t += dt;
      if (a.callT != null) {
        a.callT -= dt;
        if (a.callT <= 0) {
          a.callT = null;
          if (a.kind === 'arrival') { const w = f.weather, v = this.world.db.magVar(a.ap.c.x, a.ap.c.z); this.say(a, 'tower', true, [a.cs.part, ', ', WIND(w.windDir - v, Math.round(w.windKt), w.gustKt), ', ', RW(e.id), ', cleared to land.']); }
          else if (a.readback) this.say(a, 'tower', false, a.readback);
        }
      }
      if (a.state === 'final') {
        a.spd = moveToward(a.spd, a.dist < 6 * NM ? 140 * KT : 165 * KT, 1.2 * dt);
        a.dist -= a.spd * dt;
        a.x = e.thr.x - e.dir.x * a.dist; a.z = e.thr.z - e.dir.z * a.dist;
        const h = Math.max(0, (a.dist + 305) * Math.tan(3 * DEG));
        a.y = a.ap.elev + a.spec.gear.cgH + h;
        a.vs = -a.spd * Math.tan(3 * DEG); a.pitch = 2.5 * DEG; a.gear = 1;
        if (a.dist <= -250) { a.state = 'rollout'; a.s = (e.displaced || 0) + 250; a.y = a.ap.elev + a.spec.gear.cgH; a.vs = 0; a.pitch = 0; }
      } else if (a.state === 'rollout') {
        a.spd = moveToward(a.spd, 12, 2.1 * dt);
        a.s += a.spd * dt;
        a.x = e.x + e.dir.x * a.s; a.z = e.z + e.dir.z * a.s;
        if (a.spd <= 13 || a.s > e.rwy.length - 200) { a.state = 'vacate'; a.vt = 0; a.side = e.rwy.taxi ? e.rwy.taxi.side * (e.idx === 0 ? 1 : -1) : 1; }
      } else if (a.state === 'vacate') {
        a.vt += dt;
        a.hdg = e.hdg + a.side * Math.min(90, a.vt * 14);
        a.x += Math.sin(a.hdg * DEG) * 10 * dt; a.z -= Math.cos(a.hdg * DEG) * 10 * dt;
        if (a.vt > 26) { this.remove(a); continue; }
      } else if (a.state === 'lineup') {
        a.x = e.x + e.dir.x * a.s; a.z = e.z + e.dir.z * a.s; a.y = a.ap.elev + a.spec.gear.cgH;
        if (a.t > 12) a.state = 'roll';
      } else if (a.state === 'roll') {
        a.spd += 2.3 * dt; a.s += a.spd * dt;
        a.x = e.x + e.dir.x * a.s; a.z = e.z + e.dir.z * a.s;
        if (a.spd > 78) { a.state = 'climb'; a.pitch = 0; }
      } else if (a.state === 'climb') {
        a.pitch = moveToward(a.pitch, 13 * DEG, 3 * DEG * dt);
        a.spd = moveToward(a.spd, 128, 0.9 * dt);
        a.vs = a.spd * Math.sin(a.pitch * 0.8);
        a.x += e.dir.x * a.spd * dt; a.z += e.dir.z * a.spd * dt; a.y += a.vs * dt;
        a.gear = moveToward(a.gear, 0, dt / 8); a.flap = moveToward(a.flap, 0, dt / 40);
        if (a.t > 420 || Math.hypot(a.x - p.x, a.z - p.z) > 70 * NM) { this.remove(a); continue; }
      } else if (a.state === 'cruise') {
        a.x += Math.sin(a.hdg * DEG) * a.spd * dt; a.z -= Math.cos(a.hdg * DEG) * a.spd * dt;
        if (Math.hypot(a.x - p.x, a.z - p.z) > 130 * NM) { this.remove(a); continue; }
      }
      a.alt = a.y;
      const g = a.model.group;
      g.position.set(a.x, a.y, a.z);
      g.quaternion.setFromEuler(_e.set(a.pitch, -a.hdg * DEG, 0, 'YXZ'));
      const camDist = this.world.camera.position.distanceTo(g.position);
      g.visible = camDist < 60000;
      const night = 1 - this.world.env.day;
      a.model.update({ elev: 0, ail: 0, rud: 0, flap: a.flap, gear: a.gear, spoiler: a.state === 'rollout' ? 1 : 0, n1: 60, ab: 0, wheelSpeed: a.y - a.ap?.elev < 10 ? a.spd : 0, lights: { nav: true, beacon: true, strobe: true, landing: a.y < 4000 || night > 0.5 }, camDist }, dt);
    }
  }
  dispose() { while (this.list.length) this.remove(this.list[0]); }
}
export { clamp };
