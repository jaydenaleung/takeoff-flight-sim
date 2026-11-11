// Main menu, styled as a dispatch desk: a fleet board, a type sheet with a three-view drawing and
// a flight release in the form of a boarding pass. The backdrop is the live simulator world,
// with the chosen aircraft lined up on the departure runway at the chosen time and weather.
import * as THREE from 'three';
import { AIRCRAFT, AIRCRAFT_BY_ID } from '../aircraft/specs.js';
import { AircraftModel } from '../aircraft/model.js';
import { Weather, WEATHER_PRESETS } from '../physics/atmosphere.js';
import { AIRLINES, TACTICAL, makeCallsign } from '../atc/phraseology.js';
import { settings, saveSettings } from '../core/settings.js';
import { NM, DEG } from '../core/units.js';
import { drawThreeView } from './threeView.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const _e = new THREE.Euler();
const LAW = { fbw: 'Fly-by-wire, envelope protection', conventional: 'Conventional, stability augmentation', fighter: 'Fly-by-wire, g command' };

export class Menu {
  constructor(app, root) {
    this.app = app;
    this.root = el('div', 'menu');
    this.root.style.display = 'none';
    root.appendChild(this.root);
    this.sel = AIRCRAFT_BY_ID[settings.aircraft] ? settings.aircraft : 'b738';
    this.angle = 2.5;
    this.model = null;
    this.weather = new Weather(WEATHER_PRESETS[settings.weather] ? settings.weather : 'scattered');
    this.target = new THREE.Vector3();
    this.ready = false;
    this.build();
  }

