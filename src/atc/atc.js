// Air traffic control: a procedural controller for every phase of flight, using the real
// facilities and frequencies of each airport and FAA-style phraseology.
import { compose, part, runway as RW, freq as FQ, altitude as ALT, heading as HDG, speed as SPD, wind as WIND, altimeter as QNH, squawk as SQK, letter, taxiways, miles } from './phraseology.js';
import { centerFor, CENTERS } from '../world/airports.js';
import { KT, FT, NM, RAD, wrap180, wrap360, clamp } from '../core/units.js';
import { settings } from '../core/settings.js';

const ROLE = { atis: 'ATIS', clearance: 'Clearance', ground: 'Ground', tower: 'Tower', departure: 'Departure', approach: 'Approach' };
const SHORT = { atis: 'ATIS', clearance: 'CLR', ground: 'GND', tower: 'TWR', departure: 'DEP', approach: 'APP' };
const rnd = (a, b) => a + Math.random() * (b - a);

export class ATC {
  constructor(flight, world, { voice, callsign, traffic }) {
    this.f = flight; this.world = world; this.voice = voice; this.traffic = traffic;
    this.cs = callsign;
    this.dep = flight.dep; this.dest = flight.dest || flight.dep;
    this.local = this.dep === this.dest;
    this.t = 0;
    this.log = [];
    this.queue = [];
    this.timers = [];
    this.onLog = null;
    this.readback = null;
    this.lastAtc = null;
    this.assigned = { alt: null, hdg: null, spd: null };
    this.xpdr = '1200';
    this.squawk = String(1 + Math.floor(Math.random() * 6)) + [0, 0, 0].map(() => Math.floor(Math.random() * 8)).join('');
    this.vfr = false; this.pattern = false; this.emergency = false;
    this.hasAtis = {};
    this.atisT = 0; this.atisFor = null;
    this.warnT = {};
    this.vec = { last: -99, hdg: null, gaveA2: false, gaveSpd: false, first: true };
    const D = Math.hypot(this.dest.c.x - this.dep.c.x, this.dest.c.z - this.dep.c.z);
    this.tripNm = D / NM;
    this.cruise = flight.cruiseAltitude(D);
    this.depEnd = flight.depEnd; this.arrEnd = flight.arrEnd || flight.depEnd;
    const elevFt = (ap) => ap.elev / FT;
    this.initAlt = Math.min(this.cruise, Math.max(3000, Math.round((elevFt(this.dep) + 5000) / 1000) * 1000));
    this.a1 = Math.max(3000, Math.round((elevFt(this.dest) + 4500) / 1000) * 1000);
    this.a2 = Math.max(1800, Math.round((elevFt(this.dest) + 3000) / 500) * 500);
    this.a3 = Math.max(10000, Math.round((elevFt(this.dest) + 7000) / 1000) * 1000);
    this.com = { active: 121.5, standby: 121.5 };
    // initial state by start position
    const st = flight.start;
    if (st === 'runway') { this.phase = 'holdshort'; this.xpdr = this.squawk; this.com.active = this.dep.freq.tower; this.com.standby = this.dep.freq.departure; this.cleared = true; }
    else if (st === 'final') { this.phase = 'final'; this.xpdr = this.squawk; this.com.active = this.dest.freq.tower; this.com.standby = this.dest.freq.ground; this.cleared = true; }
    else if (st === 'cruise') {
      this.phase = 'enroute'; this.xpdr = this.squawk; this.cleared = true;
      this.com.active = centerFor(flight.fm.pos.x, flight.fm.pos.z).freq; this.com.standby = this.dest.freq.approach;
      this.assigned.alt = flight.ap.sel.alt; this.gaveDirect = true;
      this.curCenter = centerFor(flight.fm.pos.x, flight.fm.pos.z).name;
    } else { this.phase = 'pre'; this.com.active = this.dep.freq.atis; this.com.standby = this.dep.freq.clearance; }
    this.info('Radio ready. ' + (st === 'gate' ? `Listen to the ATIS on ${this.dep.freq.atis.toFixed(3)}, then press Tab to swap to Clearance.` : 'Use F1–F8 (or click) to transmit.'));
  }

  // ------------------------------------------------------------------ facilities
  fac(ap, role) {
    const tr = role === 'departure' || role === 'approach';
    return { ap, role, id: `${ap.icao}:${role}`, freq: ap.freq[role], name: `${tr ? ap.tracon : ap.spoken} ${ROLE[role]}` };
  }
  center() {
    const c = centerFor(this.f.fm.pos.x, this.f.fm.pos.z);
    return { role: 'center', id: `center:${c.name}`, freq: c.freq, name: c.name };
  }
  /** The station on the active COM frequency, preferring the role expected in this phase. */
  tuned() {
    const f = this.com.active, eq = (x) => Math.abs(x - f) < 0.0051;
    const dep = this.dep, dest = this.dest;
    const order = [];
    const arr = ['handoff_app', 'approach', 'cleared_app', 'final', 'cleared_land', 'rollout', 'vacated', 'taxi_in', 'parked', 'descent'].includes(this.phase);
    const depRoles = this.phase === 'pre' ? ['atis', 'clearance', 'ground', 'tower', 'departure', 'approach'] : ['ground', 'tower', 'departure', 'clearance', 'atis', 'approach'];
    const arrRoles = ['approach', 'tower', 'ground', 'atis', 'departure', 'clearance'];
    if (arr || this.local) { for (const r of this.local && !arr ? depRoles : arrRoles) order.push([dest, r]); if (!this.local) for (const r of depRoles) order.push([dep, r]); }
    else { for (const r of depRoles) order.push([dep, r]); for (const r of arrRoles) order.push([dest, r]); }
    const near = this.world.db.nearest(this.f.fm.pos.x, this.f.fm.pos.z);
    if (near && near !== dep && near !== dest) for (const r of arrRoles) order.push([near, r]);
    const ctr = CENTERS.find((c) => eq(c.freq));
    const asCenter = ctr ? { role: 'center', id: `center:${ctr.name}`, freq: ctr.freq, name: ctr.name } : null;
    if (asCenter && ['handoff_center', 'enroute', 'descent'].includes(this.phase)) return asCenter;
    for (const [ap, r] of order) if (eq(ap.freq[r])) return this.fac(ap, r);
    return asCenter;
  }
  on(role) { const t = this.tuned(); return t && t.role === role ? t : null; }
  swap() { const a = this.com.active; this.com.active = this.com.standby; this.com.standby = a; this.atisFor = null; this.atisT = 0; }
  setStandby(f) { this.com.standby = Math.round(clamp(f, 108, 399.975) * 200) / 200; }
  handoff(freq) { this.com.standby = freq; if (settings.autoTune) this.after(4, () => { if (Math.abs(this.com.standby - freq) < 0.003) this.swap(); }); }
  presets() {
    const p = this.f.fm.pos, near = this.world.db.nearest(p.x, p.z);
    const ap = ['pre', 'cleared', 'pushing', 'pushed', 'taxi', 'holdshort', 'lineup', 'tkof', 'airborne', 'departure', 'pattern'].includes(this.phase) ? this.dep
      : ['enroute', 'handoff_center'].includes(this.phase) ? near : this.dest;
    const c = this.center();
    return [
      ...['atis', 'clearance', 'ground', 'tower', 'departure', 'approach'].map((r) => ({ label: `${ap.icao} ${SHORT[r]}`, freq: ap.freq[r], title: this.fac(ap, r).name })),
      { label: 'CTR', freq: c.freq, title: c.name },
    ];
  }

