// Aerodynamic model: coefficients derived from real geometry (area, span, sweep, aspect ratio)
// plus a small set of per-type tuning values in the spec.
import { DEG, clamp, smoothstep, KT } from '../core/units.js';
import { deriveGeometry } from '../aircraft/specs.js';
import { RHO0 } from './atmosphere.js';

const sig = (x) => 1 / (1 + Math.exp(-x));

export function deriveAero(spec) {
  const geo = deriveGeometry(spec);
  const fighter = spec.type === 'fighter';
  const a = spec.aero;
  const S = spec.wing.area, b = spec.dims.span, c = geo.mac, AR = geo.ar;
  const tanHalf = geo.tanLE - (geo.cr - geo.ct) / (2 * geo.semi);
  const vortex = fighter ? 1.12 : 1.0;
  /** Lift-curve slope (per rad) - Helmbold/DATCOM with Prandtl-Glauert compressibility. */
  const cla = (M) => {
    const Ms = Math.min(M, 0.86);
    const beta2 = 1 - Ms * Ms;
    let v = (2 * Math.PI * AR) / (2 + Math.sqrt(4 + ((AR * AR * beta2) / 0.9025) * (1 + (tanHalf * tanHalf) / beta2)));
    if (M > 1.0) v /= 1 + 0.4 * (M - 1.0);
    return v * vortex;
  };
  const cla0 = cla(0.2);
  const alphaStall = fighter ? a.alphaStall * DEG : (a.clMaxClean - a.cl0) / cla0;
  const P = {
    spec, geo, fighter, S, b, c, AR,
    k: 1 / (Math.PI * a.e * AR),
    cl0: a.cl0, cla, cla0,
    alphaStall,
    dAlphaSlat: fighter ? 0 : 3.5 * DEG,
    dAlphaFlap: fighter ? 0 : -3.9 * DEG,
    // flap lift increment chosen so that full flap reproduces the published landing CLmax
    dCLf: fighter ? 0.45 : Math.max(0.5, a.clMaxLand - a.clMaxClean - 0.12 * cla0 * alphaStall + 1.12 * cla0 * 0.4 * DEG),
    flapExp: fighter ? 0.74 : 0.54,
    stallSharp: fighter ? 22 : 40,
    cd0: a.cd0, mcrit: a.mcrit, superCd: a.superCd || 2.2,
    cdGear: fighter ? 0.012 : 0.018,
    cdFlap: fighter ? 0.03 : 0.075,
    cdSpoiler: fighter ? 0.05 : 0.035,
    clSpoiler: fighter ? 0.02 : 0.22,
    // pitch
    cm0: fighter ? 0.0 : 0.04,
    cmA: fighter ? -0.28 : -1.0,
    cmQ: fighter ? -6 : -22,
    cmCtl: fighter ? 0.55 : 0.62,
    cmFlap: fighter ? -0.03 : -0.14,
    // roll
    clB: fighter ? -0.05 : -0.085,
    clP: fighter ? -0.3 : -0.45,
    clR: fighter ? 0.07 : 0.12,
    clCtl: fighter ? 0.05 : 0.046,
    // yaw
    cnB: fighter ? 0.13 : 0.17,
    cnP: -0.03,
    cnR: fighter ? -0.22 : -0.27,
    cnCtl: fighter ? 0.04 : 0.05,
    cnAil: -0.004,
    cyB: fighter ? -0.8 : -0.9,
    cyCtl: 0.15,
    qRudRef: 0.5 * RHO0 * ((fighter ? 260 : 165) * KT) ** 2,
  };
  return P;
}

/** Stall angle (rad) for a flap setting and Mach number. */
export function stallAlpha(P, flap, M) {
  let aS = P.alphaStall + (flap > 0.02 ? P.dAlphaSlat * Math.min(1, flap / 0.1) : 0) + P.dAlphaFlap * flap;
  if (!P.fighter) aS *= 1 - 0.42 * clamp((M - 0.5) / 0.4, 0, 1);   // high-speed buffet boundary
  else aS *= 1 - 0.3 * clamp((M - 0.8) / 0.8, 0, 1);
  return aS;
}

/** Lift increment at zero angle of attack for a flap fraction. */
export function flapLift(P, flap) {
  return flap > 0 ? P.dCLf * Math.pow(flap, P.flapExp) : 0;
}

/** Maximum lift coefficient for a flap fraction (low speed). */
export function clMax(P, flap) {
  const aS = stallAlpha(P, flap, 0.2);
  return P.cl0 + flapLift(P, flap) + P.cla0 * (1 + 0.12 * flap * (P.fighter ? 0 : 1)) * aS;
}

/**
 * Reference speeds (m/s CAS at sea level density) for a mass and flap fraction.
 * Airliners use stall-speed multiples; fighters use fixed rotation / approach angles of attack.
 */
