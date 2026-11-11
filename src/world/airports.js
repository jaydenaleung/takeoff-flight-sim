// Airport database: real runways and frequencies from the baked data, plus a deterministic
// generated ground layout (parallel taxiways, connectors, apron, stands) and a taxi-route graph.
import { DEG, RAD, wrap360, wrap180, clamp, NM } from '../core/units.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PHONETIC = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel',
  I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa',
  Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
  X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const along = (p, u, d) => ({ x: p.x + u.x * d, z: p.z + u.z * d });
function segDist(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
function segSegDist(a, b, c, d) {
  const x = segIntersect(a, b, c, d);
  if (x) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
function segIntersect(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a.x + r.x * t, z: a.z + r.z * t };
}
export const headingOf = (a, b) => wrap360(Math.atan2(b.x - a.x, -(b.z - a.z)) * RAD);
export const dirOf = (hdg) => ({ x: Math.sin(hdg * DEG), z: -Math.cos(hdg * DEG) });

export class Airport {
  constructor(a, db) {
    Object.assign(this, a);
    this.db = db;
    this.runways = a.runways.map((r) => {
      const [e0, e1] = r.ends.map((e) => ({ ...e }));
      const u = { x: (e1.x - e0.x) / r.length, z: (e1.z - e0.z) / r.length };
      const rw = {
        id: r.id, length: r.length, width: r.width, surface: r.surface, ends: [e0, e1], u,
        n: { x: -u.z, z: u.x },
        c: { x: (e0.x + e1.x) / 2, z: (e0.z + e1.z) / 2 },
      };
      e0.rwy = e1.rwy = rw; e0.other = e1; e1.other = e0; e0.idx = 0; e1.idx = 1;
      for (const e of [e0, e1]) {
        e.airport = this;
        e.elev = this.elev;
        e.dir = dirOf(e.hdg);
        e.thr = along(e, e.dir, e.displaced || 0);
        e.lda = r.length - (e.displaced || 0);
        if (e.ils) e.ils = { ...e.ils, x: e.thr.x, z: e.thr.z, crs: e.hdg, elev: this.elev, gp: 3, length: e.lda, id: e.id, icao: this.icao };
      }
      return rw;
    });
    // field centre = mean of the runway centres
    const cx = this.runways.reduce((s, r) => s + r.c.x, 0) / this.runways.length;
    const cz = this.runways.reduce((s, r) => s + r.c.z, 0) / this.runways.length;
    this.c = { x: cx, z: cz };
    this.ends = this.runways.flatMap((r) => r.ends);
    this.big = !this.military && (this.runways.length >= 2 || this.runways[0].length > 3000);
    this.buildLayout();
  }

  end(id) { return this.ends.find((e) => e.id === id); }

  buildLayout() {
    const main = this.runways[0];
    const La = this.big ? 900 : 560, Wa = this.big ? 380 : 260;
    // ---- apron placement: the side of the main runway farthest from every other runway
    let best = null;
    for (const side of [1, -1]) {
      for (const f of [0, -0.16, 0.16, -0.3, 0.3]) {
        const c = along(along(main.c, main.u, f * main.length), main.n, side * (300 + Wa / 2));
        let score = 5000 - Math.abs(f) * 200 - (side < 0 ? 5 : 0);
        for (const r of this.runways) {
          if (r === main) continue;
          score = Math.min(score, segDist(c, r.ends[0], r.ends[1]) - Math.abs(f) * 200);
        }
        if (!best || score > best.score) best = { c, side, f, score };
      }
    }
    const aSide = best.side;
    this.apron = { c: best.c, u: main.u, n: { x: main.n.x * aSide, z: main.n.z * aSide }, hl: La / 2, hw: Wa / 2, hdg: main.ends[0].hdg };

    // ---- taxiways
    const lines = [];       // { a, b, name, type, ts: [] }
    const connectors = [];
    let letter = 0;
    const nextName = () => LETTERS[letter++ % LETTERS.length];
    for (const r of this.runways) lines.push({ a: r.ends[0], b: r.ends[1], name: r.id, type: 'runway', rwy: r, ts: [0, 1] });
    for (const r of this.runways) {
      const toApron = (this.apron.c.x - r.c.x) * r.n.x + (this.apron.c.z - r.c.z) * r.n.z;
      let side = toApron >= 0 ? 1 : -1;
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const a = along(r.ends[0], r.n, side * 180), b = along(r.ends[1], r.n, side * 180);
        ok = this.runways.every((o) => o === r || segSegDist(a, b, o.ends[0], o.ends[1]) > 140 || segIntersect(a, b, o.ends[0], o.ends[1]));
        if (!ok) side = -side;
      }
      r.taxi = null;
      if (!ok) continue;
      const name = nextName();
      const line = { a: along(r.ends[0], r.n, side * 180), b: along(r.ends[1], r.n, side * 180), name, type: 'taxi', ts: [0, 1], rwy: r };
      lines.push(line);
      r.taxi = { line, side, name, width: this.big ? 30 : 23 };
      const nC = Math.max(2, Math.round(r.length / 850) + 1);
      r.connectors = [];
      for (let k = 0; k < nC; k++) {
        const t = k / (nC - 1);
        const p = along(r.ends[0], r.u, t * r.length), q = along(p, r.n, side * 180);
        const cn = { a: p, b: q, name: `${name}${k + 1}`, type: 'taxi', rwy: r, t, hold: along(p, r.n, side * (r.width / 2 + 60)) };
        connectors.push(cn); r.connectors.push(cn);
      }
      r.ends[0].holdConn = r.connectors[0];
      r.ends[1].holdConn = r.connectors[nC - 1];
    }
    // ---- apron lane, stands, link to the main taxiway
    const A = this.apron;
    const laneC = along(A.c, A.n, -A.hw + 70);
    const lane = { a: along(laneC, A.u, -A.hl + 40), b: along(laneC, A.u, A.hl - 40), name: 'Ramp', type: 'apron', ts: [0, 1] };
    lines.push(lane);
    const nSt = Math.max(3, Math.floor((2 * A.hl - 80) / (this.big ? 80 : 70)));
    this.stands = [];
    const standHdg = wrap360(Math.atan2(A.n.x, -A.n.z) * RAD + (this.military ? 180 : 0));
    for (let k = 0; k < nSt; k++) {
      const s = ((k + 0.5) / nSt - 0.5) * (2 * A.hl - 80);
      const lanePt = along(laneC, A.u, s);
      const p = along(lanePt, A.n, this.military ? 55 : 95);
      this.stands.push({ id: `${this.military ? 'Spot ' : 'Gate '}${k + 1}`, x: p.x, z: p.z, hdg: standHdg, lane: lanePt, t: (s + A.hl - 40) / (2 * A.hl - 80) });
      lane.ts.push(clamp((s + A.hl - 40) / (2 * A.hl - 80), 0, 1));
    }
    if (main.taxi) {
      const tl = main.taxi.line;
      const t = clamp(((laneC.x - tl.a.x) * main.u.x + (laneC.z - tl.a.z) * main.u.z) / main.length, 0.03, 0.97);
      const p = along(tl.a, main.u, t * main.length);
      const name = nextName();
      const q = along(p, A.n, dist(p, laneC));
      const tq = clamp(((q.x - lane.a.x) * A.u.x + (q.z - lane.a.z) * A.u.z) / dist(lane.a, lane.b), 0, 1);
      const lq = along(lane.a, A.u, tq * dist(lane.a, lane.b));
      connectors.push({ a: p, b: lq, name, type: 'taxi', link: true });
      tl.ts.push(t); lane.ts.push(tq);
      this.link = { a: p, b: lq, name };
    } else {
      const p = along(main.c, main.u, best.f * main.length);
      connectors.push({ a: p, b: laneC, name: nextName(), type: 'taxi', link: true });
      lines[0].ts.push(0.5 + best.f); lane.ts.push(0.5);
      this.link = { a: p, b: laneC, name: 'A' };
    }
    // ---- intersections between all primary lines
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const x = segIntersect(lines[i].a, lines[i].b, lines[j].a, lines[j].b);
        if (x) { lines[i].ts.push(x.t); lines[j].ts.push(x.u); }
      }
    }
    for (const cn of connectors) {
      if (cn.link) continue;
      for (const l of lines) {
        if (l.rwy !== cn.rwy) {
          // a connector may cross another runway or taxiway
          const x = segIntersect(cn.a, cn.b, l.a, l.b);
          if (x && x.t > 0.02 && x.t < 0.98) l.ts.push(x.u);
          continue;
        }
        l.ts.push(cn.t);
      }
    }
    // ---- graph
    const nodes = [], edges = [], index = new Map();
    const node = (p) => {
      const k = `${Math.round(p.x / 2)}|${Math.round(p.z / 2)}`;
      let n = index.get(k);
      if (!n) { n = { id: nodes.length, x: p.x, z: p.z, e: [] }; nodes.push(n); index.set(k, n); }
      return n;
    };
    const edge = (a, b, name, type, rwy) => {
      if (a === b) return;
      const e = { a, b, name, type, rwy, len: dist(a, b) };
      edges.push(e); a.e.push(e); b.e.push(e);
    };
    for (const l of lines) {
      const ts = [...new Set(l.ts.map((t) => Math.round(clamp(t, 0, 1) * 1e5) / 1e5))].sort((p, q) => p - q);
      const L = dist(l.a, l.b), u = { x: (l.b.x - l.a.x) / L, z: (l.b.z - l.a.z) / L };
      let prev = null;
      for (const t of ts) {
        const n = node(along(l.a, u, t * L));
        if (prev) edge(prev, n, l.name, l.type, l.type === 'runway' ? l.rwy : null);
        prev = n;
      }
    }
    for (const cn of connectors) {
      const na = node(cn.a), nb = node(cn.b);
      edge(na, nb, cn.name, 'taxi', null);
      cn.na = na; cn.nb = nb;
    }
    for (const s of this.stands) { s.node = node(s.lane); }
    // ---- bridge any disconnected parts with a straight taxiway
    const comp = () => {
      nodes.forEach((n) => { n.comp = -1; });
      let c = 0;
      for (const n of nodes) {
        if (n.comp >= 0) continue;
        const st = [n]; n.comp = c;
        while (st.length) { const m = st.pop(); for (const e of m.e) { const o = e.a === m ? e.b : e.a; if (o.comp < 0) { o.comp = c; st.push(o); } } }
        c++;
      }
      return c;
    };
    this.bridges = [];
    for (let guard = 0; guard < 8 && comp() > 1; guard++) {
      let bestPair = null;
      for (const a of nodes) {
        if (a.comp !== 0) continue;
        for (const b of nodes) {
          if (b.comp === 0) continue;
          const d = dist(a, b);
          if (!bestPair || d < bestPair.d) bestPair = { a, b, d };
        }
      }
      if (!bestPair) break;
      const name = nextName();
      edge(bestPair.a, bestPair.b, name, 'taxi', null);
      this.bridges.push({ a: bestPair.a, b: bestPair.b, name });
    }
    this.nodes = nodes; this.edges = edges; this.connectors = connectors; this.lines = lines;
    this.taxiSegments = [
      ...lines.filter((l) => l.type === 'taxi').map((l) => ({ a: l.a, b: l.b, name: l.name, w: this.big ? 30 : 23 })),
      ...connectors.map((c) => ({ a: c.a, b: c.b, name: c.name, w: this.big ? 30 : 23 })),
      ...this.bridges.map((b) => ({ a: b.a, b: b.b, name: b.name, w: this.big ? 30 : 23 })),
    ];
    // ---- buildings
    this.terminal = { c: along(A.c, A.n, A.hw + (this.military ? -A.hw * 2 - 60 : 30)), u: A.u, hl: A.hl * (this.military ? 0.5 : 0.92), hw: this.military ? 30 : 26, h: this.big ? 20 : 12 };
    if (this.military) this.terminal.c = along(A.c, A.n, A.hw + 40);
    this.tower = along(along(A.c, A.u, A.hl + 70), A.n, A.hw * 0.4);
    this.towerH = this.big ? 62 : 36;
    // ---- flattening pads
    const boxes = [];
    for (const r of this.runways) boxes.push({ cx: r.c.x, cz: r.c.z, ux: r.u.x, uz: r.u.z, hl: r.length / 2 + 330, hw: 255 });
    boxes.push({ cx: A.c.x + A.n.x * 30, cz: A.c.z + A.n.z * 30, ux: A.u.x, uz: A.u.z, hl: A.hl + 150, hw: A.hw + 120 });
    for (const s of this.taxiSegments) {
      const L = dist(s.a, s.b);
      if (L < 1) continue;
      boxes.push({ cx: (s.a.x + s.b.x) / 2, cz: (s.a.z + s.b.z) / 2, ux: (s.b.x - s.a.x) / L, uz: (s.b.z - s.a.z) / L, hl: L / 2 + 40, hw: 70 });
    }
    let r = 0;
    for (const b of boxes) r = Math.max(r, Math.hypot(b.cx - this.c.x, b.cz - this.c.z) + Math.hypot(b.hl, b.hw));
    this.radius = r;
    this.pad = { x: this.c.x, z: this.c.z, r: r + 700, elev: this.elev, boxes };
  }

  /** What is under a point: 'runway', 'taxiway', 'apron' or null (grass). Also returns the runway. */
  surface(x, z) {
    const p = { x, z };
    if (Math.hypot(x - this.c.x, z - this.c.z) > this.radius + 100) return null;
    for (const r of this.runways) {
      const lx = (x - r.c.x) * r.u.x + (z - r.c.z) * r.u.z, lz = (x - r.c.x) * r.n.x + (z - r.c.z) * r.n.z;
      if (Math.abs(lx) < r.length / 2 + 60 && Math.abs(lz) < r.width / 2) return { type: 'runway', rwy: r, along: lx, cross: lz };
    }
    const A = this.apron;
    const ax = (x - A.c.x) * A.u.x + (z - A.c.z) * A.u.z, az = (x - A.c.x) * A.n.x + (z - A.c.z) * A.n.z;
    if (Math.abs(ax) < A.hl && Math.abs(az) < A.hw) return { type: 'apron' };
    for (const s of this.taxiSegments) if (segDist(p, s.a, s.b) < s.w / 2 + 2) return { type: 'taxiway', name: s.name };
    return null;
  }
  /** Runway whose protected area (centreline +/- 75 m) contains the point, if any. */
  runwayAt(x, z, margin = 0) {
    for (const r of this.runways) {
      const lx = (x - r.c.x) * r.u.x + (z - r.c.z) * r.u.z, lz = (x - r.c.x) * r.n.x + (z - r.c.z) * r.n.z;
      if (Math.abs(lx) < r.length / 2 + 80 && Math.abs(lz) < r.width / 2 + margin) return r;
    }
    return null;
  }
  nearestNode(x, z, pred) {
    let best = null, bd = 1e9;
    for (const n of this.nodes) {
      if (pred && !pred(n)) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  /** Shortest taxi route between two graph nodes. Returns { pts, names, crossings, length }. */
  route(from, to) {
    const distTo = new Map([[from, 0]]), prev = new Map(), done = new Set();
    const open = [from];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (distTo.get(open[i]) < distTo.get(open[bi])) bi = i;
      const n = open.splice(bi, 1)[0];
      if (n === to) break;
      if (done.has(n)) continue;
      done.add(n);
      for (const e of n.e) {
        const o = e.a === n ? e.b : e.a;
        const d = distTo.get(n) + e.len * (e.type === 'runway' ? 3.5 : 1);
        if (!distTo.has(o) || d < distTo.get(o)) { distTo.set(o, d); prev.set(o, { n, e }); open.push(o); }
      }
    }
    if (!prev.has(to) && from !== to) return null;
    const pts = [to], es = [];
    let cur = to;
    while (cur !== from) { const p = prev.get(cur); es.unshift(p.e); pts.unshift(p.n); cur = p.n; }
    const names = [], crossings = [], backtrack = [];
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.type === 'runway') { if (!backtrack.includes(e.name)) backtrack.push(e.name); continue; }
      if (e.type === 'apron') continue;
      const base = e.name.replace(/\d+$/, '');
      if (names[names.length - 1] !== base) names.push(base);
    }
    // runways crossed: interior path nodes that lie on a runway we do not travel along
    for (let i = 1; i < pts.length - 1; i++) {
      for (const e of pts[i].e) {
        if (e.type === 'runway' && !es.includes(e) && !crossings.includes(e.name) && !backtrack.includes(e.name)) {
          // only a crossing if we arrive and leave on non-runway edges
          if (es[i - 1].type !== 'runway' && es[i].type !== 'runway') crossings.push(e.name);
        }
      }
    }
    return {
      pts: pts.map((p) => ({ x: p.x, z: p.z })), names, crossings, backtrack,
      length: es.reduce((s, e) => s + e.len, 0),
    };
  }
  /** Route from a position to the holding point of a runway end. */
  routeToRunway(x, z, end) {
    const from = this.nearestNode(x, z, (n) => n.e.some((e) => e.type !== 'runway'));
    const hc = end.holdConn;
    let target, hold;
    if (hc) { target = hc.nb; hold = hc.hold; }
    else { target = this.nearestNode(end.x, end.z); hold = { x: end.x, z: end.z }; }
    const r = this.route(from, target);
    if (!r) return null;
    r.pts.unshift({ x, z });
    r.pts.push({ x: hold.x, z: hold.z });
    r.hold = hold;
    return r;
  }
  /** Route from a position (after vacating) to a stand. */
  routeToStand(x, z, stand) {
    const from = this.nearestNode(x, z, (n) => n.e.some((e) => e.type !== 'runway'));
    const r = this.route(from, stand.node);
    if (!r) return null;
    r.pts.unshift({ x, z });
    r.pts.push({ x: stand.x, z: stand.z });
    return r;
  }
  /** Best runway ends for a wind (direction it blows from, grid degrees). Longest usable first. */
  activeEnds(windDir, windKt, minLength = 1800) {
    const scored = this.ends
      .filter((e) => e.rwy.length >= Math.min(minLength, this.runways[0].length - 1))
      .map((e) => {
        const head = Math.cos(wrap180(windDir - e.hdg) * DEG) * windKt;
        return { e, head, score: head * 60 + e.rwy.length * (windKt < 4 ? 1 : 0.25) + (e.ils && !e.ils.synthetic ? 300 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.e);
  }
}

export class AirportDB {
  constructor(json) {
    this.meta = json.meta;
    this.airports = json.airports.map((a) => new Airport(a, this));
    this.byIcao = Object.fromEntries(this.airports.map((a) => [a.icao, a]));
    this.navaids = json.navaids;
    const d = json.meta.declination;
    this.decl = d;
    for (const a of this.airports) {
      a.magVar = this.magVar(a.c.x, a.c.z);
      for (const e of a.ends) e.magHdg = wrap360(e.hdg - a.magVar);
    }
  }
  /** East magnetic declination (degrees) such that magnetic = grid heading - declination. */
  magVar(x, z) {
    const d = this.decl;
    return d.d0 + (d.d1 * x) / 1e5 + (d.d2 * z) / 1e5;
  }
  pads() { return this.airports.map((a) => a.pad); }
  nearest(x, z, pred) {
    let best = null, bd = 1e12;
    for (const a of this.airports) {
      if (pred && !pred(a)) continue;
      const d = Math.hypot(a.c.x - x, a.c.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  /** Surface information at a point, for the flight model. */
  surface(x, z) {
    for (const a of this.airports) {
      if (Math.abs(a.c.x - x) > a.radius + 200 || Math.abs(a.c.z - z) > a.radius + 200) continue;
      const s = a.surface(x, z);
      if (s) { s.airport = a; return s; }
    }
    return null;
  }
}

/** En-route control centre for a position (approximate real ARTCC boundaries). */
export const CENTERS = [
  { name: 'Oakland Center', freq: 132.35 },
  { name: 'Los Angeles Center', freq: 132.6 },
  { name: 'Salt Lake Center', freq: 128.55 },
  { name: 'Albuquerque Center', freq: 128.45 },
];
export function centerFor(x, z) {
  if (x > 300000 && z > 40000) return CENTERS[3];
  if (z < -330000 && x > -150000) return CENTERS[2];
  if (z < -20000 && x < 60000) return CENTERS[0];
  return CENTERS[1];
}
export const CITIES = [
  { name: 'San Francisco', lat: 37.789, lon: -122.401, r: 2600, n: 240, hMax: 230 },
  { name: 'Oakland', lat: 37.804, lon: -122.271, r: 1500, n: 70, hMax: 110 },
  { name: 'San Jose', lat: 37.335, lon: -121.89, r: 1800, n: 80, hMax: 90 },
  { name: 'Sacramento', lat: 38.581, lon: -121.494, r: 1500, n: 70, hMax: 120 },
  { name: 'Los Angeles', lat: 34.051, lon: -118.255, r: 2400, n: 220, hMax: 300 },
  { name: 'Century City', lat: 34.058, lon: -118.417, r: 900, n: 40, hMax: 170 },
  { name: 'Long Beach', lat: 33.768, lon: -118.193, r: 1200, n: 50, hMax: 110 },
  { name: 'San Diego', lat: 32.716, lon: -117.165, r: 1800, n: 130, hMax: 150 },
  { name: 'Las Vegas', lat: 36.116, lon: -115.172, r: 2600, n: 170, hMax: 190 },
  { name: 'Phoenix', lat: 33.449, lon: -112.074, r: 1900, n: 110, hMax: 140 },
  { name: 'Reno', lat: 39.527, lon: -119.813, r: 1100, n: 50, hMax: 90 },
  { name: 'Fresno', lat: 36.737, lon: -119.787, r: 1200, n: 40, hMax: 70 },
];
export { NM };