  build() {
    this.root.innerHTML = `
      <header class="m-top">
        <div class="wordmark"><b>TAKEOFF</b><i>Flight Simulator</i></div>
        <nav><button class="link b-help">Controls</button><button class="link b-set">Settings</button></nav>
      </header>
      <aside class="board">
        <div class="board-h"><span>Fleet</span><span>12 types</span></div>
        <div class="fleet"></div>
      </aside>
      <section class="sheet"></section>
      <section class="pass">
        <div class="pass-h"><span>Flight release</span><b class="p-code"></b></div>
        <div class="pass-route">
          <label><small>From</small><b class="p-dep"></b><select class="s-dep"></select></label>
          <span class="arrow"></span>
          <label><small>To</small><b class="p-dest"></b><select class="s-dest"></select></label>
        </div>
        <div class="route"></div>
        <div class="grid">
          <label class="wide"><small>Start</small><select class="s-start">
            <option value="gate">At the gate — full ATC flight</option>
            <option value="runway">On the runway, ready for take-off</option>
            <option value="final">10 nm final approach</option>
            <option value="cruise">In cruise, autopilot on</option></select></label>
          <label><small>Call sign</small><select class="s-airline"></select></label>
          <label><small>Flight no.</small><input class="s-num" type="text" maxlength="4" inputmode="numeric" placeholder="auto"></label>
          <label><small>Fuel <output class="o-fuel"></output></small><input class="s-fuel" type="range" min="0.08" max="1" step="0.01"></label>
          <label><small>Payload <output class="o-pay"></output></small><input class="s-pay" type="range" min="0" max="1" step="0.01"></label>
          <label><small>Local time <output class="o-hour"></output></small><input class="s-hour" type="range" min="0" max="23.75" step="0.25"></label>
          <label><small>Weather</small><select class="s-wx"></select></label>
        </div>
        <div class="weights"></div>
        <div class="stub">
          <div class="barcode" aria-hidden="true"></div>
          <button class="fly"><span>FLY<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 19 5M8.5 4.5H19.5V15.5" fill="none" stroke="#111" stroke-width="3.6" stroke-linecap="square"/></svg></span></button>
        </div>
        <p class="note">For entertainment only — not for real-world navigation.</p>
      </section>
      <footer>Terrain: Mapzen / AWS Terrain Tiles · Land colour: Natural Earth · Airports: OurAirports</footer>
      <div class="modal settings"><div class="box form">
        <h2>Settings</h2>
        <label>Graphics quality<select class="g-quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select><small>Applies after reloading the page.</small></label>
        <label>Master volume<input class="g-vol" type="range" min="0" max="1" step="0.05"></label>
        <label>Radio voice volume<input class="g-vvol" type="range" min="0" max="1" step="0.05"></label>
        <label class="chk"><input class="g-atcv" type="checkbox"> Speak ATC transmissions</label>
        <label class="chk"><input class="g-pilv" type="checkbox"> Speak my own transmissions</label>
        <label class="chk"><input class="g-dmg" type="checkbox"> Realistic damage (over-g, overspeed, hard landings)</label>
        <label class="chk"><input class="g-auto" type="checkbox"> Swap to the new frequency automatically on hand-off</label>
        <h3>AI ATC (optional)</h3>
        <p class="small">With an Anthropic API key, Claude understands free-form typed or spoken radio calls. The key is stored only in this browser and sent only to api.anthropic.com. Without a key the built-in controller is used.</p>
        <label class="chk"><input class="g-ai" type="checkbox"> Use Claude for free-text and voice transmissions</label>
        <label>Anthropic API key<input class="g-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"></label>
        <label>Model<select class="g-model">
          <option value="claude-opus-5-5">Claude Opus 5.5 (most capable)</option>
          <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
          <option value="claude-haiku-5-5">Claude Haiku 5.5 (fastest, lowest cost)</option></select></label>
        <div class="btns"><button class="g-clear">Forget key</button><button class="g-close primary">Done</button></div>
      </div></div>`;
    const q = (s) => this.root.querySelector(s);
    this.e = {
      fleet: q('.fleet'), sheet: q('.sheet'), dep: q('.s-dep'), dest: q('.s-dest'), start: q('.s-start'), airline: q('.s-airline'), num: q('.s-num'),
      fuel: q('.s-fuel'), pay: q('.s-pay'), hour: q('.s-hour'), wx: q('.s-wx'), route: q('.route'), weights: q('.weights'),
      oFuel: q('.o-fuel'), oPay: q('.o-pay'), oHour: q('.o-hour'), settings: q('.settings'), pDep: q('.p-dep'), pDest: q('.p-dest'), pCode: q('.p-code'),
      barcode: q('.barcode'),
    };
    const groups = [['Boeing', (a) => a.maker === 'Boeing' && a.type === 'airliner'], ['Airbus', (a) => a.maker === 'Airbus'], ['Fighters', (a) => a.type === 'fighter']];
    for (const [title, pred] of groups) {
      this.e.fleet.appendChild(el('h4', '', title));
      for (const a of AIRCRAFT.filter(pred)) {
        const b = el('button', 'ac', `<span class="code">${a.icao}</span><span class="nm">${a.name}</span><span class="rl">${a.role}</span>`);
        b.dataset.id = a.id;
        b.onclick = () => this.select(a.id);
        this.e.fleet.appendChild(b);
      }
    }
    for (const [k, w] of Object.entries(WEATHER_PRESETS)) this.e.wx.appendChild(new Option(w.name, k));
    // decorative barcode, stable per page load
    let bars = '';
    for (let i = 0, x = 0; x < 100; i++) { const w = 0.6 + ((i * 7919) % 5) * 0.55; bars += `<i style="left:${x}%;width:${w}%"></i>`; x += w + 0.5 + ((i * 104729) % 3) * 0.6; }
    this.e.barcode.innerHTML = bars;
    q('.fly').onclick = () => this.fly();
    q('.b-set').onclick = () => this.openSettings();
    q('.b-help').onclick = () => this.app.ui.showHelp();
    q('.g-close').onclick = () => this.closeSettings();
    q('.g-clear').onclick = () => { q('.g-key').value = ''; settings.claudeKey = ''; settings.aiAtc = false; q('.g-ai').checked = false; saveSettings(); };
    for (const k of ['dep', 'dest', 'start', 'airline', 'num', 'fuel', 'pay', 'hour', 'wx']) this.e[k].addEventListener('input', () => this.refresh());
    this.e.hour.addEventListener('input', () => this.app.world.env.setTime(+this.e.hour.value));
    this.e.wx.addEventListener('input', () => { this.weather.set(this.e.wx.value); this.place(); });
    this.e.dep.addEventListener('input', () => this.place());
    window.addEventListener('resize', () => { if (this.root.style.display !== 'none') this.drawSheet(); });
  }

