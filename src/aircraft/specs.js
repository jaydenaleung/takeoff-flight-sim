// Real-world specifications for every flyable aircraft.
// Lengths in metres, masses in kg, thrust in newtons, angles in degrees unless noted.
// These numbers drive both the 3D model builder (so models are to scale) and the flight model.
import { KT, FT, DEG, G } from '../core/units.js';
import { RHO0 } from '../physics/atmosphere.js';

const kN = 1000;
// Thrust-specific fuel consumption: lb/(lbf*h) -> kg/(N*s)
const tsfc = (lbPerLbfHr) => (lbPerLbfHr * 0.45359237) / (4.4482216 * 3600);

const BOEING_737_FLAPS = [['UP', 0], ['1', 0.1], ['2', 0.15], ['5', 0.25], ['10', 0.35], ['15', 0.45], ['25', 0.6], ['30', 0.75], ['40', 1]];
const BOEING_WIDE_FLAPS = [['UP', 0], ['1', 0.1], ['5', 0.25], ['15', 0.45], ['20', 0.6], ['25', 0.8], ['30', 1]];
const AIRBUS_FLAPS = [['0', 0], ['1', 0.25], ['2', 0.45], ['3', 0.7], ['FULL', 1]];
const FIGHTER_FLAPS = [['UP', 0], ['HALF', 0.5], ['FULL', 1]];

