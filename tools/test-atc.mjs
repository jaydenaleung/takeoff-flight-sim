// End-to-end ATC test: a robot pilot flies a complete IFR flight (gate to gate) using only the
// radio options a player has, and the autopilot. Verifies the controller logic never dead-ends.
//   node tools/test-atc.mjs [aircraft] [DEP] [DEST] [-v]
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AirportDB } from '../src/world/airports.js';
import { AIRCRAFT_BY_ID } from '../src/aircraft/specs.js';
import { Flight } from '../src/flight.js';
import { ATC } from '../src/atc/atc.js';
import { makeCallsign } from '../src/atc/phraseology.js';
import { settings } from '../src/core/settings.js';
import { KT, FT, NM, DEG, RAD, clamp, wrap180, wrap360 } from '../src/core/units.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const verbose = process.argv.includes('-v');
const [acId = 'b738', depId = 'KSFO', destId = 'KLAX'] = args;
settings.autoTune = true; settings.damage = true; settings.aiAtc = false;

const db = new AirportDB(JSON.parse(readFileSync(new URL('../public/data/airports.json', import.meta.url))));
const g = { h: 0, water: false, paved: true };
const world = {
  db, scene: new THREE.Scene(), camera: { position: new THREE.Vector3() }, env: { groundRef: 0, hour: 10, day: 1 }, nearGround: true,
  elevation(x, z) { const ap = db.nearest(x, z); return Math.hypot(ap.c.x - x, ap.c.z - z) < ap.radius + 4000 ? ap.elev : 0; },
  ground(x, z) { g.h = world.elevation(x, z); g.paved = !!db.surface(x, z); return g; },
};
const spec = AIRCRAFT_BY_ID[acId];
const flight = new Flight(world, { spec, dep: db.byIcao[depId], dest: db.byIcao[destId], start: 'gate', weather: 'scattered', fuel: 0.5, payload: 0.7 });
flight.weather.turb = 0.05;
const atc = new ATC(flight, world, { voice: null, callsign: makeCallsign(spec, 'UAL', '241'), traffic: null });
const fm = flight.fm, ap = flight.ap;
const input = { axes: { pitch: 0, roll: 0, yaw: 0 }, throttleRate: 0, brake: 0, reverse: false, trim: 0 };
atc.onLog = (e) => { if (verbose || e.kind !== 'info') console.log(`  [${String(Math.floor(atc.t / 60)).padStart(3)}:${String(Math.floor(atc.t % 60)).padStart(2, '0')}] ${e.from ? e.from + ': ' : ''}${e.text}`); };

let radioT = 5, wp = 0, route = null, atHold = false, mode = 'gate', flapT = 0, swapped = false, exitPath = null, lastPhase = '';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function follow(pts, dt, vMax = 9) {
  const p = { x: fm.pos.x, z: fm.pos.z }, o = fm.out;
  while (wp < pts.length - 1 && dist(p, pts[wp]) < 30) wp++;
  const t = pts[wp], last = wp === pts.length - 1;
  const err = wrap180(Math.atan2(t.x - p.x, -(t.z - p.z)) * RAD - o.hdg);
  input.axes.yaw = clamp(err / 22, -1, 1);
  const d = dist(p, t);
  let v = Math.abs(err) > 20 ? 3.5 : vMax;
  if (last) v = Math.min(v, Math.max(0, (d - 4) / 7));
  fm.ctl.parkBrake = false;
  fm.ctl.throttle = clamp(0.1 + (v - o.gs) * 0.09, 0, 0.5);
  input.brake = o.gs > v + 1.2 ? 0.6 : 0;
  if (last && d < 8) { fm.ctl.throttle = 0; input.brake = 1; return true; }
  return false;
}