  fillAirports() {
    if (this.ready) return;
    this.ready = true;
    const db = this.app.world.db;
    for (const s of [this.e.dep, this.e.dest]) {
      const civ = el('optgroup'); civ.label = 'Civil airports';
      const mil = el('optgroup'); mil.label = 'Military airfields';
      for (const a of db.airports) (a.military ? mil : civ).appendChild(new Option(`${a.icao}  ${a.name.replace(/ (International |Regional |Municipal )?Airport.*/, '')}`, a.icao));
      s.append(civ, mil);
    }
    this.e.dep.value = db.byIcao[settings.dep] ? settings.dep : 'KSFO';
    this.e.dest.value = db.byIcao[settings.dest] ? settings.dest : 'KLAX';
    this.e.start.value = settings.start;
    this.e.fuel.value = settings.fuel; this.e.pay.value = settings.payload;
    this.e.hour.value = settings.hour; this.e.wx.value = settings.weather;
    this.e.num.value = settings.flightNo || '';
  }

  show() {
    this.fillAirports();
    this.root.style.display = '';
    this.app.world.env.setTime(+this.e.hour.value);
    this.weather.set(this.e.wx.value);
    this.select(this.sel);
  }
  hide() {
    this.root.style.display = 'none';
    this.dropModel();
    this.app.world.camera.clearViewOffset();
  }
  dropModel() {
    if (!this.model) return;
    this.app.world.scene.remove(this.model.group);
    this.model.dispose();
    this.model = null;
  }

  select(id) {
    this.sel = id;
    const spec = AIRCRAFT_BY_ID[id];
    this.root.querySelectorAll('.ac').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    this.dropModel();
    this.model = new AircraftModel(spec, { detail: 1 });
    this.app.world.scene.add(this.model.group);
    this.place();
    const d = spec.dims, m = spec.mass, e = spec.eng, l = spec.limits;
    const thrust = e.abThrust ? `${(e.thrust / 1000).toFixed(0)} kN dry · ${(e.abThrust / 1000).toFixed(0)} kN reheat` : `${(e.thrust / 1000).toFixed(1)} kN each`;
    this.e.sheet.innerHTML = `
      <div class="sheet-h"><div><div class="mk">${spec.maker}</div><h2>${spec.name}</h2><p class="role">${spec.role}</p></div><div class="tag">${spec.icao}</div></div>
      <canvas class="tv"></canvas>
      <dl class="facts">
        <div><dt>Engines</dt><dd>${e.count} × ${e.model}</dd></div>
        <div><dt>Thrust</dt><dd>${thrust}</dd></div>
        <div><dt>Max take-off</dt><dd>${fmt(m.mtow)} kg</dd></div>
        <div><dt>Empty</dt><dd>${fmt(m.oew)} kg</dd></div>
        <div><dt>Wing area</dt><dd>${spec.wing.area} m²</dd></div>
        <div><dt>Max speed</dt><dd>Mach ${l.mmo}</dd></div>
        <div><dt>Ceiling</dt><dd>${fmt(l.ceiling)} ft</dd></div>
        <div><dt>Limit load</dt><dd>+${l.gPos} / ${l.gNeg} g</dd></div>
        <div class="wide"><dt>Flight controls</dt><dd>${LAW[spec.ctl.law]}</dd></div>
      </dl>`;
    this.drawSheet();
    // call sign choices depend on the type
    const fighter = spec.type === 'fighter';
    const cur = this.e.airline.value || settings.airline;
    this.e.airline.innerHTML = '';
    if (fighter) for (const t of TACTICAL) this.e.airline.appendChild(new Option(t, t));
    else for (const a of AIRLINES) this.e.airline.appendChild(new Option(`${a.tel} (${a.icao})`, a.icao));
    const ok = [...this.e.airline.options].some((o) => o.value === cur);
    this.e.airline.value = ok ? cur : fighter ? { f16: 'Viper', f18: 'Hornet', f22: 'Raptor', f35: 'Lightning' }[id] : 'UAL';
    this.refresh();
  }
  drawSheet() {
    const c = this.e.sheet.querySelector('.tv');
    if (!c) return;
    const draw = () => { try { drawThreeView(c, AIRCRAFT_BY_ID[this.sel]); } catch (err) { console.warn('three-view unavailable', err); } };
    if (document.fonts && document.fonts.load) document.fonts.load('11px "B612 Mono"').then(draw, draw); else draw();
  }