  // ------------------------------------------------------------------ transmissions
  after(sec, fn) { this.timers.push({ at: this.t + sec, fn }); }
  info(text) { this.push({ from: '', text, kind: 'info' }); }
  push(entry) { entry.time = this.t; this.log.push(entry); if (this.log.length > 60) this.log.shift(); if (this.onLog) this.onLog(entry); }
  /** Controller transmission. Heard only while the facility is still tuned. */
  atc(fac, parts, { readback = null, delay = rnd(1.4, 2.6), then = null } = {}) {
    const m = compose(parts);
    this.queue.push({ at: this.t + delay, fac, m, readback, then });
  }
  pilot(parts) {
    this.readback = null;
    if (this.quietPilot) return;        // the pilot already said it in their own words
    const m = compose(parts);
    this.push({ from: this.cs.text, text: m.text, kind: 'pilot' });
    this.voice?.say(m.speech, 'pilot', 'pilot');
  }
  /** Background traffic heard on frequency. */
  chatter(facId, fromName, parts, who) {
    const t = this.tuned();
    if (!t || t.id !== facId) return;
    const m = compose(parts);
    this.push({ from: fromName, text: m.text, kind: 'other' });
    this.voice?.say(m.speech, who || fromName, 'atc');
  }
  wx() {
    const w = this.f.weather, v = this.f.magVar();
    return { wind: WIND(w.windDir - v, Math.round(w.windKt), w.gustKt), q: QNH(w.qnh) };
  }
  altNow() { return Math.round(this.f.fm.out.altFt / 100) * 100; }
  atisLetter(ap) { let h = 0; for (const c of ap.icao) h += c.charCodeAt(0); return 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(h + Math.floor(this.f.weather.windDir / 10)) % 24]; }

  // ------------------------------------------------------------------ pilot options
  getOptions() {
    const t = this.tuned(), o = [], cs = this.cs.part, ph = this.phase, f = this.f, fm = f.fm, out = fm.out;
    const add = (label, run) => o.push({ label, run });
    if (this.readback) add(`Read back: “${compose(this.readback).text}”`, () => { this.pilot(this.readback); if (this._afterReadback) { const fn = this._afterReadback; this._afterReadback = null; fn(); } });
    if (!t) { add('(No station on this frequency — tune a facility)', () => {}); return o; }
    const name = t.name;
    const atisBit = (ap) => (this.hasAtis[ap.icao] ? [' with information ', letter(this.atisLetter(ap))] : '');

    if (t.role === 'atis') { add('(Listening to ATIS — swap frequency to transmit)', () => {}); return o; }

    // ---- clearance delivery
    if ((t.role === 'clearance' || (t.role === 'ground' && t.ap.freq.clearance === t.ap.freq.ground)) && ph === 'pre' && t.ap === this.dep) {
      add(this.local ? `Request IFR clearance, radar vectors back to ${this.dep.spoken}` : `Request IFR clearance to ${this.dest.spoken}`, () => {
        this.pilot([name, ', ', cs, ', IFR to ', this.dest.spoken, atisBit(this.dep), ', ready to copy.']);
        const route = this.local ? ['via radar vectors ', this.arrEnd.ils ? 'ILS ' : 'visual approach ', RW(this.arrEnd.id)] : 'via radar vectors';
        const exp = this.cruise > this.initAlt ? [', expect ', ALT(this.cruise), ' one zero minutes after departure'] : '';
        const dfac = this.fac(this.dep, 'departure');
        this.atc(t, [cs, ', cleared to ', this.dest.spoken, ' airport ', route, ', climb and maintain ', ALT(this.initAlt), exp, ', departure frequency ', FQ(dfac.freq), ', ', SQK(this.squawk), '.'], {
          readback: ['Cleared to ', this.dest.spoken, ' via radar vectors, climb and maintain ', ALT(this.initAlt), ', departure ', FQ(dfac.freq), ', ', SQK(this.squawk), ', ', cs],
          then: () => {
            this.xpdr = this.squawk; this.assigned.alt = this.initAlt;
            f.ap.sel.alt = this.initAlt;
            this._afterReadback = () => {
              const g = this.fac(this.dep, 'ground');
              this.atc(t, [cs, ', readback correct. Contact ground ', FQ(g.freq), ' when ready', this.needPush() ? ' for push and start.' : ' to taxi.'], { delay: 1.2 });
              this.phase = 'cleared'; this.cleared = true; this.handoff(g.freq);
            };
          },
        });
      });
    }
    // ---- ground (departure)
    if (t.role === 'ground' && t.ap === this.dep && ['pre', 'cleared', 'pushed'].includes(ph)) {
      if (this.needPush() && ph !== 'pushed' && f.stand) {
        add('Request pushback', () => {
          this.pilot([name, ', ', cs, ', ', f.stand.id.toLowerCase(), ', request pushback', atisBit(this.dep), '.']);
          this.atc(t, [cs, ', ', name, ', pushback approved, advise ready to taxi.'], { readback: ['Pushback approved, ', cs], then: () => { this.after(2.5, () => { if (f.startPushback()) this.phase = 'pushing'; }); } });
        });
      }
      if (!this.needPush() || ph === 'pushed') {
        add(this.cleared ? 'Request taxi' : 'Request taxi, VFR closed traffic', () => {
          if (!this.cleared) { this.vfr = true; this.pattern = true; this.xpdr = '1200'; }
          this.pilot([name, ', ', cs, ', ready to taxi', this.vfr ? ', VFR closed traffic' : '', atisBit(this.dep), '.']);
          this.giveTaxiOut(t);
        });
      }
    }
    // ---- ground (arrival)
    if (t.role === 'ground' && t.ap === this.dest && (ph === 'vacated' || ph === 'rollout')) {
      add(`Clear of runway ${this.arrEnd.id}, request taxi to parking`, () => {
        this.pilot([name, ', ', cs, ', clear of ', RW(this.arrEnd.id), ', request taxi to parking.']);
        const st = this.dest.stands[Math.floor(this.dest.stands.length / 2) - (this.local ? 0 : 1)] || this.dest.stands[0];
        const r = this.dest.routeToStand(fm.pos.x, fm.pos.z, st);
        f.taxiRoute = r; f.stand = st;
        const via = r && r.names.length ? [' via ', taxiways(r.names)] : '';
        const cross = r && r.crossings.length ? r.crossings.map((x) => [', cross ', RW(x.split('/')[0])]) : '';
        this.atc(t, [cs, ', ', name, ', taxi to ', st.id.toLowerCase(), via, cross, '.'], { readback: ['Taxi to ', st.id.toLowerCase(), via, ', ', cs] });
        this.phase = 'taxi_in';
      });
    }
    // ---- tower (departure)
    if (t.role === 'tower' && t.ap === this.dep && ['taxi', 'holdshort', 'cleared', 'pushed', 'pre'].includes(ph) && out.onGround) {
      add(`Ready for departure, runway ${this.depEnd.id}`, () => {
        this.pilot([name, ', ', cs, ', holding short ', RW(this.depEnd.id), ', ready for departure', this.pattern ? ', closed traffic' : '', '.']);
        this.requestTakeoff(t);
      });
      if (!this.pattern) add('Request closed traffic (stay in the pattern)', () => {
        this.pattern = true; this.vfr = true;
        this.pilot([name, ', ', cs, ', request closed traffic.']);
        this.atc(t, [cs, ', closed traffic approved, make left traffic ', RW(this.depEnd.id), '.'], { readback: ['Left closed traffic approved, ', cs] });
      });
    }
    if (t.role === 'tower' && ph === 'lineup') add('(Lined up and waiting)', () => {});
    // ---- tower (pattern)
    if (t.role === 'tower' && ph === 'pattern' && !out.onGround) {
      for (const [lbl, clr] of [['full stop', 'cleared to land'], ['touch and go', 'cleared touch-and-go'], ['the option', 'cleared for the option']]) {
        add(`Midfield downwind, ${lbl}`, () => {
          this.pilot([name, ', ', cs, ', midfield left downwind ', RW(this.depEnd.id), ', ', lbl, '.']);
          this.arrEnd = this.depEnd;
          this.atc(t, [cs, ', number one, ', this.wx().wind, ', ', RW(this.depEnd.id), ', ', clr, '.'], { readback: [RW(this.depEnd.id), ', ', clr, ', ', cs] });
          this.phase = 'cleared_land'; this.touchAndGo = lbl !== 'full stop';
        });
      }
    }
    // ---- departure
    if ((t.role === 'departure' || t.role === 'approach') && t.ap === this.dep && ph === 'airborne') {
      add(`Check in with ${name}`, () => {
        this.pilot([name, ', ', cs, ', passing ', ALT(this.altNow()), ' for ', ALT(this.assigned.alt || this.initAlt), '.']);
        this.departureContact(t);
      });
    }
    // ---- center
    if (t.role === 'center' && ph === 'handoff_center' && (!this.curCenter || t.name === this.curCenter)) {
      add(`Check in with ${name}`, () => {
        const lvl = Math.abs(out.vsFpm) < 300;
        this.pilot([name, ', ', cs, lvl ? ', level ' : ', passing ', ALT(this.altNow()), lvl ? '' : [' for ', ALT(this.assigned.alt)], '.']);
        const climb = !this.descending && this.cruise > (this.assigned.alt || 0) + 500;
        const dct = !this.gaveDirect;
        this.atc(t, [cs, ', ', name, ', roger', climb ? [', climb and maintain ', ALT(this.cruise)] : '', dct ? [', cleared direct ', this.dest.spoken] : '', '.'], {
          readback: climb || dct ? [climb ? ['Climb and maintain ', ALT(this.cruise), dct ? ', ' : ''] : '', dct ? ['direct ', this.dest.spoken] : '', ', ', cs] : null,
          then: () => { if (climb) this.setAlt(this.cruise); if (dct) { this.assigned.hdg = null; this.direct(); this.gaveDirect = true; } },
        });
        this.curCenter = t.name;
        this.phase = 'enroute';
      });
    }
    if (t.role === 'center' && ph === 'enroute') {
      add('Request descent', () => { this.pilot([name, ', ', cs, ', request descent.']); this.startDescent(t); });
      add(`Request direct ${this.dest.spoken}`, () => { this.pilot([name, ', ', cs, ', request direct ', this.dest.spoken, '.']); this.atc(t, [cs, ', cleared direct ', this.dest.spoken, '.'], { readback: ['Direct ', this.dest.spoken, ', ', cs], then: () => this.direct() }); });
    }
    // ---- approach
    if ((t.role === 'approach' || t.role === 'departure') && t.ap === this.dest && ph === 'handoff_app') {
      add(`Check in with ${name}`, () => {
        this.pilot([name, ', ', cs, ', ', Math.abs(out.vsFpm) < 300 ? 'level ' : 'descending ', ALT(this.assigned.alt || this.altNow()), atisBit(this.dest), '.']);
        this.approachContact(t);
      });
    }
    if ((t.role === 'approach' || t.role === 'departure') && ['approach', 'cleared_app'].includes(ph)) {
      add('Request lower', () => { this.pilot([name, ', ', cs, ', request lower.']); if (this.assigned.alt > this.a2) { this.atc(t, [cs, ', descend and maintain ', ALT(this.a2), '.'], { readback: ['Descend and maintain ', ALT(this.a2), ', ', cs], then: () => { this.setAlt(this.a2); this.vec.gaveA2 = true; } }); } else this.atc(t, [cs, ', unable lower, maintain ', ALT(this.assigned.alt || this.a2), '.']); });
    }
    // ---- tower (arrival)
    if (t.role === 'tower' && t.ap === this.dest && ['final', 'cleared_app', 'approach'].includes(ph) && !out.onGround) {
      add(`Report on final, runway ${this.arrEnd.id}`, () => {
        const d = Math.max(1, Math.round(this.geom().along / NM));
        this.pilot([name, ', ', cs, ', ', miles(d), ' final ', RW(this.arrEnd.id), '.']);
        this.landingClearance(t);
      });
    }
    if (t.role === 'tower' && ph === 'cleared_land' && !out.onGround) {
      add('Going around', () => { this.pilot([cs, ', going around.']); this.goAround(t); });
    }
    // ---- always available
    if (this.lastAtc) add('Say again', () => { this.pilot([name, ', ', cs, ', say again.']); this.atc(t, ['I say again: ', part(this.lastAtc.text, this.lastAtc.speech)], { readback: this.lastReadback }); });
    if (t.role === 'tower') add('Request wind check', () => { this.pilot([name, ', ', cs, ', wind check.']); this.atc(t, [this.wx().wind, '.']); });
    if (!this.emergency && !out.onGround) add('Declare emergency (MAYDAY)', () => this.mayday(t));
    return o;
  }
  needPush() { return !!this.f.stand && !this.dep.military && this.f.start === 'gate'; }

  // ------------------------------------------------------------------ procedures
  setAlt(ft) { this.assigned.alt = ft; if (this.f.ap) this.f.ap.sel.alt = ft; }
  direct() {
    const ap = this.f.ap;
    ap.nav = { x: this.dest.c.x, z: this.dest.c.z, name: this.dest.icao };
    if (ap.on && ap.lat === 'HDG') ap.lat = 'NAV';
  }
  giveTaxiOut(t) {
    const f = this.f, cs = this.cs.part, e = this.depEnd;
    const r = this.dep.routeToRunway(f.fm.pos.x, f.fm.pos.z, e);
    f.taxiRoute = r;
    const via = r && r.names.length ? [' via ', taxiways(r.names)] : '';
    const cross = r && r.crossings.length ? r.crossings.map((x) => [', cross ', RW(x.split('/')[0])]) : '';
    const bt = r && r.backtrack.length ? [', back-taxi ', RW(r.backtrack[0].split('/')[0])] : '';
    this.atc(t, [cs, ', ', t.name, ', ', RW(e.id), ', taxi', via, cross, bt, '. Hold short of ', RW(e.id), '. ', this.wx().q, '.'], {
      readback: [RW(e.id), ', taxi', via, cross, ', hold short ', RW(e.id), ', ', cs],
    });
    this.phase = 'taxi';
  }
  requestTakeoff(t) {
    const cs = this.cs.part, e = this.depEnd;
    const conflict = this.traffic ? this.traffic.runwayBusy(e.rwy, 5.5 * NM) : null;
    if (conflict) {
      this.atc(t, [cs, ', hold short of ', RW(e.id), ', traffic ', conflict.onFinal ? [miles(Math.max(1, Math.round(conflict.dist / NM))), ' final'] : 'on the runway', '.'], { readback: ['Holding short ', RW(e.id), ', ', cs] });
      this.phase = 'holdshort';
      this.after(18, () => { if (this.phase === 'holdshort' && this.on('tower')) this.requestTakeoff(this.on('tower')); });
      return;
    }
    const patt = this.pattern ? 'make left closed traffic, ' : '';
    const clr = () => {
      this.atc(t, [cs, ', ', this.wx().wind, ', ', patt, RW(e.id), ', cleared for takeoff.'], { readback: ['Cleared for takeoff ', RW(e.id), ', ', cs] });
      this.phase = 'tkof'; this.tkofT = this.t;
    };
    if (Math.random() < 0.35) {
      this.atc(t, [cs, ', ', RW(e.id), ', line up and wait.'], { readback: ['Line up and wait ', RW(e.id), ', ', cs] });
      this.phase = 'lineup';
      this.after(rnd(18, 30), () => { if (this.phase === 'lineup') clr(); });
    } else clr();
  }
  departureContact(t) {
    const cs = this.cs.part, f = this.f, out = f.fm.out;
    if (this.local) {
      this.atc(t, [cs, ', ', t.name, ', radar contact, climb and maintain ', ALT(this.a1), ', expect vectors ', this.arrEnd.ils ? 'ILS ' : 'visual approach ', RW(this.arrEnd.id), '.'], {
        readback: ['Climb and maintain ', ALT(this.a1), ', ', cs], then: () => { this.setAlt(this.a1); this.tuneApproach(); },
      });
      this.phase = 'approach'; this.vec.first = true;
      return;
    }
    const a2 = Math.min(this.cruise, 16000);
    const brg = Math.atan2(this.dest.c.x - f.fm.pos.x, -(this.dest.c.z - f.fm.pos.z)) * RAD - f.magVar();
    const turn = wrap180(brg - f.hdgMag());
    const dir = Math.abs(turn) < 12 ? 'fly ' : turn > 0 ? 'turn right ' : 'turn left ';
    const h = Math.round(wrap360(brg) / 10) * 10;
    this.atc(t, [cs, ', ', t.name, ', radar contact, climb and maintain ', ALT(a2), ', ', dir, HDG(h), '.'], {
      readback: ['Climb and maintain ', ALT(a2), ', ', HDG(h), ', ', cs],
      then: () => { this.setAlt(a2); this.assigned.hdg = h; f.ap.sel.hdg = h === 360 ? 0 : h; this.hdgT = this.t; },
    });
    this.phase = 'departure';
  }
  startDescent(t) {
    if (this.phase !== 'enroute') return;
    const cs = this.cs.part;
    const a = Math.min(this.a3, Math.max(this.a1, this.altNow() - 1000));
    this.atc(t, [cs, ', descend and maintain ', ALT(a), ', ', this.dest.spoken, ' ', this.wx().q, '.'], { readback: ['Descend and maintain ', ALT(a), ', ', this.wx().q, ', ', cs], then: () => this.setAlt(a) });
    this.phase = 'descent'; this.descending = true;
  }
  approachContact(t) {
    const cs = this.cs.part, e = this.arrEnd;
    const kind = e.ils ? 'ILS ' : 'visual approach ';
    const slow = this.f.fm.out.ias > 235 && this.f.spec.type !== 'fighter';
    const a = Math.min(this.a1, Math.max(this.a2, this.altNow()));
    this.atc(t, [cs, ', ', t.name, ', descend and maintain ', ALT(a), ', expect ', kind, RW(e.id), slow ? [', reduce speed to ', SPD(210)] : '', '.'], {
      readback: ['Descend and maintain ', ALT(a), ', expect ', kind, RW(e.id), ', ', cs],
      then: () => { this.setAlt(a); if (slow) { this.assigned.spd = 210; this.f.ap.sel.spd = 210; this.f.ap.sel.useMach = false; } this.tuneApproach(); },
    });
    this.phase = 'approach'; this.vec.first = true; this.vec.last = this.t;
  }
  tuneApproach() {
    const e = this.arrEnd;
    this.f.arrEnd = e;
    if (e.ils) { this.f.ap.setILS(e.ils); this.info(`ILS ${e.id} tuned: ${e.ils.freq.toFixed(2)} MHz, course ${String(Math.round(e.magHdg)).padStart(3, '0')}°. Press V to arm the approach.`); }
    this.world.env.groundRef = this.dest.elev;
  }
  /** Position relative to the arrival runway: along (m before the threshold) and cross (m right of course). */
  geom() {
    const e = this.arrEnd, p = this.f.fm.pos;
    const dx = p.x - e.thr.x, dz = p.z - e.thr.z;
    return { along: -(dx * e.dir.x + dz * e.dir.z), cross: dx * -e.dir.z + dz * e.dir.x };
  }
  landingClearance(t) {
    const cs = this.cs.part, e = this.arrEnd;
    const busy = this.traffic ? this.traffic.runwayBusy(e.rwy, 0, true) : null;
    if (busy) {
      this.atc(t, [cs, ', ', t.name, ', continue, traffic departing ahead.'], { readback: ['Continue, ', cs] });
      this.after(12, () => { const tt = this.on('tower'); if (tt && this.phase === 'final') this.landingClearance(tt); });
      this.phase = 'final';
      return;
    }
    this.atc(t, [cs, ', ', t.name, ', ', this.wx().wind, ', ', RW(e.id), ', cleared to land.'], { readback: ['Cleared to land ', RW(e.id), ', ', cs] });
    this.phase = 'cleared_land';
  }
  goAround(t) {
    const cs = this.cs.part, e = this.arrEnd;
    const app = this.fac(this.dest, 'approach');
    if (this.pattern) {
      this.atc(t, [cs, ', roger, make left traffic ', RW(e.id), ', report midfield downwind.'], { readback: ['Left traffic, ', cs] });
      this.phase = 'pattern';
      return;
    }
    const h = Math.round(e.magHdg / 10) * 10;
    this.atc(t, [cs, ', roger, fly ', HDG(h), ', climb and maintain ', ALT(this.a1), ', contact approach ', FQ(app.freq), '.'], {
      readback: [HDG(h), ', climb and maintain ', ALT(this.a1), ', approach ', FQ(app.freq), ', ', cs],
      then: () => { this.setAlt(this.a1); this.assigned.hdg = h; this.f.ap.sel.hdg = h % 360; this.handoff(app.freq); },
    });
    this.phase = 'handoff_app'; this.vec = { last: -99, hdg: null, gaveA2: false, gaveSpd: false, first: true };
  }
  mayday(t) {
    const f = this.f, cs = this.cs.part, p = f.fm.pos;
    this.emergency = true;
    this.pilot(['Mayday, mayday, mayday, ', t.name, ', ', cs, ', declaring an emergency, request immediate landing.']);
    const ap = this.world.db.nearest(p.x, p.z, (a) => a.runways[0].length > 2100);
    this.dest = ap; f.dest = ap;
    this.arrEnd = f.pickArrival(ap); f.arrEnd = this.arrEnd;
    this.a2 = Math.max(1800, Math.round((ap.elev / FT + 3000) / 500) * 500); this.a1 = this.a2 + 1000;
    const d = Math.round(Math.hypot(ap.c.x - p.x, ap.c.z - p.z) / NM);
    this.xpdr = '7700';
    this.atc(t, [cs, ', roger mayday, squawk 7700. ', ap.spoken, ' airport is ', miles(d), ' from your position, ', RW(this.arrEnd.id), ' is available, ', this.wx().wind, '. Cleared to land, all runways. Emergency equipment is standing by.'], {
      readback: ['Cleared to land ', RW(this.arrEnd.id), ', ', cs], then: () => { this.tuneApproach(); this.direct(); this.setAlt(Math.min(this.altNow(), this.a1)); },
    });
    this.phase = 'cleared_land'; this.emergencyLanding = true;
  }

  // ------------------------------------------------------------------ events from the simulation
  flightEvent(e) {
    const t = this.tuned(), cs = this.cs.part;
    if (e.type === 'pushbackDone') { if (this.phase === 'pushing') this.phase = 'pushed'; this.info('Pushback complete. Parking brake set — request taxi when ready.'); }
    if (e.type === 'liftoff') {
      if (!['tkof', 'cleared_land', 'pattern'].includes(this.phase) && !this.emergency && this.t - (this.warnT.tk || -99) > 60) {
        this.warnT.tk = this.t;
        const tw = this.fac(this.dep, 'tower');
        this.atc(tw, [cs, ', ', tw.name, ', you departed without a takeoff clearance. Possible pilot deviation, advise you contact the tower by phone after landing.'], { delay: 4 });
        this.phase = 'tkof'; this.tkofT = this.t;
      }
      if (this.touchAndGo && this.phase === 'cleared_land') { this.phase = 'pattern'; }
    }
    if (e.type === 'touchdown') {
      if (!['cleared_land'].includes(this.phase) && !this.emergency && this.f.fm.out.gs > 30 && this.t - (this.warnT.ld || -99) > 60 && this.phase !== 'tkof' && this.phase !== 'holdshort' && this.phase !== 'lineup') {
        this.warnT.ld = this.t;
        const ap = e.rep.airport || this.dest;
        const tw = this.fac(ap, 'tower');
        this.atc(tw, [cs, ', ', tw.name, ', you landed without a clearance. Possible pilot deviation, advise you contact the tower by phone.'], { delay: 5 });
        if (e.rep.end) { this.arrEnd = e.rep.end; this.dest = ap; }
      }
      if (!this.touchAndGo) this.landedT = this.t;
    }
  }

  // ------------------------------------------------------------------ periodic logic
  update(dt) {
    this.t += dt;
    const f = this.f, fm = f.fm, out = fm.out, cs = this.cs.part;
    // scheduled callbacks and transmissions
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].at <= this.t) { const fn = this.timers[i].fn; this.timers.splice(i, 1); fn(); }
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.at > this.t) continue;
      if (this.voice && this.voice.speaking && q.at > this.t - 6) continue;      // wait for the frequency to clear
      this.queue.splice(i, 1); i--;
      const t = this.tuned();
      if (!t || t.id !== q.fac.id) { if (q.then) q.then(); continue; }
      this.push({ from: q.fac.name, text: q.m.text, kind: 'atc' });
      this.voice?.say(q.m.speech, q.fac.id, 'atc');
      this.lastAtc = q.m; this.lastReadback = q.readback;
      if (q.readback) { this.readback = q.readback; this.rbT = this.t; }
      if (q.then) q.then();
      break;
    }
    const t = this.tuned();
    // ATIS broadcast
    if (t && t.role === 'atis') {
      if (this.atisFor !== t.ap.icao || this.t > this.atisT) {
        this.atisFor = t.ap.icao; this.atisT = this.t + 70;
        const m = this.atisText(t.ap);
        this.push({ from: `${t.ap.spoken} ATIS`, text: m.text, kind: 'atis' });
        this.voice?.say(m.speech, t.id, 'atis');
        this.hasAtis[t.ap.icao] = true;
      }
    }
    if (this.pending) return;
    const ph = this.phase;
    const surf = out.onGround ? this.world.db.surface(fm.pos.x, fm.pos.z) : null;

    // ---- taxi out: hand off to tower near the holding point
    if (ph === 'taxi' && f.taxiRoute && f.taxiRoute.hold) {
      const h = f.taxiRoute.hold;
      if (Math.hypot(fm.pos.x - h.x, fm.pos.z - h.z) < 130) {
        const g = this.on('ground'), tw = this.fac(this.dep, 'tower');
        if (g) this.atc(g, [cs, ', contact tower ', FQ(tw.freq), '.'], { readback: ['Tower ', FQ(tw.freq), ', ', cs] });
        this.handoff(tw.freq);
        this.phase = 'holdshort';
      }
    }
    // ---- runway incursion
    if (out.onGround && surf && surf.type === 'runway' && ['pre', 'cleared', 'pushed', 'taxi', 'holdshort'].includes(ph) && Math.abs(surf.cross) < surf.rwy.width / 2 - 2) {
      const crossingOk = f.taxiRoute && f.taxiRoute.crossings && f.taxiRoute.crossings.includes(surf.rwy.id) || (f.taxiRoute && f.taxiRoute.backtrack && f.taxiRoute.backtrack.includes(surf.rwy.id));
      if (!crossingOk && this.t - (this.warnT.inc || -99) > 45) {
        this.warnT.inc = this.t;
        const tw = this.fac(this.dep, 'tower');
        this.atc(this.tuned() && this.tuned().ap === this.dep ? this.tuned() : tw, [cs, ', hold position. You have entered ', RW(surf.rwy.ends[0].id), ' without a clearance.'], { delay: 1 });
      }
    }
    // ---- after takeoff
    if (ph === 'tkof' && !out.onGround && out.agl > 260) {
      if (this.pattern) { this.phase = 'pattern'; const tw = this.on('tower'); if (tw) this.atc(tw, [cs, ', report midfield left downwind ', RW(this.depEnd.id), '.'], { readback: ['Report midfield downwind, ', cs] }); }
      else {
        const d = this.fac(this.dep, 'departure'), tw = this.on('tower');
        if (tw) this.atc(tw, [cs, ', contact ', d.name, ' ', FQ(d.freq), '.'], { readback: [FQ(d.freq), ', ', cs] });
        this.handoff(d.freq);
        this.phase = 'airborne';
      }
    }
    // ---- departure: hand off to centre or straight to approach on a short hop
    if (ph === 'departure') {
      const dDep = Math.hypot(fm.pos.x - this.dep.c.x, fm.pos.z - this.dep.c.z) / NM;
      const dDest = Math.hypot(fm.pos.x - this.dest.c.x, fm.pos.z - this.dest.c.z) / NM;
      const dp = this.on('departure') || this.on('approach');
      if (this.tripNm < 75 ? dDest < 45 || dDep > 18 : (out.altFt > 11500 || dDep > 32)) {
        if (this.tripNm < 75) {
          const a = this.fac(this.dest, 'approach');
          if (Math.abs(a.freq - this.com.active) < 0.004) { this.phase = 'handoff_app'; if (dp) this.approachContact(dp); }
          else { if (dp) this.atc(dp, [cs, ', contact ', a.name, ' ', FQ(a.freq), '.'], { readback: [FQ(a.freq), ', ', cs] }); this.handoff(a.freq); this.phase = 'handoff_app'; }
        } else {
          const c = this.center();
          if (dp) this.atc(dp, [cs, ', contact ', c.name, ' ', FQ(c.freq), '.'], { readback: [FQ(c.freq), ', ', cs] });
          this.handoff(c.freq);
          this.curCenter = c.name;
          this.phase = 'handoff_center';
        }
      }
    }
    // ---- en route: top of descent and hand-off to approach
    const dDest = Math.hypot(fm.pos.x - this.dest.c.x, fm.pos.z - this.dest.c.z) / NM;
    // crossing into the next centre's airspace
    if ((ph === 'enroute' || ph === 'descent') && dDest > 50) {
      const c = this.center();
      if (!this.curCenter) this.curCenter = (this.on('center') || c).name;
      if (c.name !== this.curCenter) {
        const old = this.on('center');
        if (old) this.atc(old, [cs, ', contact ', c.name, ' ', FQ(c.freq), '.'], { readback: [FQ(c.freq), ', ', cs] });
        this.handoff(c.freq);
        this.curCenter = c.name;
        this.phase = 'handoff_center';
        return;
      }
    }
    if (ph === 'enroute') {
      const tod = ((out.altFt - this.a3) / 1000) * 3.2 + 42;
      if (dDest < tod) { const c = this.on('center'); if (c) this.startDescent(c); else this.phase = 'descent'; }
    }
    if (ph === 'descent' && dDest < 44) {
      const c = this.on('center'), a = this.fac(this.dest, 'approach');
      if (c) this.atc(c, [cs, ', contact ', a.name, ' ', FQ(a.freq), '.'], { readback: [FQ(a.freq), ', ', cs] });
      this.handoff(a.freq);
      this.phase = 'handoff_app';
    }
    // ---- approach vectoring
    if (ph === 'approach' || ph === 'cleared_app') this.vector();
    // ---- on final without having called: tower clears when the pilot reports (option) ----
    // ---- go-around detection
    if (ph === 'cleared_land' && !out.onGround && !this.pattern && !this.emergency) {
      const g = this.geom();
      if (g.along < -600 && out.agl > 200 && out.vs > 2) { const tw = this.on('tower'); if (tw) this.goAround(tw); else this.phase = 'handoff_app'; }
    }
    // ---- after landing
    if ((ph === 'cleared_land' || ph === 'final' || ph === 'cleared_app') && out.onGround && out.gs < 22 && !this.touchAndGo && surf && surf.type === 'runway') {
      const g = this.fac(this.dest, 'ground'), tw = this.on('tower');
      if (tw) this.atc(tw, [cs, ', exit the runway when able, contact ground ', FQ(g.freq), '.'], { readback: ['Ground ', FQ(g.freq), ', ', cs] });
      this.handoff(g.freq);
      this.phase = 'rollout';
    }
    if (ph === 'rollout' && out.onGround && (!surf || surf.type !== 'runway')) this.phase = 'vacated';
    if (ph === 'taxi_in' && f.stand && out.gs < 0.5 && Math.hypot(fm.pos.x - f.stand.x, fm.pos.z - f.stand.z) < 45) {
      this.phase = 'parked';
      const g = this.on('ground');
      if (g) this.atc(g, [cs, ', welcome to ', this.dest.city || this.dest.spoken, '. Good day.']);
      f.events.push({ type: 'parked' });
    }
    // ---- missing read-back prompt
    if (this.readback && this.t - this.rbT > 28 && t && this.lastAtc && !this.rbNag) {
      this.rbNag = true;
      this.atc(t, [cs, ', ', t.name, ', how do you hear?'], { delay: 0.5, readback: this.readback });
      this.after(40, () => { this.rbNag = false; });
    }
    this.monitor(t);
  }

  vector() {
    const f = this.f, fm = f.fm, out = fm.out, cs = this.cs.part, e = this.arrEnd;
    const t = this.on('approach') || this.on('departure');
    const g = this.geom(), v = this.vec;
    const fc = e.hdg, var_ = f.magVar();
    // the pattern side is chosen once, so the vectors do not flip when crossing the centreline
    if (v.side == null) v.side = g.cross >= 0 ? 1 : -1;
    const side = v.stage === 'base' || Math.abs(g.cross) < 1.5 * NM ? (g.cross >= 0 ? 1 : -1) : v.side;
    const trackErr = Math.abs(wrap180(out.track - fc));
    const kind = e.ils ? 'ILS ' : 'visual approach ';
    if (this.phase === 'cleared_app') {
      // established and close in: over to tower
      if (g.along < 9 * NM && Math.abs(g.cross) < 700 && g.along > 0) {
        const tw = this.fac(this.dest, 'tower');
        if (t) this.atc(t, [cs, ', contact tower ', FQ(tw.freq), '.'], { readback: ['Tower ', FQ(tw.freq), ', ', cs] });
        this.handoff(tw.freq);
        this.assigned.hdg = null; this.assigned.alt = null; this.assigned.spd = null;
        this.phase = 'final';
      } else if ((Math.abs(g.cross) > 2.2 * NM || g.along < 1 * NM) && this.t - v.last > 40) {
        // flew through the localiser or too close: back to vectors
        this.phase = 'approach'; v.first = false; v.stage = 'downwind'; v.side = g.cross >= 0 ? 1 : -1;
      }
      return;
    }
    if (!t) return;
    // far too high to make the approach from here: keep the aircraft out on a wide downwind
    const tooHigh = out.altFt > this.a2 + 2500 + (Math.max(g.along, 0) / NM) * 330;
    // a 30-degree intercept from here must capture the localizer at least 10.5 nm out, so the
    // aircraft is established before the glideslope comes down to the intercept altitude
    const inCone = !tooHigh && g.along > 11 * NM && g.along < 24 * NM && Math.abs(g.cross) < Math.max(0.5 * NM, (g.along - 10.5 * NM) * 0.55) && trackErr < 115;
    if (inCone && this.t - v.last > 8) {
      const ih = Math.abs(g.cross) < 0.4 * NM ? fc : fc - side * 30;
      const hm = Math.round(wrap360(ih - var_) / 10) * 10;
      const turn = wrap180(hm - f.hdgMag());
      const dir = Math.abs(turn) < 10 ? 'fly ' : turn > 0 ? 'turn right ' : 'turn left ';
      const faf = Math.max(1, Math.round(g.along / NM - 5));
      this.atc(t, [cs, ', ', miles(faf), ' from the final approach fix, ', dir, HDG(hm), ', maintain ', ALT(this.a2), ' until established', e.ils ? ' on the localizer' : '', ', cleared ', kind, RW(e.id), ' approach.'], {
        readback: [HDG(hm), ', ', ALT(this.a2), ' until established, cleared ', kind, RW(e.id), ', ', cs],
        then: () => { this.assigned.hdg = hm; f.ap.sel.hdg = hm % 360; this.setAlt(this.a2); this.hdgT = this.t; if (!this.f.ap.ils && e.ils) this.tuneApproach(); },
      });
      v.last = this.t; this.phase = 'cleared_app';
      return;
    }
    // choose a steering point
    let tx, tz;
    const P = (al, cr) => [e.thr.x - e.dir.x * al + -e.dir.z * cr, e.thr.z - e.dir.z * al + e.dir.x * cr];
    // downwind out to 17 nm, then a base leg square to the final approach course
    if (!v.stage) v.stage = g.along >= 15 * NM ? 'base' : 'downwind';
    if (v.stage === 'downwind' && g.along >= 17 * NM && !tooHigh) v.stage = 'base';
    if (v.stage === 'base' && (g.along < 12.5 * NM || tooHigh)) v.stage = 'downwind';
    if (tooHigh) [tx, tz] = P(clamp(g.along + 8 * NM, 20 * NM, 30 * NM), v.side * 6 * NM);
    else if (v.stage === 'base') [tx, tz] = P(clamp(g.along - 0.6 * NM, 13 * NM, 26 * NM), 0);
    else [tx, tz] = P(20 * NM, v.side * 5.5 * NM);
    const want = wrap360(Math.atan2(tx - fm.pos.x, -(tz - fm.pos.z)) * RAD - var_);
    const hm = Math.round(want / 10) * 10 || 360;
    const due = v.hdg == null || (Math.abs(wrap180(hm - v.hdg)) >= 15 && this.t - v.last > 28);
    // step down for the intercept
    const dThr = Math.hypot(g.along, g.cross);
    const needA2 = !v.gaveA2 && (this.assigned.alt || 99999) > this.a2 && dThr < 21 * NM && !tooHigh;
    const needSpd = !v.gaveSpd && g.along > 12 * NM && Math.abs(g.cross) < 7 * NM && out.ias > 200 && this.f.spec.type !== 'fighter';
    if ((due || needA2) && this.t - v.last > 6) {
      const turn = wrap180(hm - f.hdgMag());
      const dir = Math.abs(turn) < 10 ? 'fly ' : turn > 0 ? 'turn right ' : 'turn left ';
      const parts = [cs, ', '], rb = [];
      if (due) { parts.push(dir, HDG(hm)); rb.push(HDG(hm)); }
      if (needA2) { parts.push(due ? ', ' : '', 'descend and maintain ', ALT(this.a2)); rb.push(rb.length ? ', ' : '', 'descend and maintain ', ALT(this.a2)); }
      if (needSpd) { parts.push(', reduce speed to ', SPD(180)); rb.push(', ', SPD(180)); }
      if (v.first && due) parts.push(', vectors ', kind, RW(e.id), ' final approach course');
      parts.push('.'); rb.push(', ', cs);
      this.atc(t, parts, {
        readback: rb, delay: rnd(0.8, 1.6),
        then: () => {
          if (due) { this.assigned.hdg = hm; f.ap.sel.hdg = hm % 360; this.hdgT = this.t; if (f.ap.lat === 'NAV') f.ap.lat = 'HDG'; }
          if (needA2) { this.setAlt(this.a2); }
          if (needSpd) { this.assigned.spd = 180; f.ap.sel.spd = 180; f.ap.sel.useMach = false; }
        },
      });
      if (due) v.hdg = hm;
      if (needA2) v.gaveA2 = true;
      if (needSpd) v.gaveSpd = true;
      v.last = this.t; v.first = false;
    }
  }

  /** Compliance monitoring: altitude, heading and speed deviations. */
  monitor(t) {
    if (!t || t.role === 'atis' || t.role === 'ground' || t.role === 'clearance') return;
    const f = this.f, out = f.fm.out, cs = this.cs.part, a = this.assigned;
    if (out.onGround || this.emergency) return;
    const quiet = (k, s) => this.t - (this.warnT[k] || -999) > s;
    if (a.alt != null && !['cleared_app', 'final', 'cleared_land', 'pattern', 'tkof'].includes(this.phase)) {
      const err = out.altFt - a.alt;
      const bust = (err > 350 && out.vsFpm > 250) || (err < -350 && out.vsFpm < -250);
      this.bustT = bust ? (this.bustT || 0) + 1 / 60 : 0;
      if (this.bustT > 6 && quiet('alt', 50)) {
        this.warnT.alt = this.t;
        this.atc(t, [cs, ', check altitude. Maintain ', ALT(a.alt), '.'], { delay: 0.6, readback: ['Maintain ', ALT(a.alt), ', ', cs] });
      }
    }
    if (a.hdg != null && ['departure', 'approach'].includes(this.phase) && this.t - (this.hdgT || 0) > 50) {
      const err = Math.abs(wrap180(f.hdgMag() - a.hdg));
      if (err > 28 && quiet('hdg', 55)) {
        this.warnT.hdg = this.t;
        const turn = wrap180(a.hdg - f.hdgMag());
        this.atc(t, [cs, ', ', turn > 0 ? 'turn right ' : 'turn left ', HDG(a.hdg), '.'], { delay: 0.6, readback: [HDG(a.hdg), ', ', cs] });
      }
    }
    if (f.spec.type !== 'fighter' && out.altFt < 9700 && out.ias > 268 && quiet('spd', 70)) {
      this.spdT = (this.spdT || 0) + 1 / 60;
      if (this.spdT > 12) { this.warnT.spd = this.t; this.spdT = 0; this.atc(t, [cs, ', reduce speed to ', SPD(250), ' below ', ALT(10000), '.'], { delay: 0.6, readback: [SPD(250), ', ', cs] }); }
    } else this.spdT = 0;
  }

  atisText(ap) {
    const w = this.f.weather, v = this.world.db.magVar(ap.c.x, ap.c.z);
    const L = this.atisLetter(ap);
    const ends = ap.activeEnds(w.windDir, w.windKt);
    const arr = ends.find((e) => e.ils) || ends[0];
    const hh = Math.floor((this.world.env.hour + 8) % 24), z = `${String(hh).padStart(2, '0')}53`;
    const sky = w.cover < 0.1 ? 'sky clear' : `${w.cover < 0.3 ? 'few' : w.cover < 0.55 ? 'scattered' : w.cover < 0.9 ? 'broken' : 'overcast'} ${ALT(Math.round((w.base / FT) / 100) * 100).t}`;
    const skyS = w.cover < 0.1 ? 'sky clear' : `${w.cover < 0.3 ? 'few' : w.cover < 0.55 ? 'scattered' : w.cover < 0.9 ? 'broken' : 'overcast'} ${ALT(Math.round((w.base / FT) / 100) * 100).s}`;
    const visSm = Math.min(10, Math.max(0.25, Math.round((w.vis / 1609) * 4) / 4));
    const temp = Math.round(15 + w.dT - (ap.elev / 1000) * 6.5 + 6);
    return compose([
      ap.spoken, ' information ', letter(L), ', ', part(`${z}Z`, `${z.split('').join(' ')} zulu`), '. ', WIND(w.windDir - v, Math.round(w.windKt), w.gustKt), '. Visibility ', part(String(visSm), String(visSm)), '. ',
      part(sky, skyS), '. Temperature ', part(String(temp)), ', dew point ', part(String(temp - 7)), '. ', QNH(w.qnh), '. ',
      arr.ils ? 'ILS ' : 'Visual approach ', RW(arr.id), ' in use, departing ', RW(ends[0].id), '. Advise on initial contact you have information ', letter(L), '.',
    ]);
  }

  /** Free-text or spoken transmission: match it to one of the available calls. */
  matchText(str) {
    const s = str.toLowerCase();
    const opts = this.getOptions();
    const kw = [
      [/read ?back|roger|wilco|copy|cleared|approved|maintain|heading|contact|taxi via|hold short/, (o) => /^Read back/.test(o.label)],
      [/clearance|ifr/, (o) => /clearance/i.test(o.label)],
      [/push/, (o) => /pushback/i.test(o.label)],
      [/taxi|parking|gate|clear of/, (o) => /taxi/i.test(o.label)],
      [/ready|departure|take ?off|holding short/, (o) => /Ready for departure/.test(o.label)],
      [/closed traffic|pattern/, (o) => /closed traffic/i.test(o.label)],
      [/touch/, (o) => /touch and go/.test(o.label)],
      [/option/, (o) => /the option/.test(o.label)],
      [/downwind|full stop/, (o) => /full stop/.test(o.label)],
      [/final|land|inbound/, (o) => /final/i.test(o.label)],
      [/going around|go around|missed/, (o) => /Going around/.test(o.label)],
      [/descen|lower/, (o) => /descent|lower/i.test(o.label)],
      [/direct/, (o) => /direct/i.test(o.label)],
      [/with you|check(ing)? in|passing|level|climbing/, (o) => /Check in/.test(o.label)],
      [/say again|repeat/, (o) => /Say again/.test(o.label)],
      [/wind/, (o) => /wind check/.test(o.label)],
      [/mayday|emergency|pan.?pan/, (o) => /MAYDAY/.test(o.label)],
    ];
    // a read-back is only chosen when nothing more specific matches a pending request
    let pick = null;
    for (const [re, pred] of kw.slice(1)) { if (re.test(s)) { pick = opts.find(pred); if (pick) break; } }
    if (!pick && kw[0][0].test(s)) pick = opts.find(kw[0][1]);
    return pick || null;
  }
  /** Run an option as the result of a free-text call (the pilot's own words are logged instead). */
  runQuiet(opt, str) {
    this.push({ from: this.cs.text, text: str, kind: 'pilot' });
    this.quietPilot = true;
    try { opt.run(); } finally { this.quietPilot = false; }
  }
  /** Compact situation report for the AI controller. */
  situation() {
    const f = this.f, o = f.fm.out, t = this.tuned(), w = this.f.weather;
    const ap = t && t.ap ? t.ap : this.world.db.nearest(f.fm.pos.x, f.fm.pos.z);
    const d = Math.hypot(ap.c.x - f.fm.pos.x, ap.c.z - f.fm.pos.z) / NM;
    const brg = wrap360(Math.atan2(f.fm.pos.x - ap.c.x, -(f.fm.pos.z - ap.c.z)) * RAD - f.magVar());
    return {
      facility: t ? t.name : 'none', callsign: this.cs.text, aircraft: f.spec.name, phase: this.phase,
      departure: `${this.dep.icao} ${this.dep.spoken}`, destination: `${this.dest.icao} ${this.dest.spoken}`,
      position: o.onGround ? `on the ground at ${ap.icao}` : `${d.toFixed(0)} NM ${['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(brg / 45) % 8]} of ${ap.icao}`,
      altitude_ft: Math.round(o.altFt / 100) * 100, heading: Math.round(f.hdgMag()), speed_kt: Math.round(o.ias),
      assigned: { altitude_ft: this.assigned.alt, heading: this.assigned.hdg, speed_kt: this.assigned.spd, squawk: this.xpdr },
      departure_runway: this.depEnd.id, arrival_runway: this.arrEnd.id,
      wind: compose([WIND(w.windDir - f.magVar(), Math.round(w.windKt), w.gustKt)]).text, altimeter: w.qnh.toFixed(2),
      visibility_sm: Math.min(10, Math.round(w.vis / 1609)),
      last_instruction: this.readback ? (this.lastAtc ? this.lastAtc.text : null) : null,
      recent_radio: this.log.filter((e) => e.kind === 'atc' || e.kind === 'pilot').slice(-5).map((e) => `${e.from}: ${e.text}`),
    };
  }
  async transmitText(str) {
    const t = this.tuned();
    const opts = this.getOptions().filter((o) => !o.label.startsWith('('));
    if (settings.aiAtc && settings.claudeKey && t && t.role !== 'atis') {
      this.pending = true;
      try {
        const { interpretTransmission } = await import('./claude.js');
        const actions = opts.map((o, i) => ({ id: `a${i}`, pilot_says: o.label }));
        const r = await interpretTransmission({ apiKey: settings.claudeKey, model: settings.claudeModel, situation: this.situation(), actions, text: str });
        const i = /^a\d+$/.test(r.action) ? +r.action.slice(1) : -1;
        if (opts[i]) this.runQuiet(opts[i], str);
        else {
          this.push({ from: this.cs.text, text: str, kind: 'pilot' });
          const reply = (r.reply || `${this.cs.text}, say again.`).trim();
          this.atc(t, [part(reply, reply)], { delay: 0.4 });
        }
        return true;
      } catch (err) {
        this.info(`AI ATC unavailable (${err.message}) — using the built-in controller.`);
      } finally { this.pending = false; }
    }
    const pick = this.matchText(str);
    if (pick) { this.runQuiet(pick, str); return true; }
    this.push({ from: this.cs.text, text: str, kind: 'pilot' });
    if (t && t.role !== 'atis') this.atc(t, [this.cs.part, ', ', t.name, ', say again your request.']);
    return false;
  }
}
export { KT };
