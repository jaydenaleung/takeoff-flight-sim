// In-flight interface: instrument panel (PFD, engine display, MCP, ND), radio panel,
// annunciators, fighter HUD and the map overlay.
import { drawPFD } from './pfd.js';
import { drawND, ND_RANGES } from './nd.js';
import { drawEICAS } from './eicas.js';
import { drawFighterHUD } from './fighterHud.js';
import { KT, FT, NM, DEG, clamp, wrap360 } from '../core/units.js';
import { isa } from '../physics/atmosphere.js';
import { settings } from '../core/settings.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class HUD {
  constructor(app, root) {
    this.app = app;
    this.root = el('div', 'hud');
    this.root.style.display = 'none';
    root.appendChild(this.root);
    this.root.innerHTML = `
      <div class="radiopanel">
        <div class="radio">
          <div class="com"><span class="lbl">COM1</span><span class="act" title="Active frequency"></span><button class="swap" title="Swap active / standby (Tab)">⇄</button><span class="stby" title="Standby — scroll to tune, Shift for MHz"></span></div>
          <div class="fac"></div>
          <div class="presets"></div>
          <div class="xpdr"></div>
        </div>
        <div class="log"></div>
        <div class="opts"></div>
        <div class="tx"><input type="text" maxlength="200" placeholder="Enter: type a radio call" /><button class="mic" title="Hold Space to talk">PTT</button></div>
      </div>
      <div class="msgs"></div>
      <div class="warn"></div>
      <div class="status"></div>
      <div class="card"></div>
      <div class="panel">
        <canvas class="pfd" width="600" height="600"></canvas>
        <div class="mid">
          <canvas class="eicas" width="640" height="320"></canvas>
          <div class="mcp">
            <button data-b="at" title="Autothrottle (X)">A/T</button>
            <div class="knob" data-k="spd"><label>SPD</label><span></span></div>
            <button data-b="mach" title="IAS / Mach">M</button>
            <div class="knob" data-k="hdg"><label>HDG</label><span></span></div>
            <button data-b="hdgsel">HDG</button>
            <button data-b="nav" title="Direct to destination">NAV</button>
            <div class="knob" data-k="alt"><label>ALT</label><span></span></div>
            <div class="knob" data-k="vs"><label>V/S</label><span></span></div>
            <button data-b="vs">V/S</button>
            <button data-b="app" title="Arm approach: localizer + glideslope (V)">APP</button>
            <button data-b="ap" title="Autopilot (Z)">A/P</button>
          </div>
        </div>
        <canvas class="nd" width="600" height="600"></canvas>
      </div>
      <canvas class="fhud"></canvas>
      <div class="bigmap"><canvas width="1000" height="1000"></canvas><div class="hint">N to close · scroll to zoom</div></div>`;
    const q = (s) => this.root.querySelector(s);
    this.e = {
      act: q('.com .act'), stby: q('.com .stby'), fac: q('.fac'), presets: q('.presets'), xpdr: q('.xpdr'),
      log: q('.log'), opts: q('.opts'), tx: q('.tx input'), mic: q('.mic'), msgs: q('.msgs'), warn: q('.warn'),
      status: q('.status'), card: q('.card'), pfd: q('.pfd'), eicas: q('.eicas'), nd: q('.nd'), fhud: q('.fhud'),
      mcp: q('.mcp'), big: q('.bigmap'), bigCanvas: q('.bigmap canvas'), panel: q('.panel'),
    };
    this.g = { pfd: this.e.pfd.getContext('2d'), eicas: this.e.eicas.getContext('2d'), nd: this.e.nd.getContext('2d'), fhud: this.e.fhud.getContext('2d'), big: this.e.bigCanvas.getContext('2d') };
    this.range = 3;        // index into ND_RANGES
    this.bigRange = 6;
    this.frame = 0;
    this.msgs = [];
    this.lastOpts = '';
    this.trend = 0; this.lastIas = 0;
    this.visible = true;
    this.bind();
  }

  bind() {
    const e = this.e;
    this.root.querySelector('.swap').onclick = () => { this.atc?.swap(); this.app.sound.click(); };
    e.stby.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (!this.atc) return;
      const step = ev.shiftKey ? 1 : 0.025;
      this.atc.setStandby(this.atc.com.standby + (ev.deltaY < 0 ? step : -step));
    }, { passive: false });
    e.tx.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { const v = e.tx.value.trim(); if (v && this.atc) this.atc.transmitText(v); e.tx.value = ''; e.tx.blur(); ev.stopPropagation(); }
    });
    // MCP
    const steps = { spd: [1, 10], hdg: [1, 10], alt: [100, 1000], vs: [100, 500] };
    this.e.mcp.querySelectorAll('.knob').forEach((k) => {
      const key = k.dataset.k;
      const adj = (dir, big) => {
        const f = this.flight; if (!f) return;
        const s = f.ap.sel, st = steps[key][big ? 1 : 0] * dir;
        if (key === 'spd') { if (s.useMach) s.mach = clamp(Math.round((s.mach + dir * (big ? 0.05 : 0.01)) * 100) / 100, 0.3, f.spec.limits.mmo); else s.spd = clamp(s.spd + st, 100, f.spec.limits.vmo); }
        if (key === 'hdg') s.hdg = wrap360(s.hdg + st);
        if (key === 'alt') s.alt = clamp(Math.round((s.alt + st) / 100) * 100, 0, f.spec.limits.ceiling);
        if (key === 'vs') s.vs = clamp(s.vs + st, -8000, 8000);
      };
      k.addEventListener('wheel', (ev) => { ev.preventDefault(); adj(ev.deltaY < 0 ? 1 : -1, ev.shiftKey); }, { passive: false });
      k.addEventListener('click', (ev) => { const r = k.getBoundingClientRect(); adj(ev.clientX > r.left + r.width / 2 ? 1 : -1, ev.shiftKey); });
      k.title = 'Scroll (or click left/right half) to adjust — Shift for big steps';
    });
    this.e.mcp.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { this.mcpButton(b.dataset.b); this.app.sound.click(); b.blur(); };
    });
    const zoom = (which) => (ev) => {
      ev.preventDefault();
      const d = ev.deltaY > 0 ? 1 : -1;
      if (which === 'nd') this.range = clamp(this.range + d, 0, ND_RANGES.length - 1); else this.bigRange = clamp(this.bigRange + d, 0, ND_RANGES.length - 1);
    };
    e.nd.addEventListener('wheel', zoom('nd'), { passive: false });
    e.nd.addEventListener('click', (ev) => { const r = e.nd.getBoundingClientRect(); this.range = clamp(this.range + (ev.clientX > r.left + r.width / 2 ? 1 : -1), 0, ND_RANGES.length - 1); });
    e.nd.title = 'Scroll or click left/right to change range';
    e.big.addEventListener('wheel', zoom('big'), { passive: false });
  }

  mcpButton(b) {
    const f = this.flight; if (!f) return;
    const ap = f.ap, o = f.fm.out;
    if (b === 'ap') f.toggleAP();
    else if (b === 'at') ap.setAT(!ap.at);
    else if (b === 'mach') {
      const s = ap.sel; s.useMach = !s.useMach;
      if (s.useMach) s.mach = Math.round(clamp(o.mach, 0.3, f.spec.limits.mmo) * 100) / 100; else s.spd = Math.round(o.ias);
    } else if (b === 'hdgsel') { ap.lat = 'HDG'; ap.armed.loc = false; }
    else if (b === 'nav') { if (f.dest) { ap.nav = { x: f.dest.c.x, z: f.dest.c.z, name: f.dest.icao }; ap.lat = 'NAV'; } }
    else if (b === 'vs') { if (ap.vert === 'VS') { ap.vert = 'ALT'; ap.sel.vs = 0; } else { ap.vert = 'VS'; if (ap.sel.vs === 0) ap.sel.vs = Math.round(o.vsFpm / 100) * 100; } }
    else if (b === 'app') this.armApproach();
  }
  armApproach() {
    const f = this.flight, ap = f.ap;
    if (ap.armed.loc || ap.lat === 'LOC') { ap.armed.loc = ap.armed.gs = false; if (ap.lat === 'LOC') ap.lat = 'HDG'; if (ap.vert === 'GS') ap.vert = 'ALT'; this.message('APPROACH MODE CANCELLED', 'info'); return; }
    if (!ap.ils) {
      // tune the ILS of the nearest suitable runway end ahead
      const end = f.arrEnd && f.arrEnd.ils ? f.arrEnd : null;
      if (end) ap.setILS(end.ils);
    }
    if (ap.armApproach()) this.message(`APPROACH ARMED — ILS ${ap.ils.id} ${ap.ils.icao}`, 'info');
    else this.message('NO ILS TUNED (press T to tune the nearest ILS)', 'caution');
  }
  tuneNearestILS() {
    const f = this.flight, p = f.fm.pos, o = f.fm.out;
    let best = null, bs = 1e12;
    for (const ap of this.app.world.db.airports) {
      const d = Math.hypot(ap.c.x - p.x, ap.c.z - p.z);
      if (d > 60 * NM) continue;
      for (const e of ap.ends) {
        if (!e.ils) continue;
        const dx = p.x - e.thr.x, dz = p.z - e.thr.z;
        const along = -(dx * e.dir.x + dz * e.dir.z);
        const hdgErr = Math.abs(((o.hdg - e.hdg + 540) % 360) - 180);
        const score = d + (along < 0 ? 4e4 : 0) + hdgErr * 600;
        if (score < bs) { bs = score; best = e; }
      }
    }
    if (best) { f.ap.setILS(best.ils); f.arrEnd = best; this.message(`ILS ${best.airport.icao} RWY ${best.id} — ${best.ils.freq.toFixed(2)} — CRS ${String(Math.round(best.magHdg)).padStart(3, '0')}°`, 'info'); }
    else this.message('NO ILS WITHIN 60 NM', 'caution');
  }

  start(flight, atc, warnings, traffic) {
    this.flight = flight; this.atc = atc; this.warnings = warnings; this.traffic = traffic;
    this.root.style.display = '';
    this.resize(window.innerWidth, window.innerHeight);
    this.e.log.innerHTML = '';
    this.msgs.length = 0; this.e.msgs.innerHTML = '';
    this.e.card.style.display = 'none';
    this.logCount = 0;
    this.range = flight.fm.out.onGround ? 1 : 4;
    this.root.classList.toggle('fighter', flight.spec.type === 'fighter');
    for (const entry of atc.log) this.addLog(entry);
    atc.onLog = (entry) => this.addLog(entry);
  }
  stop() { this.root.style.display = 'none'; this.flight = null; this.atc = null; }

  addLog(en) {
    const d = el('div', `l ${en.kind}`);
    d.innerHTML = en.from ? `<b>${esc(en.from)}</b> ${esc(en.text)}` : esc(en.text);
    this.e.log.appendChild(d);
    while (this.e.log.children.length > 40) this.e.log.firstChild.remove();
    this.e.log.scrollTop = this.e.log.scrollHeight;
  }
  message(text, level = 'info', ttl = 5) {
    if (this.msgs.some((m) => m.text === text)) return;
    const d = el('div', `m ${level}`, esc(text));
    this.e.msgs.appendChild(d);
    this.msgs.push({ text, d, t: ttl });
    if (this.msgs.length > 4) { const m = this.msgs.shift(); m.d.remove(); }
  }
  showCard(html, ttl = 14) { this.e.card.innerHTML = html; this.e.card.style.display = ''; this.cardT = ttl; }
  toggleBig() { this.e.big.classList.toggle('on'); }
  togglePanel() { this.visible = !this.visible; this.e.panel.style.display = this.visible ? '' : 'none'; this.root.querySelector('.radiopanel').style.display = this.visible ? '' : 'none'; }
  resize(w, h) { this.e.fhud.width = w; this.e.fhud.height = h; }

  update(dt) {
    const f = this.flight; if (!f) return;
    this.frame++;
    const fm = f.fm, o = fm.out, ap = f.ap, s = f.spec, atc = this.atc, app = this.app;
    const view = app.views.mode;
    for (let i = this.msgs.length - 1; i >= 0; i--) { const m = this.msgs[i]; m.t -= dt; if (m.t <= 0) { m.d.remove(); this.msgs.splice(i, 1); } }
    if (this.cardT > 0) { this.cardT -= dt; if (this.cardT <= 0) this.e.card.style.display = 'none'; }
    this.root.classList.toggle('cockpit', view === 'cockpit');

    // ---- radio panel (cheap DOM updates, a few times a second)
    if (this.frame % 6 === 0) {
      const e = this.e, t = atc.tuned();
      e.act.textContent = atc.com.active.toFixed(3);
      e.stby.textContent = atc.com.standby.toFixed(3);
      e.fac.textContent = t ? t.name : 'no station';
      e.fac.classList.toggle('none', !t);
      const ils = ap.ils ? ` · ILS ${ap.ils.id} ${ap.ils.freq.toFixed(2)}` : '';
      e.xpdr.textContent = `XPDR ${atc.xpdr}${ils} · ${atc.cs.code}`;
      const presets = atc.presets();
      const key = presets.map((p) => p.label + p.freq).join('|');
      if (key !== this.presetKey) {
        this.presetKey = key;
        e.presets.innerHTML = '';
        for (const p of presets) {
          const b = el('button', '', esc(p.label.split(' ').pop()));
          b.title = `${p.title} ${p.freq.toFixed(3)} — click: standby, double-click: active`;
          b.onclick = () => { atc.setStandby(p.freq); b.blur(); };
          b.ondblclick = () => { atc.setStandby(p.freq); atc.swap(); b.blur(); };
          e.presets.appendChild(b);
        }
      }
      const opts = atc.getOptions();
      this.opts = opts;
      const okey = opts.map((x) => x.label).join('|');
      if (okey !== this.lastOpts) {
        this.lastOpts = okey;
        e.opts.innerHTML = '';
        opts.slice(0, 8).forEach((op, i) => {
          const b = el('button', op.label.startsWith('(') ? 'dis' : '', `<kbd>F${i + 1}</kbd> ${esc(op.label)}`);
          b.onclick = () => { this.choose(i); b.blur(); };
          e.opts.appendChild(b);
        });
      }
      e.mic.classList.toggle('on', !!app.voice.listening);
      e.mic.style.display = app.voice.canListen ? '' : 'none';

      // MCP read-outs
      const sel = ap.sel, k = (n) => this.e.mcp.querySelector(`[data-k="${n}"] span`), b = (n) => this.e.mcp.querySelector(`[data-b="${n}"]`);
      k('spd').textContent = sel.useMach ? sel.mach.toFixed(2) : String(Math.round(sel.spd));
      k('hdg').textContent = String(Math.round(sel.hdg) % 360).padStart(3, '0');
      k('alt').textContent = String(sel.alt);
      k('vs').textContent = (sel.vs > 0 ? '+' : '') + sel.vs;
      b('ap').classList.toggle('on', ap.on); b('at').classList.toggle('on', ap.at);
      b('mach').classList.toggle('on', sel.useMach);
      b('hdgsel').classList.toggle('on', ap.lat === 'HDG'); b('nav').classList.toggle('on', ap.lat === 'NAV');
      b('vs').classList.toggle('on', ap.vert === 'VS');
      b('app').classList.toggle('on', ap.lat === 'LOC' || ap.vert === 'GS'); b('app').classList.toggle('arm', ap.armed.loc || ap.armed.gs);

      // warnings
      const w = this.warnings.active;
      const wkey = w.map((x) => x.text).join('|');
      if (wkey !== this.wkey) { this.wkey = wkey; e.warn.innerHTML = w.map((x) => `<span class="${x.level}">${esc(x.text)}</span>`).join(''); }

      // status line
      const hr = app.world.env.hour, hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
      const fps = Math.round(app.fps);
      e.status.innerHTML = `<span>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} local</span>${f.timeScale !== 1 ? `<span class="hi">×${f.timeScale}</span>` : ''}<span>${view.toUpperCase()}</span><span>${fps} fps</span><span class="keys">H help · Esc menu</span>`;
    }

    if (!this.visible) return;
    const magVar = f.magVar();
    const hdgMag = wrap360(o.hdg - magVar);
    const ils = f.ils();
    // ---- PFD (every other frame)
    if (this.frame % 2 === 0) {
      const vs = fm.vspeeds();
      this.trend += (((o.ias - this.lastIas) / Math.max(dt * 2, 1e-3)) * 10 - this.trend) * 0.08;
      this.lastIas = o.ias;
      const bugs = [];
      if (o.onGround || o.ra < 1500 && o.vs > 0) { if (s.type !== 'fighter') bugs.push({ n: 'V1', v: vs.v1 / KT }); bugs.push({ n: 'VR', v: vs.vr / KT }, { n: 'V2', v: vs.v2 / KT }); }
      else if (fm.flap > 0.3 || fm.gear > 0.5) bugs.push({ n: 'REF', v: vs.vref / KT });
      const flapNow = fm.flap;
      const vstall = Math.sqrt((2 * fm.mass * 9.80665) / (1.225 * s.wing.area * (s.aero.clMaxClean + (s.aero.clMaxLand - s.aero.clMaxClean) * Math.pow(flapNow, 0.6)))) / KT;
      const vmax = Math.min(s.limits.vmo, fm.flap > 0.05 ? s.limits.vfe + (1 - fm.flap) * 45 : 999, fm.gear > 0.05 ? s.limits.vle : 999, s.limits.mmo * (o.ias / Math.max(o.mach, 0.05)));
      const w = f.weather;
      drawPFD(this.g.pfd, 600, 600, {
        pitch: o.pitch, roll: o.roll, beta: o.beta, ias: o.ias, mach: o.mach, alt: o.altFt + (29.92 - w.qnh) * 0, vs: o.vsFpm, ra: o.ra,
        hdg: hdgMag, track: wrap360(o.track - magVar), onGround: o.onGround, stall: this.warnings.stall,
        selSpd: ap.sel.useMach ? null : ap.sel.spd, selSpdText: ap.sel.useMach ? `M${ap.sel.mach.toFixed(2).slice(1)}` : String(ap.sel.spd),
        selAlt: ap.sel.alt, selHdg: Math.round(ap.sel.hdg) % 360, trend: clamp(this.trend, -40, 40), bugs, vstall, vmax,
        groundAlt: o.ra < 3000 ? o.groundH / FT + s.gear.cgH / FT : null,
        qnh: `${w.qnh.toFixed(2)} IN`, fma: ap.fma, law: f.fcs.direct ? 'DIRECT' : '', prot: f.fcs.protection,
        fd: ap.on ? { pitch: ap.cmd.thetaDot * 2.5, roll: ap.cmd.phi - o.roll } : null,
        ils: ils ? { ...ils, id: `${ap.ils.icao.slice(1)}${ap.ils.id}`, freq: ap.ils.freq } : null,
      });
    }
    // ---- ND
    const ndData = () => ({
      x: fm.pos.x, z: fm.pos.z, hdg: o.hdg, magVar, track: o.track, gs: o.gs, tas: o.tas, alt: o.alt,
      wind: { dir: (Math.atan2(-o.windX, o.windZ) / DEG + 360) % 360, kt: Math.hypot(o.windX, o.windZ) / KT },
      airports: app.world.db.airports, navaids: app.world.db.navaids, dest: f.dest,
      route: ap.nav ? [{ x: fm.pos.x, z: fm.pos.z }, ap.nav] : (f.dest && f.dep && f.dest !== f.dep && !o.onGround ? [f.dep.c, f.dest.c] : null),
      ils: ap.ils, selHdg: ap.sel.hdg, traffic: this.traffic ? this.traffic.list : [], taxi: o.onGround ? f.taxiRoute : null, onGround: o.onGround,
    });
    if (this.frame % 3 === 1) drawND(this.g.nd, 600, 600, { ...ndData(), range: ND_RANGES[this.range] });
    if (this.e.big.classList.contains('on') && this.frame % 3 === 2) drawND(this.g.big, 1000, 1000, { ...ndData(), range: ND_RANGES[this.bigRange], big: true });
    // ---- EICAS
    if (this.frame % 4 === 3) {
      const atm = isa(o.alt, f.weather.dT);
      drawEICAS(this.g.eicas, 640, 320, {
        engines: fm.engines, fighter: s.type === 'fighter', fuel: fm.fuel, fuelMax: s.mass.fuel, mass: fm.mass, mtow: s.mass.mtow,
        flap: fm.flap, flapName: s.flaps[fm.ctl.flapIdx][0], flapMoving: Math.abs(fm.flap - s.flaps[fm.ctl.flapIdx][1]) > 0.005,
        gear: fm.gear, spoiler: fm.spoiler, spoilerArmed: fm.ctl.spoilerArmed, parkBrake: fm.ctl.parkBrake, brake: fm.ctl.brake,
        autobrake: ap.autobrake, thrLever: fm.ctl.throttle, sat: atm.T - 273.15,
      });
    }
    // ---- fighter HUD
    const showHud = s.type === 'fighter' && view === 'cockpit';
    this.e.fhud.style.display = showHud ? '' : 'none';
    if (showHud) {
      drawFighterHUD(this.g.fhud, this.e.fhud.width, this.e.fhud.height, {
        pitch: o.pitch, roll: o.roll, alpha: o.alpha, beta: o.beta, ias: o.ias, alt: o.altFt, hdg: hdgMag, mach: o.mach, g: o.nz,
        vs: o.vsFpm, ra: o.ra, fovDeg: app.world.camera.fov, gear: fm.gear > 0.5, ab: fm.engines.some((e) => e.ab > 0.05),
        ap: ap.on ? `AP ${ap.fma.lat} ${ap.fma.vert}` : '', ils,
        bottom: this.visible ? this.e.fhud.height - this.e.panel.getBoundingClientRect().height - 14 : this.e.fhud.height,
      });
    }
  }
  choose(i) {
    if (!this.atc) return;
    // always act on the options as they are right now, not as last drawn
    const op = this.atc.getOptions()[i];
    if (op && !op.label.startsWith('(')) { op.run(); this.lastOpts = ''; this.app.sound.click(); }
  }
}
export { settings };
