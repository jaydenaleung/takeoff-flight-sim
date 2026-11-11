// Map projection shared by the bake tools and the simulator: spherical stereographic centred on
// the region, giving world metres (+X east, +Z south).
import { DEG, RAD } from '../core/units.js';

export const LAT0 = 36.1, LON0 = -117.2, R_EARTH = 6371008.8;
const p0 = LAT0 * DEG, l0 = LON0 * DEG;

export function llToWorld(lat, lon) {
  const p = lat * DEG, l = lon * DEG;
  const k = (2 * R_EARTH) / (1 + Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0));
  return {
    x: k * Math.cos(p) * Math.sin(l - l0),
    z: -k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0)),
  };
}
export function worldToLl(x, z) {
  const y = -z;
  const rho = Math.max(Math.hypot(x, y), 1e-9);
  const c = 2 * Math.atan(rho / (2 * R_EARTH));
  const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho);
  const lon = l0 + Math.atan2(x * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c));
  return { lat: lat * RAD, lon: lon * RAD };
}
/** "N37°37.1' W122°22.5'" */
export function formatLatLon(lat, lon) {
  const f = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return `${v >= 0 ? pos : neg}${d}°${m.toFixed(1).padStart(4, '0')}'`;
  };
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}