export const AIRCRAFT = [
  {
    id: 'b738', name: 'Boeing 737-800', maker: 'Boeing', type: 'airliner', icao: 'B738',
    role: 'Narrow-body twinjet', spoken: 'Boeing seven thirty seven', wake: 'M',
    dims: { length: 39.47, span: 35.79, height: 12.55, fuseW: 3.76, fuseH: 4.01 },
    wing: { area: 124.6, sweep: 25.02, taper: 0.2, dihedral: 6, tip: 'blended', tipH: 2.5 },
    tail: { hSpan: 14.35, hArea: 32.8, vArea: 26.4 },
    mass: { oew: 41413, mtow: 79016, mlw: 66361, fuel: 20894, payload: 20500 },
    eng: {
      count: 2, model: 'CFM56-7B26', thrust: 117 * kN, kind: 'hbpr', tsfc: tsfc(0.38),
      fan: 1.55, nacD: 2.1, nacL: 4.2, span: [4.83], reverse: true,
    },
    aero: { cd0: 0.019, e: 0.8, cl0: 0.25, clMaxClean: 1.41, clMaxLand: 2.57, mcrit: 0.775 },
    flaps: BOEING_737_FLAPS, toFlap: 3, ldgFlap: 7,
    limits: { vmo: 340, mmo: 0.82, vle: 270, vfe: 250, gPos: 2.5, gNeg: -1, ceiling: 41000 },
    ctl: { law: 'conventional', rollRate: 22, pitchRate: 6 },
    gear: { noseX: 4.0, wheelbase: 15.6, track: 5.72, cgH: 3.2, mainWheels: 2, noseWheels: 2, wheelD: 1.13, bogies: 2 },
    cruise: { mach: 0.785, alt: 37000, climb: 280 },
    eye: { x: -0.5, y: 0.95, z: 2.6 },   // pilot eye: left of centreline, above centreline, aft of nose
  },
  {
    id: 'b748', name: 'Boeing 747-8', maker: 'Boeing', type: 'airliner', icao: 'B748',
    role: 'Four-engine wide-body', spoken: 'Boeing seven forty seven', wake: 'H',
    dims: { length: 76.25, span: 68.45, height: 19.35, fuseW: 6.5, fuseH: 6.5, hump: { from: 0.03, to: 0.44, h: 2.55 } },
    wing: { area: 554, sweep: 37.5, taper: 0.24, dihedral: 7, tip: 'raked', tipH: 0 },
    tail: { hSpan: 22.17, hArea: 136.6, vArea: 77.1 },
    mass: { oew: 220128, mtow: 447696, mlw: 312072, fuel: 193280, payload: 60000 },
    eng: {
      count: 4, model: 'GEnx-2B67', thrust: 296 * kN, kind: 'hbpr', tsfc: tsfc(0.275),
      fan: 2.66, nacD: 3.25, nacL: 6.1, span: [11.9, 21.2], reverse: true,
    },
    aero: { cd0: 0.0148, e: 0.8, cl0: 0.24, clMaxClean: 1.45, clMaxLand: 2.25, mcrit: 0.84 },
    flaps: BOEING_WIDE_FLAPS, toFlap: 4, ldgFlap: 6,
    limits: { vmo: 365, mmo: 0.9, vle: 270, vfe: 285, gPos: 2.5, gNeg: -1, ceiling: 43100 },
    ctl: { law: 'conventional', rollRate: 15, pitchRate: 5 },
    gear: { noseX: 7.9, wheelbase: 29.67, track: 11.0, cgH: 5.35, mainWheels: 4, noseWheels: 2, wheelD: 1.32, bogies: 4 },
    cruise: { mach: 0.855, alt: 35000, climb: 300 },
    eye: { x: -0.55, y: 4.25, z: 7.4 },
  },
  {
    id: 'b77w', name: 'Boeing 777-300ER', maker: 'Boeing', type: 'airliner', icao: 'B77W',
    role: 'Long-range wide-body twinjet', spoken: 'Boeing triple seven', wake: 'H',
    dims: { length: 73.86, span: 64.8, height: 18.5, fuseW: 6.2, fuseH: 6.2 },
    wing: { area: 436.8, sweep: 31.64, taper: 0.15, dihedral: 6, tip: 'raked', tipH: 0 },
    tail: { hSpan: 21.53, hArea: 101.3, vArea: 53.2 },
    mass: { oew: 167829, mtow: 351533, mlw: 251290, fuel: 145538, payload: 55000 },
    eng: {
      count: 2, model: 'GE90-115B', thrust: 513 * kN, kind: 'hbpr', tsfc: tsfc(0.325),
      fan: 3.25, nacD: 3.94, nacL: 7.3, span: [9.6], reverse: true,
    },
    aero: { cd0: 0.0145, e: 0.8, cl0: 0.24, clMaxClean: 1.45, clMaxLand: 2.4, mcrit: 0.83 },
    flaps: BOEING_WIDE_FLAPS, toFlap: 3, ldgFlap: 6,
    limits: { vmo: 330, mmo: 0.89, vle: 270, vfe: 255, gPos: 2.5, gNeg: -1, ceiling: 43100 },
    ctl: { law: 'fbw', rollRate: 15, pitchRate: 5, alphaProt: true, bankLimit: null },
    gear: { noseX: 5.9, wheelbase: 31.22, track: 10.97, cgH: 5.6, mainWheels: 6, noseWheels: 2, wheelD: 1.34, bogies: 2 },
    cruise: { mach: 0.84, alt: 35000, climb: 310 },
    eye: { x: -0.53, y: 1.55, z: 4.4 },
  },
  {
    id: 'b789', name: 'Boeing 787-9 Dreamliner', maker: 'Boeing', type: 'airliner', icao: 'B789',
    role: 'Composite wide-body twinjet', spoken: 'Boeing seven eighty seven', wake: 'H',
    dims: { length: 62.81, span: 60.12, height: 17.02, fuseW: 5.77, fuseH: 5.94 },
    wing: { area: 360.5, sweep: 32.2, taper: 0.16, dihedral: 7.5, tip: 'raked', tipH: 0 },
    tail: { hSpan: 19.81, hArea: 77.3, vArea: 39.6 },
    mass: { oew: 128850, mtow: 254011, mlw: 192777, fuel: 101456, payload: 40000 },
    eng: {
      count: 2, model: 'GEnx-1B74', thrust: 320 * kN, kind: 'hbpr', tsfc: tsfc(0.27),
      fan: 2.82, nacD: 3.45, nacL: 5.4, span: [9.85], reverse: true,
    },
    aero: { cd0: 0.0132, e: 0.83, cl0: 0.24, clMaxClean: 1.45, clMaxLand: 2.3, mcrit: 0.845 },
    flaps: BOEING_WIDE_FLAPS, toFlap: 2, ldgFlap: 6,
    limits: { vmo: 350, mmo: 0.9, vle: 270, vfe: 260, gPos: 2.5, gNeg: -1, ceiling: 43100 },
    ctl: { law: 'fbw', rollRate: 15, pitchRate: 5, alphaProt: true, bankLimit: null },
    gear: { noseX: 5.1, wheelbase: 25.83, track: 9.8, cgH: 4.9, mainWheels: 4, noseWheels: 2, wheelD: 1.27, bogies: 2 },
    cruise: { mach: 0.85, alt: 39000, climb: 310 },
    eye: { x: -0.53, y: 1.35, z: 3.6 },
  },
  {
    id: 'a20n', name: 'Airbus A320neo', maker: 'Airbus', type: 'airliner', icao: 'A20N',
    role: 'Narrow-body twinjet', spoken: 'Airbus A three twenty', wake: 'M',
    dims: { length: 37.57, span: 35.8, height: 11.76, fuseW: 3.95, fuseH: 4.14 },
    wing: { area: 122.6, sweep: 25, taper: 0.22, dihedral: 5.1, tip: 'sharklet', tipH: 2.43 },
    tail: { hSpan: 12.45, hArea: 31, vArea: 21.5 },
    mass: { oew: 44300, mtow: 79000, mlw: 67400, fuel: 18990, payload: 19000 },
    eng: {
      count: 2, model: 'CFM LEAP-1A26', thrust: 120.6 * kN, kind: 'hbpr', tsfc: tsfc(0.285),
      fan: 1.98, nacD: 2.5, nacL: 4.5, span: [5.75], reverse: true,
    },
    aero: { cd0: 0.0185, e: 0.8, cl0: 0.25, clMaxClean: 1.45, clMaxLand: 2.65, mcrit: 0.775 },
    flaps: AIRBUS_FLAPS, toFlap: 1, ldgFlap: 4,
    limits: { vmo: 350, mmo: 0.82, vle: 280, vfe: 230, gPos: 2.5, gNeg: -1, ceiling: 39800 },
    ctl: { law: 'fbw', rollRate: 15, pitchRate: 5, alphaProt: true, bankLimit: 67, pitchLimit: [-15, 30] },
    gear: { noseX: 5.07, wheelbase: 12.64, track: 7.59, cgH: 3.85, mainWheels: 2, noseWheels: 2, wheelD: 1.17, bogies: 2 },
    cruise: { mach: 0.78, alt: 37000, climb: 290 },
    eye: { x: -0.53, y: 1.05, z: 2.5 },
  },
  {
    id: 'a333', name: 'Airbus A330-300', maker: 'Airbus', type: 'airliner', icao: 'A333',
    role: 'Wide-body twinjet', spoken: 'Airbus A three thirty', wake: 'H',
    dims: { length: 63.66, span: 60.3, height: 16.79, fuseW: 5.64, fuseH: 5.64 },
    wing: { area: 361.6, sweep: 30, taper: 0.2, dihedral: 5, tip: 'blended', tipH: 2.0 },
    tail: { hSpan: 19.4, hArea: 71.45, vArea: 45.2 },
    mass: { oew: 129400, mtow: 242000, mlw: 187000, fuel: 109186, payload: 42000 },
    eng: {
      count: 2, model: 'RR Trent 772B', thrust: 316 * kN, kind: 'hbpr', tsfc: tsfc(0.33),
      fan: 2.47, nacD: 3.1, nacL: 6.1, span: [9.37], reverse: true,
    },
    aero: { cd0: 0.0148, e: 0.81, cl0: 0.25, clMaxClean: 1.45, clMaxLand: 2.55, mcrit: 0.8 },
    flaps: AIRBUS_FLAPS, toFlap: 1, ldgFlap: 4,
    limits: { vmo: 330, mmo: 0.86, vle: 250, vfe: 240, gPos: 2.5, gNeg: -1, ceiling: 41450 },
    ctl: { law: 'fbw', rollRate: 15, pitchRate: 5, alphaProt: true, bankLimit: 67, pitchLimit: [-15, 30] },
    gear: { noseX: 6.67, wheelbase: 25.37, track: 10.68, cgH: 4.85, mainWheels: 4, noseWheels: 2, wheelD: 1.4, bogies: 2 },
    cruise: { mach: 0.82, alt: 37000, climb: 300 },
    eye: { x: -0.53, y: 1.4, z: 3.3 },
  },
  {
    id: 'a359', name: 'Airbus A350-900', maker: 'Airbus', type: 'airliner', icao: 'A359',
    role: 'Composite wide-body twinjet', spoken: 'Airbus A three fifty', wake: 'H',
    dims: { length: 66.8, span: 64.75, height: 17.05, fuseW: 5.96, fuseH: 6.09 },
    wing: { area: 442, sweep: 31.9, taper: 0.17, dihedral: 6.5, tip: 'curved', tipH: 2.4 },
    tail: { hSpan: 18.73, hArea: 82.7, vArea: 51 },
    mass: { oew: 142400, mtow: 280000, mlw: 205000, fuel: 110523, payload: 45000 },
    eng: {
      count: 2, model: 'RR Trent XWB-84', thrust: 374.5 * kN, kind: 'hbpr', tsfc: tsfc(0.265),
      fan: 3.0, nacD: 3.75, nacL: 6.2, span: [10.5], reverse: true,
    },
    aero: { cd0: 0.0132, e: 0.83, cl0: 0.25, clMaxClean: 1.45, clMaxLand: 2.3, mcrit: 0.84 },
    flaps: AIRBUS_FLAPS, toFlap: 1, ldgFlap: 4,
    limits: { vmo: 340, mmo: 0.89, vle: 250, vfe: 255, gPos: 2.5, gNeg: -1, ceiling: 43100 },
    ctl: { law: 'fbw', rollRate: 15, pitchRate: 5, alphaProt: true, bankLimit: 67, pitchLimit: [-15, 30] },
    gear: { noseX: 4.96, wheelbase: 28.66, track: 10.6, cgH: 5.25, mainWheels: 4, noseWheels: 2, wheelD: 1.4, bogies: 2 },
    cruise: { mach: 0.85, alt: 39000, climb: 310 },
    eye: { x: -0.53, y: 1.3, z: 3.4 },
  },
  {
    id: 'a388', name: 'Airbus A380-800', maker: 'Airbus', type: 'airliner', icao: 'A388',
    role: 'Double-deck four-engine wide-body', spoken: 'Airbus A three eighty', wake: 'J',
    dims: { length: 72.72, span: 79.75, height: 24.09, fuseW: 7.14, fuseH: 8.41 },
    wing: { area: 845, sweep: 33.5, taper: 0.21, dihedral: 5.6, tip: 'fence', tipH: 2.3 },
    tail: { hSpan: 30.37, hArea: 205, vArea: 122 },
    mass: { oew: 277000, mtow: 575000, mlw: 394000, fuel: 253983, payload: 70000 },
    eng: {
      count: 4, model: 'RR Trent 970', thrust: 332 * kN, kind: 'hbpr', tsfc: tsfc(0.3),
      fan: 2.95, nacD: 3.6, nacL: 6.2, span: [14.75, 25.7], reverse: true,
    },
    aero: { cd0: 0.0135, e: 0.85, cl0: 0.25, clMaxClean: 1.45, clMaxLand: 2.25, mcrit: 0.835 },
    flaps: AIRBUS_FLAPS, toFlap: 1, ldgFlap: 4,
    limits: { vmo: 340, mmo: 0.89, vle: 250, vfe: 263, gPos: 2.5, gNeg: -1, ceiling: 43000 },
    ctl: { law: 'fbw', rollRate: 12, pitchRate: 4, alphaProt: true, bankLimit: 67, pitchLimit: [-15, 30] },
    gear: { noseX: 5.0, wheelbase: 30.4, track: 12.46, cgH: 6.15, mainWheels: 5, noseWheels: 2, wheelD: 1.4, bogies: 4 },
    cruise: { mach: 0.85, alt: 37000, climb: 310 },
    eye: { x: -0.6, y: 1.9, z: 4.2 },
  },
  {
    id: 'f16', name: 'F-16C Fighting Falcon', maker: 'Lockheed Martin', type: 'fighter', icao: 'F16',
    role: 'Single-engine multirole fighter', spoken: 'F sixteen', wake: 'L',
    dims: { length: 15.06, span: 9.96, height: 4.88, fuseW: 1.6, fuseH: 1.7 },
    wing: { area: 27.87, sweep: 30, leSweep: 40, taper: 0.21, dihedral: 0, tip: 'rail', tipH: 0 },
    tail: { hSpan: 5.58, hArea: 5.9, vArea: 5.1 },
    mass: { oew: 8573, mtow: 19187, mlw: 12000, fuel: 3175, payload: 600 },
    eng: {
      count: 1, model: 'F110-GE-129', thrust: 76.3 * kN, abThrust: 131 * kN, kind: 'lbpr',
      tsfc: tsfc(0.76), tsfcAB: tsfc(1.9), ram: 0.12, span: [0], reverse: false,
    },
    aero: { cd0: 0.0195, e: 0.85, cl0: 0.05, clMaxClean: 1.6, clMaxLand: 1.9, mcrit: 0.9, superCd: 2.3, alphaStall: 27 },
    flaps: FIGHTER_FLAPS, toFlap: 1, ldgFlap: 2,
    limits: { vmo: 800, mmo: 2.05, vle: 300, vfe: 300, gPos: 9, gNeg: -3, ceiling: 50000 },
    ctl: { law: 'fighter', rollRate: 270, pitchRate: 28, alphaMax: 25 },
    gear: { noseX: 4.4, wheelbase: 4.0, track: 2.36, cgH: 1.75, mainWheels: 1, noseWheels: 1, wheelD: 0.7, bogies: 2 },
    cruise: { mach: 0.85, alt: 30000, climb: 400 },
    eye: { x: 0, y: 0.95, z: 3.9 },
  },
  {
    id: 'f18', name: 'F/A-18E Super Hornet', maker: 'Boeing', type: 'fighter', icao: 'F18S',
    role: 'Twin-engine carrier strike fighter', spoken: 'Super Hornet', wake: 'L',
    dims: { length: 18.31, span: 13.62, height: 4.88, fuseW: 2.5, fuseH: 1.75 },
    wing: { area: 46.5, sweep: 20, leSweep: 29, taper: 0.35, dihedral: -3, tip: 'rail', tipH: 0 },
    tail: { hSpan: 7.0, hArea: 9.3, vArea: 10.0 },
    mass: { oew: 14552, mtow: 29937, mlw: 20000, fuel: 6780, payload: 700 },
    eng: {
      count: 2, model: 'F414-GE-400', thrust: 58 * kN, abThrust: 98 * kN, kind: 'lbpr',
      tsfc: tsfc(0.84), tsfcAB: tsfc(1.85), ram: 0.1, span: [0.55], reverse: false,
    },
    aero: { cd0: 0.022, e: 0.85, cl0: 0.06, clMaxClean: 1.8, clMaxLand: 2.1, mcrit: 0.88, superCd: 2.4, alphaStall: 34 },
    flaps: FIGHTER_FLAPS, toFlap: 1, ldgFlap: 2,
    limits: { vmo: 750, mmo: 1.8, vle: 250, vfe: 250, gPos: 7.5, gNeg: -3, ceiling: 50000 },
    ctl: { law: 'fighter', rollRate: 220, pitchRate: 26, alphaMax: 32 },
    gear: { noseX: 5.2, wheelbase: 5.42, track: 3.11, cgH: 2.0, mainWheels: 1, noseWheels: 2, wheelD: 0.76, bogies: 2 },
    cruise: { mach: 0.85, alt: 30000, climb: 380 },
    eye: { x: 0, y: 1.05, z: 4.4 },
  },
  {
    id: 'f22', name: 'F-22A Raptor', maker: 'Lockheed Martin', type: 'fighter', icao: 'F22',
    role: 'Twin-engine stealth air-superiority fighter', spoken: 'Raptor', wake: 'L',
    dims: { length: 18.92, span: 13.56, height: 5.08, fuseW: 3.9, fuseH: 1.75 },
    wing: { area: 78.04, sweep: 28, leSweep: 42, taper: 0.169, dihedral: -3.25, tip: 'clipped', tipH: 0 },
    tail: { hSpan: 8.84, hArea: 12.6, vArea: 16.5 },
    mass: { oew: 19700, mtow: 38000, mlw: 27000, fuel: 8200, payload: 900 },
    eng: {
      count: 2, model: 'F119-PW-100', thrust: 116 * kN, abThrust: 156 * kN, kind: 'lbpr',
      tsfc: tsfc(0.8), tsfcAB: tsfc(1.9), ram: 0.3, span: [0.75], reverse: false,
    },
    aero: { cd0: 0.0165, e: 0.85, cl0: 0.04, clMaxClean: 1.75, clMaxLand: 2.0, mcrit: 0.92, superCd: 1.85, alphaStall: 36 },
    flaps: FIGHTER_FLAPS, toFlap: 1, ldgFlap: 2,
    limits: { vmo: 800, mmo: 2.25, vle: 250, vfe: 250, gPos: 9, gNeg: -3, ceiling: 65000 },
    ctl: { law: 'fighter', rollRate: 240, pitchRate: 30, alphaMax: 32 },
    gear: { noseX: 5.0, wheelbase: 6.04, track: 3.23, cgH: 1.9, mainWheels: 1, noseWheels: 1, wheelD: 0.8, bogies: 2 },
    cruise: { mach: 0.9, alt: 40000, climb: 420 },
    eye: { x: 0, y: 1.05, z: 4.3 },
  },
  {
    id: 'f35', name: 'F-35A Lightning II', maker: 'Lockheed Martin', type: 'fighter', icao: 'F35',
    role: 'Single-engine stealth multirole fighter', spoken: 'Lightning', wake: 'L',
    dims: { length: 15.67, span: 10.7, height: 4.38, fuseW: 3.3, fuseH: 1.9 },
    wing: { area: 42.7, sweep: 23, leSweep: 35, taper: 0.25, dihedral: -4, tip: 'clipped', tipH: 0 },
    tail: { hSpan: 6.9, hArea: 9.0, vArea: 8.6 },
    mass: { oew: 13290, mtow: 31751, mlw: 21000, fuel: 8278, payload: 700 },
    eng: {
      count: 1, model: 'F135-PW-100', thrust: 125 * kN, abThrust: 191 * kN, kind: 'lbpr',
      tsfc: tsfc(0.7), tsfcAB: tsfc(1.95), ram: 0.2, span: [0], reverse: false,
    },
    aero: { cd0: 0.02, e: 0.85, cl0: 0.05, clMaxClean: 1.7, clMaxLand: 2.0, mcrit: 0.9, superCd: 2.3, alphaStall: 34 },
    flaps: FIGHTER_FLAPS, toFlap: 1, ldgFlap: 2,
    limits: { vmo: 700, mmo: 1.6, vle: 300, vfe: 300, gPos: 9, gNeg: -3, ceiling: 50000 },
    ctl: { law: 'fighter', rollRate: 220, pitchRate: 26, alphaMax: 30 },
    gear: { noseX: 4.5, wheelbase: 4.7, track: 3.7, cgH: 1.9, mainWheels: 1, noseWheels: 1, wheelD: 0.78, bogies: 2 },
    cruise: { mach: 0.85, alt: 35000, climb: 400 },
    eye: { x: 0, y: 1.0, z: 3.7 },
  },
];

