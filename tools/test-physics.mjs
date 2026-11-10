// Headless acceptance tests for the flight model: every aircraft must take off, cruise and
// fly a coupled ILS approach to touchdown within limits. Run with `npm test`.
import { AIRCRAFT } from '../src/aircraft/specs.js';
import { FlightModel } from '../src/physics/flightModel.js';
import { FlightControls } from '../src/systems/fbw.js';
import { Autopilot } from '../src/systems/autopilot.js';
import { Weather } from '../src/physics/atmosphere.js';
import { KT, FT, NM, DEG, RAD, clamp } from '../src/core/units.js';

const DT = 1 / 120;
const only = process.argv[2];
const verbose = process.argv.includes('-v');
let failures = 0;
const fmt = (n, d = 0) => n.toFixed(d).padStart(7);

function mk(spec, wx = 'clear') {
  const weather = new Weather(wx);
  weather.windKt = 0; weather.gustKt = 0; weather.turb = 0; weather.dT = 0;
  const fm = new FlightModel(spec, { weather });
  const fcs = new FlightControls(fm);
  const ap = new Autopilot(fm);
  return { fm, fcs, ap, weather };
}
function check(name, ok, detail) {
  if (!ok) { failures++; console.log(`   FAIL ${name}: ${detail}`); }
  return ok;
}

function takeoff(spec) {
  const { fm, fcs, ap, weather } = mk(spec);
  fm.reset({ x: 0, z: 0, hdg: 0, onGround: true, flapIdx: spec.toFlap, fuelFrac: 0.6, payloadFrac: 0.8, parkBrake: false });
  fcs.reset();
  const vs = fm.vspeeds();
  const inp = { pitch: 0, roll: 0, yaw: 0 };
  let liftoff = null, t = 0, maxPitch = 0, climb30 = 0, tLift = 0, tail = false;
  fm.ctl.throttle = 1;
  while (t < 140) {
    weather.update(DT);
    const o = fm.out;
    // rotate to the lift-off attitude, then pitch for the climb once airborne
    const pitchTarget = (spec.type === 'fighter' ? 12 : (liftoff && o.agl > 3 ? 15 : 8.5)) * DEG;
    if (o.cas >= vs.vr || liftoff) inp.pitch = clamp((pitchTarget - o.pitch) * 6, -0.5, spec.type === 'fighter' ? 0.6 : 0.8);
    inp.yaw = clamp(-fm.pos.x * 0.02 - o.r * 2 + (0 - Math.sin(o.hdg * DEG)) * 3, -1, 1);
    fcs.update(DT, inp, null);
    fm.step(DT);
    t += DT;
    for (const e of fm.events) {
      if (e.type === 'liftoff' && !liftoff) { liftoff = { dist: -fm.pos.z, t, ias: o.ias }; tLift = t; }
      if (e.type === 'tailstrike') tail = true;
    }
    fm.events.length = 0;
    if (liftoff && o.agl > 15) fm.ctl.gearDown = false;
    maxPitch = Math.max(maxPitch, o.pitch);
    if (liftoff && t - tLift > 30) { climb30 = o.vsFpm; break; }
    if (fm.crashed) break;
  }
  const o = fm.out;
  const lim = spec.type === 'fighter' ? 1400 : 3300;
  console.log(`   takeoff  mass ${fmt(fm.mass / 1000, 1)} t  VR ${fmt(vs.vr / KT)} kt  V2 ${fmt(vs.v2 / KT)} kt  lift-off ${liftoff ? fmt(liftoff.dist) : '   --'} m in ${liftoff ? fmt(liftoff.t, 1) : '--'} s at ${liftoff ? fmt(liftoff.ias) : '--'} kt  climb ${fmt(climb30)} fpm  IAS ${fmt(o.ias)}  pitch ${fmt(o.pitch * RAD, 1)}`);
  check('no crash', !fm.crashed, fm.crashed && fm.crashed.reason);
  check('lift-off', liftoff && liftoff.dist < lim, liftoff ? `${liftoff.dist.toFixed(0)} m` : 'never');
  check('climb', climb30 > (spec.type === 'fighter' ? 3000 : 1200), `${climb30.toFixed(0)} fpm`);
  check('no tail strike', !tail, 'tail strike on rotation');
}