export function vSpeeds(P, mass, flapTO, flapLdg) {
  const W = mass * 9.80665;
  const vs = (cl) => Math.sqrt((2 * W) / (RHO0 * P.S * cl));
  const vsTO = vs(clMax(P, flapTO));
  const vsLdg = vs(clMax(P, flapLdg));
  const vsClean = vs(clMax(P, 0));
  if (P.fighter) {
    const clAt = (flap, aDeg) => P.cl0 + flapLift(P, flap) + P.cla0 * aDeg * DEG;
    const vLof = vs(clAt(flapTO, 12.5));
    const vApp = vs(clAt(flapLdg, 11));
    return { vs: vsLdg, vsClean, v1: vLof * 0.88, vr: vLof * 0.9, v2: vLof * 1.08, vref: vApp, vapp: vApp + 3 * KT, vsTO };
  }
  const vr = 1.09 * vsTO;
  return { vs: vsLdg, vsClean, vsTO, v1: vr - 5 * KT, vr, v2: Math.max(1.18 * vsTO, vr + 8 * KT), vref: 1.23 * vsLdg, vapp: 1.23 * vsLdg + 5 * KT };
}

const o = { CL: 0, CD: 0, CY: 0, Cl: 0, Cm: 0, Cn: 0, aS: 0, sigma: 0 };

/**
 * Evaluate all six coefficients.
 * s: { alpha, beta, M, pHat, qHat, rHat, elev, ail, rud, flap, gear, spoiler, ge, qbar }
 * Control deflections are normalised -1..1 (elev + = nose up, ail + = roll right, rud + = nose right).
 */
export function aeroCoeffs(P, s) {
  const { alpha, beta, M } = s;
  const cla = P.cla(M);
  const aS = stallAlpha(P, s.flap, M);
  const fowler = P.fighter ? 0 : s.flap;
  const dCL0 = flapLift(P, s.flap);
  const aZero = -(P.cl0 + dCL0) / cla;
  const aN = aZero - 0.8 * (aS - aZero) * (P.fighter ? 1 : 0.75);
  const clLin = P.cl0 + dCL0 + cla * (1 + 0.12 * fowler) * alpha;
  const sigma = clamp(sig(P.stallSharp * (alpha - aS)) + sig(P.stallSharp * (aN - alpha)), 0, 1);
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const clFlat = 1.15 * 2 * sa * ca + dCL0 * 0.45 * ca;
  let CL = (1 - sigma) * clLin + sigma * clFlat;
  CL -= P.clSpoiler * s.spoiler * (1 + 2.2 * (s.groundSpoiler || 0));
  CL *= 1 + 0.08 * s.ge;

  // --- drag
  let cd0 = P.cd0;
  if (P.fighter) {
    cd0 *= 1 + (P.superCd - 1) * smoothstep(P.mcrit, 1.08, M);
    if (M > 1.2) cd0 *= 1 - 0.07 * Math.min(M - 1.2, 1.2);
  } else if (M > P.mcrit) {
    const d = M - P.mcrit;
    cd0 += 20 * d * d * d * d + (d > 0.09 ? 1.6 * (d - 0.09) * (d - 0.09) : 0);
  }
  cd0 += P.cdFlap * Math.pow(s.flap, 1.5) + (s.flap > 0.02 ? 0.004 : 0) + P.cdGear * s.gear + P.cdSpoiler * s.spoiler * (1 + (s.groundSpoiler || 0));
  let k = P.k * (1 - 0.45 * s.ge);
  if (M > 1) k *= 1 + 0.9 * (M - 1);
  const cdAttached = cd0 + k * clLin * clLin;
  const cdSeparated = cd0 + 2 * sa * sa + 0.04;
  const CD = (1 - sigma) * cdAttached + sigma * cdSeparated + 0.6 * beta * beta;

  // --- side force and moments
  const rudEff = Math.min(1, P.qRudRef / Math.max(s.qbar, 1));
  const ailEff = (1 - 0.55 * sigma) * (P.fighter ? 1 : Math.min(1, (P.qRudRef * 3.2) / Math.max(s.qbar, 1)));
  o.CL = CL;
  o.CD = CD;
  o.CY = P.cyB * beta - P.cyCtl * s.rud * rudEff;
  o.Cm = P.cm0 + P.cmA * (alpha - aZero * 0.0) + P.cmQ * s.qHat + P.cmCtl * s.elev + P.cmFlap * s.flap
    - sigma * 0.22 * Math.sign(alpha) * (P.fighter ? 0.3 : 1);
  o.Cl = P.clB * beta + P.clP * s.pHat + P.clR * s.rHat + P.clCtl * s.ail * ailEff + sigma * (s.asym || 0) * 0.012;
  o.Cn = P.cnB * beta + P.cnP * s.pHat + P.cnR * s.rHat + P.cnCtl * s.rud * rudEff + P.cnAil * s.ail;
  o.aS = aS;
  o.sigma = sigma;
  return o;
}
