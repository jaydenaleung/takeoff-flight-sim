// Builds the 3D model for any aircraft spec and animates its moving parts from simulation state.
import * as THREE from 'three';
import { buildAirliner } from './airliner.js';
import { buildFighter } from './fighter.js';
import { deflect } from './loft.js';
import { DEG, clamp } from '../core/units.js';

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

export class AircraftModel {
  constructor(spec, opts = {}) {
    this.spec = spec;
    const m = spec.type === 'fighter' ? buildFighter(spec, opts) : buildAirliner(spec, opts);
    Object.assign(this, m);
    this.fighter = spec.type === 'fighter';
    const pick = (side, name) => side.getObjectByName(name);
    this.parts = {};
    for (const [key, side] of [['R', this.right], ['L', this.left]]) {
      this.parts[key] = {
        flapIn: pick(side, 'flapIn'), flapOut: pick(side, 'flapOut'), aileron: pick(side, 'aileron'),
        spoilerIn: pick(side, 'spoilerIn'), spoilerOut: pick(side, 'spoilerOut'),
        elevator: pick(side, 'elevator'), stab: pick(side, 'stab'), rudder: pick(side, 'rudder'),
      };
    }
    this.rudder = this.group.getObjectByName('rudder');
    this.gearState = 1;
    this.t = 0;
    for (const g of [this.gearNose, ...this.gearMain]) g.userData.rest = g.quaternion.clone();
    this.update({ elev: 0, ail: 0, rud: 0, flap: 0, gear: 1, spoiler: 0, n1: 0, ab: 0, wheelSpeed: 0 }, 0);
  }

  /** Measured overall dimensions (gear down, surfaces neutral): { length, span, height }. */
  measure() {
    this.group.updateMatrixWorld(true);
    _box.makeEmpty();
    this.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); _box.expandByPoint(_v); }
    });
    return {
      length: _box.max.z - _box.min.z, span: _box.max.x - _box.min.x,
      height: _box.max.y + this.spec.gear.cgH, box: _box.clone(),
    };
  }

  /**
   * s: { elev, ail, rud (-1..1), flap, gear, spoiler (0..1), n1 (0..100), ab (0..1),
   *      wheelSpeed (m/s), lights: {nav, beacon, strobe, landing}, camDist }
   */
  update(s, dt) {
    this.t += dt;
    const P = this.parts;
    const fl = s.flap || 0;
    for (const k of ['R', 'L']) {
      const p = P[k], sgn = k === 'R' ? 1 : -1;
      if (p.flapIn) deflect(p.flapIn, fl * 37 * DEG, p.flapIn.userData.chord * 0.55 * fl, p.flapIn.userData.chord * 0.1 * fl);
      if (p.flapOut) {
        if (this.fighter) deflect(p.flapOut, fl * 32 * DEG - sgn * s.ail * 14 * DEG);
        else deflect(p.flapOut, fl * 34 * DEG, p.flapOut.userData.chord * 0.55 * fl, p.flapOut.userData.chord * 0.1 * fl);
      }
      if (p.aileron) deflect(p.aileron, -sgn * s.ail * 24 * DEG + (this.fighter ? 0 : fl * 4 * DEG));
      const roll = clamp(sgn * s.ail, 0, 1) * 0.45;
      const sp = Math.max(s.spoiler || 0, roll);
      if (p.spoilerIn) deflect(p.spoilerIn, -(s.spoiler || 0) * 48 * DEG);
      if (p.spoilerOut) deflect(p.spoilerOut, -sp * 46 * DEG);
      if (p.elevator) deflect(p.elevator, -s.elev * 24 * DEG);
      if (p.stab) p.stab.rotation.x = -(s.elev * 20 - sgn * s.ail * 7) * DEG;
      if (p.rudder && p.rudder !== this.rudder) deflect(p.rudder, sgn * s.rud * 25 * DEG);
    }
    if (this.rudder) {
      const twin = this.fighter && P.R.rudder;
      if (!twin) deflect(this.rudder, s.rud * 26 * DEG);
    }

    // landing gear retraction
    const g = clamp(s.gear ?? 1, 0, 1);
    const r = 1 - g;
    this.gearNose.visible = g > 0.03;
    this.gearNose.quaternion.copy(this.gearNose.userData.rest);
    this.gearNose.rotateX(r * 96 * DEG);
    for (const m of this.gearMain) {
      m.visible = g > 0.03;
      m.quaternion.copy(m.userData.rest);
      const side = m.userData.side;
      if (m.userData.fighter) m.rotateX(-r * 92 * DEG);
      else m.rotateZ(-side * r * (m.userData.inner ? -84 : 84) * DEG);
    }
    // wheels
    const ws = s.wheelSpeed || 0;
    if (ws && dt) {
      for (const grp of [this.gearNose, ...this.gearMain]) {
        for (const w of grp.userData.wheels) w.rotation.x -= (ws / grp.userData.r) * dt;
      }
    }
    // fans
    if (dt) for (const f of this.fans) f.rotation.z -= (0.6 + (s.n1 || 0) * 0.16) * dt;
    // afterburner
    if (this.flames) {
      const ab = s.ab || 0;
      for (const f of this.flames) {
        f.visible = ab > 0.03;
        if (f.visible) {
          const fl2 = 0.9 + 0.2 * Math.sin(this.t * 53) * Math.sin(this.t * 31);
          f.scale.z = (2.5 + 5.5 * ab) * fl2;
          f.material.opacity = 0.55 + 0.45 * ab;
        }
      }
    }
    // lights
    const L = s.lights || {};
    const dist = s.camDist || 50;
    const k = clamp(dist / 120, 1, 60);
    const tt = this.t % 1.2;
    const strobeOn = tt < 0.06 || (tt > 0.18 && tt < 0.24);
    const beaconOn = (this.t % 1.4) < 0.18;
    for (const l of this.lights.nav) { l.visible = L.nav !== false; l.scale.setScalar(l.userData.size * k); }
    for (const l of this.lights.strobe) { l.visible = !!L.strobe && strobeOn; l.scale.setScalar(l.userData.size * k); }
    for (const l of this.lights.beacon) { l.visible = L.beacon !== false && beaconOn; l.scale.setScalar(l.userData.size * k); }
    for (const l of this.lights.landing) { l.visible = !!L.landing && g > 0.9; l.scale.setScalar(l.userData.size * k * 1.3); }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const m of Object.values(this.mats)) { if (m.map && m !== this.mats.fan) m.map.dispose(); m.dispose(); }
  }
}
