// Checks the generated airport layouts: every runway end must be reachable by taxi from a stand.
import { readFileSync } from 'node:fs';
import { AirportDB } from '../src/world/airports.js';

const db = new AirportDB(JSON.parse(readFileSync(new URL('../public/data/airports.json', import.meta.url))));
let fail = 0;
for (const a of db.airports) {
  const st = a.stands[Math.floor(a.stands.length / 2)];
  const out = [];
  for (const e of a.ends) {
    const r = a.routeToRunway(st.x, st.z, e);
    if (!r) { fail++; out.push(`${e.id}: NO ROUTE`); continue; }
    out.push(`${e.id}(${Math.round(e.magHdg)}°) via ${r.names.join(' ') || '-'}${r.crossings.length ? ' x' + r.crossings.join(',') : ''}${r.backtrack.length ? ' bt' + r.backtrack.join(',') : ''} ${Math.round(r.length)}m`);
  }
  const back = a.routeToStand(a.runways[0].c.x, a.runways[0].c.z, st);
  if (!back) fail++;
  // runway numbers must agree with magnetic headings
  for (const e of a.ends) {
    const num = parseInt(e.id, 10) * 10;
    const d = Math.abs(((e.magHdg - num + 540) % 360) - 180);
    if (d > 12) { fail++; out.push(`!! ${e.id} magnetic ${e.magHdg.toFixed(0)}`); }
  }
  console.log(`${a.icao} nodes ${a.nodes.length} stands ${a.stands.length} bridges ${a.bridges.length} r=${Math.round(a.radius)}m | ${out.join(' | ')}`);
}
console.log(fail ? `${fail} problem(s)` : 'All airport layouts OK');
process.exit(fail ? 1 : 0);
