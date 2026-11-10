// International Standard Atmosphere, air-data conversions and the weather model.
import { clamp, DEG, KT, rng } from '../core/units.js';

const T0 = 288.15, P0 = 101325, R_AIR = 287.05287, GAMMA = 1.4, LAPSE = 0.0065, G0 = 9.80665;
export const A0 = Math.sqrt(GAMMA * R_AIR * T0);   // 340.294 m/s
export const RHO0 = P0 / (R_AIR * T0);             // 1.225 kg/m^3

const out = { T: T0, p: P0, rho: RHO0, a: A0 };

/**
 * ISA state at geometric altitude h (m), with a temperature offset dT (K).
 * Returns a shared object - copy the fields you need.
 */
export function isa(h, dT = 0) {
  h = clamp(h, -600, 32000);
  let T, p;
  if (h <= 11000) {
    T = T0 - LAPSE * h;
    p = P0 * Math.pow(T / T0, G0 / (LAPSE * R_AIR));
  } else {
    T = 216.65;
    p = 22632.06 * Math.exp((-G0 * (h - 11000)) / (R_AIR * T));
    if (h > 20000) {
      const T2 = 216.65 + 0.001 * (h - 20000);
      p = 5474.889 * Math.pow(T2 / 216.65, -G0 / (0.001 * R_AIR));
      T = T2;
    }
  }
  T += dT;
  out.T = T; out.p = p; out.rho = p / (R_AIR * T); out.a = Math.sqrt(GAMMA * R_AIR * T);
  return out;
}

/** Calibrated airspeed (m/s) from Mach and static pressure. */
export function casFromMach(M, p) {
  const qc = p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
/** Mach number from calibrated airspeed (m/s) and static pressure. */
export function machFromCas(cas, p) {
  const qc = P0 * (Math.pow(1 + 0.2 * (cas / A0) ** 2, 3.5) - 1);
  return Math.sqrt(5 * (Math.pow(qc / p + 1, 2 / 7) - 1));
}
/** Pressure altitude (m) for an altimeter setting qnh (Pa) at true altitude h. */
export function indicatedAltitude(h, qnh = P0) {
  // 1 hPa ~ 8.23 m near sea level; adequate for the altimeter subscale.
  return h + (P0 - qnh) * 0.0823;
}

export const WEATHER_PRESETS = {
  clear:     { name: 'Clear skies',        windDir: 280, windKt: 6,  gustKt: 0,  vis: 80000, cover: 0.05, base: 2400, top: 3000, turb: 0.05, dT: 3, qnh: 30.05 },
  scattered: { name: 'Scattered clouds',   windDir: 270, windKt: 11, gustKt: 0,  vis: 50000, cover: 0.40, base: 1500, top: 2500, turb: 0.15, dT: 0, qnh: 29.98 },
  overcast:  { name: 'Overcast',           windDir: 240, windKt: 14, gustKt: 20, vis: 20000, cover: 0.92, base: 900,  top: 2400, turb: 0.25, dT: -2, qnh: 29.85 },
  lowvis:    { name: 'Low visibility (IFR)', windDir: 200, windKt: 5, gustKt: 0, vis: 1800,  cover: 1.0,  base: 120,  top: 900,  turb: 0.08, dT: -4, qnh: 29.92 },
  crosswind: { name: 'Strong crosswind',   windDir: 350, windKt: 24, gustKt: 34, vis: 40000, cover: 0.30, base: 1800, top: 2700, turb: 0.45, dT: 1, qnh: 29.74 },
  storm:     { name: 'Stormy',             windDir: 220, windKt: 30, gustKt: 45, vis: 6000,  cover: 0.97, base: 500,  top: 4500, turb: 0.8,  dT: -3, qnh: 29.52 },
};

/** Wind, gusts and turbulence. Directions are *true* degrees the wind blows FROM. */
export class Weather {
  constructor(preset = 'clear') {
    this.rand = rng(12345);
    this.set(preset);
    this.t = 0;
    this.gust = [0, 0, 0];      // filtered turbulence velocity (m/s), world axes
    this.gustFactor = 0;        // slow 0..1 gust envelope
    this._w = [0, 0, 0];
  }
  set(preset) {
    const p = typeof preset === 'string' ? WEATHER_PRESETS[preset] : preset;
    Object.assign(this, JSON.parse(JSON.stringify(p)));
    this.presetKey = typeof preset === 'string' ? preset : 'custom';
  }
  /** Advance the stochastic part. */
  update(dt) {
    this.t += dt;
    const r = this.rand;
    const tau = 2.5;
    const k = dt / tau;
    const s = this.turb * 2.2 * Math.sqrt(2 * dt / tau);
    for (let i = 0; i < 3; i++) {
      const n = (r() + r() + r() + r() - 2) * 1.732;
      this.gust[i] += -this.gust[i] * k + s * n * (i === 1 ? 0.6 : 1);
    }
    const target = 0.5 + 0.5 * Math.sin(this.t * 0.21) * Math.sin(this.t * 0.063 + 1.3);
    this.gustFactor += (target - this.gustFactor) * Math.min(1, dt * 0.8);
  }
  /**
   * Wind velocity vector (m/s, world axes: +X east, +Z south) at height above ground `agl`
   * and altitude `alt`. Writes into and returns an internal array.
   */
  windAt(alt, agl) {
    // Surface boundary layer, then strengthening and veering toward the jet level.
    const surf = this.windKt + Math.max(0, this.gustKt - this.windKt) * this.gustFactor;
    // Power-law boundary layer, normalised so the reported (10 m) wind is windKt.
    const bl = Math.pow(clamp(agl, 2, 600) / 10, 0.14);
    const aloft = clamp((alt - 600) / 9400, 0, 1);
    const spd = (surf * bl + aloft * (28 + this.windKt * 1.6)) * KT;
    const dir = (this.windDir + aloft * 25) * DEG;
    // Blowing FROM dir: velocity points the opposite way. North is -Z.
    const turbScale = clamp(1.2 - alt / 14000, 0.25, 1.2) * (agl < 30 ? 0.5 + agl / 60 : 1);
    this._w[0] = -Math.sin(dir) * spd + this.gust[0] * turbScale;
    this._w[1] = this.gust[1] * turbScale * clamp(agl / 30, 0, 1);
    this._w[2] = Math.cos(dir) * spd + this.gust[2] * turbScale;
    return this._w;
  }
  /** Steady surface wind for ATIS / tower: {dir (true deg), kt, gust}. */
  surfaceWind() {
    return { dir: this.windDir, kt: Math.round(this.windKt), gust: this.gustKt };
  }
}
export { T0, P0 };