function robot(dt) {
  const o = fm.out, ph = atc.phase;
  input.axes.pitch = 0; input.axes.roll = 0; input.axes.yaw = 0; input.brake = 0;
  if (ph !== lastPhase) { if (verbose) console.log(`      -- phase ${lastPhase} -> ${ph}  alt ${Math.round(o.altFt)} ias ${Math.round(o.ias)}`); lastPhase = ph; }
  // ---- radio
  if (!swapped && atc.t > 4) { atc.swap(); swapped = true; }
  radioT -= dt;
  if (radioT <= 0) {
    radioT = 2.5;
    const opts = atc.getOptions(), pick = (re) => opts.find((x) => re.test(x.label));
    let op = pick(/^Read back/);
    if (!op) {
      if (ph === 'pre') op = pick(/Request IFR clearance/);
      else if (ph === 'cleared') op = pick(/Request pushback/) || pick(/^Request taxi/);
      else if (ph === 'pushed') op = pick(/^Request taxi/);
      else if (ph === 'holdshort' && atHold) op = pick(/Ready for departure/);
      else if (['airborne', 'handoff_center', 'handoff_app'].includes(ph)) op = pick(/^Check in/);
      else if (ph === 'final') op = pick(/Report on final/);
      else if (ph === 'vacated') op = pick(/Clear of runway/);
      if (op) radioT = 9;
    }
    if (op) op.run();
  }
  // ---- ground: taxi out
  if (['taxi', 'holdshort'].includes(ph) && flight.taxiRoute && !atHold) {
    if (route !== flight.taxiRoute) { route = flight.taxiRoute; wp = 1; }
    if (follow(route.pts, dt) && o.gs < 0.4) atHold = true;
  } else if (ph === 'holdshort' || ph === 'lineup' || ph === 'tkof') {
    const e = atc.depEnd;
    const dx = fm.pos.x - e.x, dz = fm.pos.z - e.z;
    const along = dx * e.dir.x + dz * e.dir.z, cross = dx * -e.dir.z + dz * e.dir.x;
    const hErr = wrap180(e.hdg - o.hdg);
    if (ph === 'holdshort') { fm.ctl.throttle = 0; input.brake = 1; }
    else if (mode === 'gate') {
      // enter the runway and line up
      const aim = { x: e.x + e.dir.x * (Math.max(along, 0) + 110), z: e.z + e.dir.z * (Math.max(along, 0) + 110) };
      const err = wrap180(Math.atan2(aim.x - fm.pos.x, -(aim.z - fm.pos.z)) * RAD - o.hdg);
      input.axes.yaw = clamp(err / 20, -1, 1);
      const lined = Math.abs(cross) < 4 && Math.abs(hErr) < 4;
      fm.ctl.parkBrake = false;
      fm.ctl.throttle = lined ? 0 : clamp(0.1 + (5 - o.gs) * 0.09, 0, 0.45);
      input.brake = lined ? 1 : 0;
      fm.ctl.flapIdx = spec.toFlap;
      if (lined && ph === 'tkof' && o.gs < 1.5) { mode = 'roll'; fm.ctl.spoilerArmed = false; }
    }
    if (mode === 'roll') {
      const vs = fm.vspeeds();
      fm.ctl.throttle = 1;
      input.axes.yaw = clamp(-cross * 0.03 + hErr / 8, -1, 1);
      if (o.cas >= vs.vr) input.axes.pitch = clamp(((spec.type === 'fighter' ? 12 : 8.5) * DEG - o.pitch) * 6, -0.5, 0.8);
      if (!o.onGround) mode = 'climb';
    }
  }
  if (mode === 'climb') {
    input.axes.pitch = clamp(((spec.type === 'fighter' ? 12 : 15) * DEG - o.pitch) * 6, -0.5, 0.8);
    if (o.agl > 15) fm.ctl.gearDown = false;
    if (o.agl > 150) {
      if (atc.assigned.hdg == null) ap.sel.hdg = Math.round(wrap360(atc.depEnd.hdg - flight.magVar()));
      ap.lat = 'HDG';
      ap.sel.spd = 210; ap.engage(true); ap.setAT(true); mode = 'auto';
    }
  }
  if (mode === 'auto' && !o.onGround) {
    // clean up, then manage speed like a crew would; speed brake when high and fast
    flapT -= dt;
    fm.ctl.spoiler = o.vs < -2 && o.ias > (ap.sel.useMach ? 400 : ap.sel.spd) + 12 && ap.vert !== 'GS' ? 1 : 0;
    const arriving = ['approach', 'cleared_app', 'final', 'cleared_land', 'handoff_app'].includes(ph);
    if (!arriving) {
      if (o.agl > 400 && fm.ctl.flapIdx > 0 && flapT <= 0) { fm.ctl.flapIdx--; flapT = 9; }
      if (fm.ctl.flapIdx === 0 && atc.assigned.spd == null) {
        if (o.altFt < 10000) ap.sel.spd = 250, ap.sel.useMach = false;
        else if (o.altFt < 27000) ap.sel.spd = spec.type === 'fighter' ? 330 : 295, ap.sel.useMach = false;
        else { ap.sel.useMach = true; ap.sel.mach = spec.cruise.mach; }
      } else if (fm.ctl.flapIdx > 0) ap.sel.spd = 215;
    } else {
      const vs = fm.vspeeds();
      ap.sel.useMach = false;
      if (ph === 'handoff_app' || ph === 'approach') { if (atc.assigned.spd == null) ap.sel.spd = Math.min(ap.sel.spd, 240); if (o.ias < 232 && fm.ctl.flapIdx < 1) fm.ctl.flapIdx = 1; }
      if (ph === 'cleared_app' || ph === 'final' || ph === 'cleared_land') {
        if (!ap.armed.loc && ap.lat !== 'LOC' && ap.ils) ap.armApproach();
        if (ap.vert !== 'GS' && ap.vert !== 'FLARE') { ap.sel.spd = Math.min(ap.sel.spd, 180); if (o.ias < 200) fm.ctl.flapIdx = Math.max(fm.ctl.flapIdx, Math.max(1, spec.ldgFlap - 2)); }
        else { fm.ctl.gearDown = true; if (o.ias < spec.limits.vfe) fm.ctl.flapIdx = spec.ldgFlap; ap.sel.spd = Math.round(vs.vapp / KT); fm.ctl.spoilerArmed = true; ap.autobrake = true; }
      }
    }
  }
  // ---- after landing
  if (o.onGround && ['cleared_land', 'final', 'rollout', 'vacated', 'taxi_in', 'cleared_app'].includes(ph) && mode !== 'roll') {
    mode = 'ground';
    fm.ctl.flapIdx = 0; fm.ctl.spoilerArmed = false;
    if (ph === 'taxi_in' && flight.taxiRoute) {
      if (route !== flight.taxiRoute) { route = flight.taxiRoute; wp = 1; }
      follow(route.pts, dt);
    } else if (!ap.on) {
      if (o.gs > 9) { fm.ctl.throttle = 0; input.brake = 0.7; }
      else {
        if (!exitPath) {
          const e = atc.arrEnd, r = e.rwy;
          const s = (fm.pos.x - e.x) * e.dir.x + (fm.pos.z - e.z) * e.dir.z;
          const cands = (r.connectors || []).map((c) => ({ c, s: (c.a.x - e.x) * e.dir.x + (c.a.z - e.z) * e.dir.z })).filter((c) => c.s > s + 60).sort((a, b) => a.s - b.s);
          const cn = cands.length ? cands[0].c : (r.connectors || [])[e.idx === 0 ? (r.connectors.length - 1) : 0];
          exitPath = cn ? [{ x: fm.pos.x, z: fm.pos.z }, cn.a, cn.b] : [{ x: fm.pos.x, z: fm.pos.z }, { x: fm.pos.x + e.dir.z * 200, z: fm.pos.z - e.dir.x * 200 }];
          wp = 1;
        }
        follow(exitPath, dt, 7);
      }
    }
  }
}