function cruise(spec) {
  const { fm, fcs, ap, weather } = mk(spec);
  const alt = spec.cruise.alt * FT, mach = spec.cruise.mach;
  const a = 295 + (alt < 11000 ? (11000 - alt) * 0.004 : 0);
  fm.reset({ x: 0, z: 0, hdg: 90, onGround: false, alt, speed: mach * a, fuelFrac: 0.6, payloadFrac: 0.8, throttle: 0.75 });
  fcs.reset();
  ap.sel.alt = spec.cruise.alt; ap.sel.mach = mach; ap.sel.useMach = true; ap.sel.hdg = 90;
  ap.engage(true); ap.setAT(true);
  const inp = { pitch: 0, roll: 0, yaw: 0 };
  let t = 0, maxAltErr = 0, maxMachErr = 0;
  while (t < 240 && !fm.crashed) {
    weather.update(DT);
    const cmd = ap.update(DT);
    fcs.update(DT, inp, cmd);
    fm.step(DT); fm.events.length = 0;
    t += DT;
    if (t > 120) {
      maxAltErr = Math.max(maxAltErr, Math.abs(fm.out.altFt - spec.cruise.alt));
      maxMachErr = Math.max(maxMachErr, Math.abs(fm.out.mach - mach));
    }
  }
  const o = fm.out;
  const ld = (fm.mass * 9.80665) / Math.max(o.thrust, 1);
  console.log(`   cruise   FL${Math.round(spec.cruise.alt / 100)} M${o.mach.toFixed(3)} alt err ${fmt(maxAltErr)} ft  thr ${fmt(fm.ctl.throttle * 100)} %  N1 ${fmt(o.n1)}  alpha ${fmt(o.alpha * RAD, 1)}  pitch ${fmt(o.pitch * RAD, 1)}  L/D ${fmt(ld, 1)}  FF ${fmt(o.ff * 3600)} kg/h`);
  check('no crash', !fm.crashed, fm.crashed && fm.crashed.reason);
  check('altitude hold', maxAltErr < 120, `${maxAltErr.toFixed(0)} ft`);
  check('mach hold', maxMachErr < 0.02, maxMachErr.toFixed(3));
  check('thrust margin', fm.ctl.throttle < (spec.type === 'fighter' ? 0.86 : 0.97), `${(fm.ctl.throttle * 100).toFixed(0)} %`);
}

function turnAndClimb(spec) {
  const { fm, fcs, ap, weather } = mk(spec);
  fm.reset({ x: 0, z: 0, hdg: 0, onGround: false, alt: 3000 * FT, speed: 250 * KT, fuelFrac: 0.5, payloadFrac: 0.7, throttle: 0.6 });
  fcs.reset();
  ap.sel.alt = 3000; ap.sel.spd = 250; ap.sel.hdg = 0;
  ap.engage(true); ap.setAT(true);
  const inp = { pitch: 0, roll: 0, yaw: 0 };
  let t = 0, maxBeta = 0;
  while (t < 200 && !fm.crashed) {
    weather.update(DT);
    if (t > 10) { ap.sel.hdg = 180; ap.sel.alt = 8000; }
    const cmd = ap.update(DT);
    fcs.update(DT, inp, cmd);
    fm.step(DT); fm.events.length = 0; t += DT;
    if (t > 12) maxBeta = Math.max(maxBeta, Math.abs(fm.out.beta * RAD));
  }
  const o = fm.out;
  console.log(`   manoeuvre hdg ${fmt(o.hdg)}  alt ${fmt(o.altFt)} ft  ias ${fmt(o.ias)} kt  max sideslip ${fmt(maxBeta, 1)} deg`);
  check('no crash', !fm.crashed, fm.crashed && fm.crashed.reason);
  check('heading capture', Math.abs(((o.hdg - 180 + 540) % 360) - 180) < 3, o.hdg.toFixed(1));
  check('altitude capture', Math.abs(o.altFt - 8000) < 150, o.altFt.toFixed(0));
  check('speed hold', Math.abs(o.ias - 250) < 8, o.ias.toFixed(0));
  check('coordination', maxBeta < 3, `${maxBeta.toFixed(1)} deg`);
}