export const AIRCRAFT_BY_ID = Object.fromEntries(AIRCRAFT.map((a) => [a.id, a]));

/**
 * Geometry derived from a spec, shared by the model builder and the flight model so that the
 * visible aircraft and the simulated one are the same shape.
 * All positions are in the body frame: origin at the centre of gravity on the fuselage
 * centreline, +X right, +Y up, -Z forward.
 */
export function deriveGeometry(spec) {
  const { dims, wing, gear, eng } = spec;
  const fighter = spec.type === 'fighter';
  const noseLoad = fighter ? 0.12 : 0.08;
  // Distance from the nose to the CG.
  const cgX = gear.noseX + gear.wheelbase * (1 - noseLoad);
  const b = wing.tip === 'blended' || wing.tip === 'sharklet' || wing.tip === 'curved'
    ? dims.span - 0.5 : dims.span;          // planform span without the tip device overhang
  const semi = b / 2;
  const cr = (2 * wing.area) / (b * (1 + wing.taper));   // trapezoid root chord at centreline
  const ct = cr * wing.taper;
  const mac = (2 / 3) * cr * (1 + wing.taper + wing.taper ** 2) / (1 + wing.taper);
  const yMac = (semi / 3) * (1 + 2 * wing.taper) / (1 + wing.taper);
  const ar = (dims.span * dims.span) / wing.area;
  const tanQC = Math.tan(wing.sweep * DEG);
  // Leading-edge sweep from the quarter-chord sweep of a tapered wing.
  const tanLE = wing.leSweep != null
    ? Math.tan(wing.leSweep * DEG)
    : tanQC + (cr - ct) / (4 * semi);
  // Place the wing so that the quarter-MAC point sits just behind the CG (positive static margin).
  const sm = fighter ? 0.04 : 0.12;
  const xQcMac = cgX + sm * mac;                 // distance from nose
  const xLeRoot = xQcMac - 0.25 * mac - yMac * tanLE;   // LE at centreline, from nose
  const wingY = fighter ? (spec.id === 'f18' || spec.id === 'f22' || spec.id === 'f35' ? 0.25 : 0.05) * dims.fuseH
    : -0.3 * dims.fuseH;                          // low wing for airliners, shoulder/mid for fighters
  const dih = Math.tan(wing.dihedral * DEG);

  /** Leading-edge point of the wing at spanwise station y (0..semi), body frame. */
  const le = (y) => ({ x: y, y: wingY + Math.abs(y) * dih, z: xLeRoot + Math.abs(y) * tanLE - cgX });
  const chord = (y) => cr + (ct - cr) * (Math.abs(y) / semi);

  // Engine mounts.
  const engines = [];
  if (fighter) {
    const zNoz = dims.length - cgX - 0.4;
    for (const s of eng.span) {
      if (s === 0) engines.push({ x: 0, y: 0, z: zNoz });
      else { engines.push({ x: -s, y: 0, z: zNoz }); engines.push({ x: s, y: 0, z: zNoz }); }
    }
  } else {
    const side = [];
    for (const s of eng.span) {
      const l = le(s);
      // Nacelle hangs below and ahead of the wing, never closer than 0.5 m to the ground.
      const y = Math.max(l.y - eng.nacD * (eng.drop ?? 0.56), -(gear.cgH - eng.nacD / 2 - 0.5));
      const z = l.z - eng.nacL * 0.62 + 0.25 * chord(s) * 0.1;
      side.push({ x: s, y, z, zFront: z - eng.nacL * 0.5 });
    }
    for (const m of side.slice().reverse()) engines.push({ ...m, x: -m.x });
    for (const m of side) engines.push(m);
  }

  const gearNose = { x: 0, y: -gear.cgH, z: gear.noseX - cgX };
  const gearMainZ = gear.noseX + gear.wheelbase - cgX;
  const gearMain = [
    { x: -gear.track / 2, y: -gear.cgH, z: gearMainZ },
    { x: gear.track / 2, y: -gear.cgH, z: gearMainZ },
  ];
  const rFuse = dims.fuseH / 2;
  // Points that must never touch the ground.
  const tipY = le(semi).y;
  const probes = [
    { name: 'nose', x: 0, y: -rFuse * 0.6, z: -cgX + 1.0 },
    { name: 'tail', x: 0, y: -rFuse * (fighter ? 0.5 : 0.25), z: dims.length - cgX - (fighter ? 1.0 : dims.length * 0.1) },
    { name: 'left wing', x: -dims.span / 2, y: tipY, z: le(semi).z + ct * 0.5 },
    { name: 'right wing', x: dims.span / 2, y: tipY, z: le(semi).z + ct * 0.5 },
    { name: 'belly', x: 0, y: -rFuse, z: 0 },
  ];
  if (!fighter) {
    for (const m of engines) probes.push({ name: 'engine', x: m.x, y: m.y - eng.nacD / 2, z: m.z });
  }
  return {
    cgX, semi, b, cr, ct, mac, yMac, ar, tanLE, xLeRoot, wingY, dih, le, chord,
    engines, gearNose, gearMain, probes, noseLoad,
    tailArm: dims.length * (fighter ? 0.36 : 0.47),
  };
}

/** Default loaded mass for a flight: empty + payload + given fuel fraction. */
export function loadedMass(spec, fuelFrac = 0.5, payloadFrac = 0.7) {
  return spec.mass.oew + spec.mass.payload * payloadFrac + spec.mass.fuel * fuelFrac;
}

export { KT, FT, G, RHO0 };