const DT = 0.1;
let t = 0, ok = false, minAgl = 1e9;
const maxT = 3 * 3600;
while (t < maxT) {
  robot(DT);
  flight.update(DT, input);
  for (const e of flight.events) {
    atc.flightEvent(e);
    if (e.type === 'touchdown') console.log(`      ** touchdown ${e.rep.fpm} fpm at ${e.rep.airport.icao} ${e.rep.end ? e.rep.end.id : 'off runway'} ${e.rep.end ? Math.round(e.rep.dist) + ' m past threshold, ' + e.rep.offset.toFixed(1) + ' m off centreline' : ''} score ${e.rep.score}`);
    if (e.type === 'crash') console.log(`      ** CRASH: ${e.reason}`);
    if (e.type === 'parked') ok = true;
  }
  flight.events.length = 0;
  atc.update(DT);
  t += DT;
  if (fm.crashed || ok) break;
  if (verbose && Math.round(t * 10) % 1200 === 0) console.log(`      .. t=${Math.round(t / 60)} min phase ${atc.phase} alt ${Math.round(fm.out.altFt)} ias ${Math.round(fm.out.ias)} hdg ${Math.round(flight.hdgMag())} AP ${ap.on ? ap.fma.lat + '/' + ap.fma.vert : 'off'} dist ${(Math.hypot(fm.pos.x - atc.dest.c.x, fm.pos.z - atc.dest.c.z) / NM).toFixed(0)} NM fuel ${Math.round(fm.fuel)}`);
}
console.log(ok ? `\nATC flight ${depId} -> ${destId} in the ${spec.name} completed in ${Math.round(t / 60)} min (sim time)` : `\nFAILED: ended in phase "${atc.phase}" after ${Math.round(t / 60)} min${fm.crashed ? ' — ' + fm.crashed.reason : ''}`);
process.exit(ok ? 0 : 1);