function autoland(spec, wx) {
  const { fm, fcs, ap, weather } = mk(spec);
  if (wx) { weather.windDir = 60; weather.windKt = 15; weather.turb = 0.15; }
  const ils = { x: 0, z: 0, crs: 0, elev: 0, gp: 3, length: 3600, id: '36' };
  const ldgMass = spec.mass.oew + spec.mass.payload * 0.7 + spec.mass.fuel * 0.2;
  fm.payload = spec.mass.payload * 0.7; fm.fuel = spec.mass.fuel * 0.2;
  const vs = fm.vspeeds();
  fm.reset({ x: 600, z: 11 * NM, hdg: 350, onGround: false, alt: 2500 * FT, speed: vs.vapp + 15 * KT, flapIdx: spec.ldgFlap, gearDown: true, throttle: 0.4 });
  fcs.reset();
  ap.setILS(ils);
  ap.sel.alt = 2500; ap.sel.hdg = 350; ap.sel.spd = Math.round(vs.vapp / KT); ap.autobrake = true;
  ap.engage(true); ap.setAT(true); ap.armApproach();
  fm.ctl.spoilerArmed = true;
  const inp = { pitch: 0, roll: 0, yaw: 0 };
  let t = 0, td = null, maxLoc = 0, maxGs = 0;
  while (t < 520 && !fm.crashed) {
    weather.update(DT);
    const cmd = ap.update(DT);
    fcs.update(DT, inp, cmd);
    // after the autopilot lets go, hold the brakes
    if (td && !ap.on) { fm.ctl.brake = 0.5; }
    fm.step(DT); t += DT;
    for (const e of fm.events) if (e.type === 'touchdown' && !td) td = { ...e, t, dist: -fm.pos.z, cross: fm.pos.x, ias: fm.out.ias };
    fm.events.length = 0;
    if (ap.vert === 'GS' && fm.out.ra > 200) { maxLoc = Math.max(maxLoc, Math.abs(ap.dev.loc)); maxGs = Math.max(maxGs, Math.abs(ap.dev.gs)); }
    if (td && fm.out.gs < 1) break;
  }
  const o = fm.out;
  console.log(`   autoland${wx ? ' xw' : '   '} mass ${fmt(ldgMass / 1000, 1)} t  Vapp ${fmt(vs.vapp / KT)} kt  touchdown ${td ? fmt(td.sink / FT * 60) : '   --'} fpm at ${td ? fmt(td.dist) : '--'} m, ${td ? fmt(td.cross, 1) : '--'} m off CL, ${td ? fmt(td.ias) : '--'} kt, pitch ${td ? fmt(td.pitch * RAD, 1) : '--'}  stop ${fmt(-fm.pos.z)} m  loc ${maxLoc.toFixed(2)} gs ${maxGs.toFixed(2)}`);
  check('no crash', !fm.crashed, fm.crashed && fm.crashed.reason);
  check('touchdown', !!td, 'never touched down');
  if (td) {
    check('sink rate', td.sink < 3.3, `${(td.sink / FT * 60).toFixed(0)} fpm`);
    check('touchdown zone', td.dist > 50 && td.dist < 1100, `${td.dist.toFixed(0)} m`);
    check('centreline', Math.abs(td.cross) < (wx ? 12 : 6), `${td.cross.toFixed(1)} m`);
    check('stops on runway', -fm.pos.z < 3600 && o.gs < 1.5 && Math.abs(fm.pos.x) < 25, `${(-fm.pos.z).toFixed(0)} m, x ${fm.pos.x.toFixed(1)}, gs ${o.gs.toFixed(1)}`);
  }
}

function groundHandling(spec) {
  const { fm, fcs } = mk(spec);
  fm.reset({ x: 0, z: 0, hdg: 0, onGround: true, parkBrake: true });
  fcs.reset();
  const inp = { pitch: 0, roll: 0, yaw: 0 };
  let t = 0;
  for (; t < 8; t += DT) { fcs.update(DT, inp, null); fm.step(DT); fm.events.length = 0; }
  const drift = Math.hypot(fm.pos.x, fm.pos.z);
  const restPitch = fm.out.pitch * RAD, restH = fm.pos.y - spec.gear.cgH;
  // taxi: release the brake, a little thrust, then a turn
  fm.ctl.parkBrake = false; fm.ctl.throttle = spec.type === 'fighter' ? 0.25 : 0.3;
  for (t = 0; t < 14; t += DT) { fcs.update(DT, inp, null); fm.step(DT); fm.events.length = 0; }
  const taxiSpd = fm.out.gs / KT;
  fm.ctl.throttle = 0.12; inp.yaw = 1;
  const h0 = fm.out.hdg;
  for (t = 0; t < 10; t += DT) { fcs.update(DT, inp, null); fm.step(DT); fm.events.length = 0; }
  const turned = ((fm.out.hdg - h0 + 540) % 360) - 180;
  inp.yaw = 0; fm.ctl.throttle = 0; fm.ctl.brake = 1;
  for (t = 0; t < 12; t += DT) { fcs.update(DT, inp, null); fm.step(DT); fm.events.length = 0; }
  console.log(`   ground   rest drift ${drift.toFixed(3)} m  pitch ${restPitch.toFixed(2)} deg  height err ${restH.toFixed(2)} m  taxi ${taxiSpd.toFixed(1)} kt  turned ${turned.toFixed(0)} deg in 10 s  stopped gs ${fm.out.gs.toFixed(2)}`);
  check('no crash', !fm.crashed, fm.crashed && fm.crashed.reason);
  check('holds on parking brake', drift < 0.12, `${drift.toFixed(3)} m`);
  check('level at rest', Math.abs(restPitch) < 1.0 && Math.abs(restH) < 0.25, `${restPitch.toFixed(2)} deg, ${restH.toFixed(2)} m`);
  check('taxis', taxiSpd > 3 && taxiSpd < 45, `${taxiSpd.toFixed(1)} kt`);
  check('steers', turned > 15, `${turned.toFixed(0)} deg`);
  check('brakes to a stop', fm.out.gs < 0.3, `${fm.out.gs.toFixed(2)} m/s`);
}

for (const spec of AIRCRAFT) {
  if (only && !only.startsWith('-') && spec.id !== only) continue;
  console.log(`\n${spec.name}`);
  groundHandling(spec);
  takeoff(spec);
  turnAndClimb(spec);
  cruise(spec);
  autoland(spec, false);
  autoland(spec, true);
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll flight-model checks passed');
process.exit(failures ? 1 : 0);