  /** Line the preview aircraft up on the departure runway. */
  place() {
    if (!this.model) return;
    const world = this.app.world, spec = AIRCRAFT_BY_ID[this.sel];
    const ap = world.db.byIcao[this.e.dep.value] || world.db.byIcao.KSFO;
    const end = ap.activeEnds(this.weather.windDir, this.weather.windKt)[0];
    const d = (end.displaced || 0) + 70 + this.model.geo.cgX;
    const g = this.model.group;
    g.position.set(end.x + end.dir.x * d, ap.elev + spec.gear.cgH, end.z + end.dir.z * d);
    g.quaternion.setFromEuler(_e.set(0, -end.hdg * DEG, 0, 'YXZ'));
    this.hdg = end.hdg;
    world.env.groundRef = ap.elev;
  }

  refresh() {
    const spec = AIRCRAFT_BY_ID[this.sel], db = this.app.world.db;
    const dep = db.byIcao[this.e.dep.value], dest = db.byIcao[this.e.dest.value];
    const code = (a) => (a.icao[0] === 'K' ? a.icao.slice(1) : a.icao);
    if (dep && dest) {
      this.e.pDep.textContent = code(dep); this.e.pDest.textContent = code(dest);
      const w = this.weather;
      const r0 = dep.activeEnds(w.windDir, w.windKt)[0];
      const arr = dest.activeEnds(w.windDir, w.windKt);
      const r1 = arr.find((x) => x.ils) || arr[0];
      const dnm = Math.hypot(dest.c.x - dep.c.x, dest.c.z - dep.c.z) / NM;
      const min = Math.max(10, Math.round((dnm / (spec.type === 'fighter' ? 520 : 440)) * 60 + 14));
      this.e.route.innerHTML = dep === dest
        ? `<span>Local flight</span><span>RWY ${r0.id}</span><span>circuits or vectors</span>`
        : `<span>${dnm.toFixed(0)} NM</span><span>${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}</span><span>RWY ${r0.id} → ${r1.id}</span>`;
    }
    const fuel = +this.e.fuel.value, pay = +this.e.pay.value;
    const mass = spec.mass.oew + spec.mass.fuel * fuel + spec.mass.payload * pay;
    this.e.oFuel.textContent = `${fmt(spec.mass.fuel * fuel)} kg`;
    this.e.oPay.textContent = `${fmt(spec.mass.payload * pay)} kg`;
    const pct = Math.round((mass / spec.mass.mtow) * 100);
    this.e.weights.innerHTML = `<span>Gross weight</span><b>${fmt(mass)} kg</b><span class="${pct > 100 ? 'bad' : ''}">${pct}% MTOW</span>`;
    const h = +this.e.hour.value;
    this.e.oHour.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    const cs = makeCallsign(spec, this.e.airline.value, this.e.num.value);
    this.e.pCode.textContent = cs.text;
  }

  fly() {
    Object.assign(settings, { airline: this.e.airline.value, flightNo: this.e.num.value.replace(/\D/g, '') });
    saveSettings();
    this.app.sound.init();
    this.hide();
    this.app.startFlight({
      aircraft: this.sel, dep: this.e.dep.value, dest: this.e.dest.value, start: this.e.start.value,
      hour: +this.e.hour.value, weather: this.e.wx.value, fuel: +this.e.fuel.value, payload: +this.e.pay.value,
    });
  }

  openSettings() {
    const q = (s) => this.root.querySelector(s);
    q('.g-quality').value = settings.quality; q('.g-vol').value = settings.masterVol; q('.g-vvol').value = settings.voiceVol;
    q('.g-atcv').checked = settings.atcVoice; q('.g-pilv').checked = settings.pilotVoice; q('.g-dmg').checked = settings.damage;
    q('.g-auto').checked = settings.autoTune; q('.g-ai').checked = settings.aiAtc; q('.g-key').value = settings.claudeKey; q('.g-model').value = settings.claudeModel;
    this.e.settings.classList.add('on');
  }
  closeSettings() {
    const q = (s) => this.root.querySelector(s);
    Object.assign(settings, {
      quality: q('.g-quality').value, masterVol: +q('.g-vol').value, voiceVol: +q('.g-vvol').value, atcVoice: q('.g-atcv').checked,
      pilotVoice: q('.g-pilv').checked, damage: q('.g-dmg').checked, autoTune: q('.g-auto').checked,
      claudeKey: q('.g-key').value.trim(), claudeModel: q('.g-model').value,
    });
    settings.aiAtc = q('.g-ai').checked && !!settings.claudeKey;
    saveSettings();
    this.e.settings.classList.remove('on');
  }

  update(dt, renderer) {
    if (!this.model) return;
    const world = this.app.world, cam = world.camera, spec = AIRCRAFT_BY_ID[this.sel];
    this.angle += dt * 0.07;
    const size = Math.max(spec.dims.length, spec.dims.span);
    const w = window.innerWidth, h = window.innerHeight;
    const p = this.model.group.position;
    this.target.set(p.x, p.y + spec.dims.height * 0.2, p.z);
    // a slow, low orbit; the frame is shifted so the aircraft sits between the panels
    const a = this.hdg * DEG + this.angle, dist = size * 2.45, elev = 0.1 + 0.05 * Math.sin(this.angle * 0.9);
    if (cam.fov !== 30) { cam.fov = 30; cam.near = 1.2; cam.updateProjectionMatrix(); }
    cam.setViewOffset(w, h, w > 1100 ? 55 : 0, h * 0.23, w, h);
    cam.position.set(this.target.x + Math.sin(a) * Math.cos(elev) * dist, this.target.y + Math.sin(elev) * dist, this.target.z - Math.cos(a) * Math.cos(elev) * dist);
    const gh = world.elevation(cam.position.x, cam.position.z) + 1.2;
    if (cam.position.y < gh) cam.position.y = gh;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    this.weather.update(dt);
    if (world.env.envTexture) this.model.setEnvironment(world.env.envTexture, world.env.envIntensity);
    const night = world.env.day < 0.4;
    this.model.update({ elev: 0, ail: 0, rud: 0, flap: spec.flaps[spec.toFlap][1], gear: 1, spoiler: 0, n1: 22, ab: 0, lights: { nav: true, beacon: true, strobe: true, landing: night }, camDist: dist }, dt);
    world.nearGround = true;
    world.update(dt, this.weather, this.target, size * 0.75);
    renderer.render(world.scene, cam);
  }
}
