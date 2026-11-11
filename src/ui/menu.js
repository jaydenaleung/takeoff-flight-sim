// Main menu: hangar with a live 3D preview and spec sheet, flight setup and settings.
import * as THREE from 'three';
import { AIRCRAFT, AIRCRAFT_BY_ID } from '../aircraft/specs.js';
import { AircraftModel } from '../aircraft/model.js';
import { WEATHER_PRESETS } from '../physics/atmosphere.js';
import { AIRLINES, TACTICAL, makeCallsign } from '../atc/phraseology.js';
import { settings, saveSettings } from '../core/settings.js';
import { NM } from '../core/units.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class Menu {
  constructor(app, root) {
    this.app = app;
    this.root = el('div', 'menu');
    this.root.style.display = 'none';
    root.appendChild(this.root);
    this.sel = AIRCRAFT_BY_ID[settings.aircraft] ? settings.aircraft : 'b738';
    this.angle = 0.6;
    this.model = null;
    // hangar scene rendered behind the menu
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1826);
    this.scene.fog = new THREE.Fog(0x0e1826, 180, 520);
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x29303a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 3.0);
    key.position.set(-80, 140, -60); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 500 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb6ff, 1.2); rim.position.set(90, 40, 80); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(520, 64), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.82, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.floor = floor;
    this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.build();
  }

  build() {
    const db = () => this.app.world.db;
    this.root.innerHTML = `
      <header><div class="brand"><h1>TAKEOFF</h1><span>Flight Simulator</span></div>
        <div class="hbtn"><button class="b-help">Controls</button><button class="b-set">Settings</button></div></header>
      <aside class="fleet"></aside>
      <section class="sheet"></section>
      <section class="setup">
        <h3>Flight plan</h3>
        <label>Departure<select class="s-dep"></select></label>
        <label>Destination<select class="s-dest"></select></label>
        <div class="route"></div>
        <label>Start<select class="s-start">
          <option value="gate">At the gate (full ATC flight)</option>
          <option value="runway">On the runway, ready for take-off</option>
          <option value="final">10 nm final approach</option>
          <option value="cruise">In cruise, autopilot on</option></select></label>
        <div class="row2">
          <label class="cs-al">Call sign<select class="s-airline"></select></label>
          <label>Flight no.<input class="s-num" type="text" maxlength="4" inputmode="numeric" placeholder="auto"></label>
        </div>
        <div class="csprev"></div>
        <h3>Loading</h3>
        <label>Fuel <output class="o-fuel"></output><input class="s-fuel" type="range" min="0.08" max="1" step="0.01"></label>
        <label>Payload <output class="o-pay"></output><input class="s-pay" type="range" min="0" max="1" step="0.01"></label>
        <div class="weights"></div>
        <h3>Conditions</h3>
        <label>Time of day <output class="o-hour"></output><input class="s-hour" type="range" min="0" max="23.75" step="0.25"></label>
        <label>Weather<select class="s-wx"></select></label>
        <button class="fly">FLY</button>
        <p class="note">For entertainment only — not for real-world navigation.</p>
      </section>
      <footer>Real terrain: Mapzen/AWS Terrain Tiles · Land colour: Natural Earth · Airports: OurAirports</footer>
      <div class="modal settings"><div class="box">
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
      fuel: q('.s-fuel'), pay: q('.s-pay'), hour: q('.s-hour'), wx: q('.s-wx'), route: q('.route'), weights: q('.weights'), csprev: q('.csprev'),
      oFuel: q('.o-fuel'), oPay: q('.o-pay'), oHour: q('.o-hour'), settings: q('.settings'),
    };
    // fleet list
    const groups = [['Boeing', (a) => a.maker === 'Boeing' && a.type === 'airliner'], ['Airbus', (a) => a.maker === 'Airbus'], ['Fighters', (a) => a.type === 'fighter']];
    for (const [title, pred] of groups) {
      this.e.fleet.appendChild(el('h4', '', title));
      for (const a of AIRCRAFT.filter(pred)) {
        const b = el('button', 'ac', `<b>${a.name}</b><small>${a.role}</small>`);
        b.dataset.id = a.id;
        b.onclick = () => this.select(a.id);
        this.e.fleet.appendChild(b);
      }
    }
    for (const [k, w] of Object.entries(WEATHER_PRESETS)) this.e.wx.appendChild(new Option(w.name, k));
    q('.fly').onclick = () => this.fly();
    q('.b-set').onclick = () => this.openSettings();
    q('.b-help').onclick = () => this.app.ui.showHelp();
    q('.g-close').onclick = () => this.closeSettings();
    q('.g-clear').onclick = () => { q('.g-key').value = ''; settings.claudeKey = ''; settings.aiAtc = false; q('.g-ai').checked = false; saveSettings(); };
    for (const k of ['dep', 'dest', 'start', 'airline', 'num', 'fuel', 'pay', 'hour', 'wx']) this.e[k].addEventListener('input', () => this.refresh());
    this.e.hour.addEventListener('input', () => this.app.world.env.setTime(+this.e.hour.value));
    this.dbReady = false;
    this._db = db;
  }

  fillAirports() {
    if (this.dbReady) return;
    this.dbReady = true;
    const db = this._db();
    for (const s of [this.e.dep, this.e.dest]) {
      const civ = el('optgroup'); civ.label = 'Civil airports';
      const mil = el('optgroup'); mil.label = 'Military airfields';
      for (const a of db.airports) (a.military ? mil : civ).appendChild(new Option(`${a.icao} — ${a.name.replace(/ (International |Regional |Municipal )?Airport.*/, '')}`, a.icao));
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
    this.select(this.sel);
  }
  hide() { this.root.style.display = 'none'; if (this.model) { this.scene.remove(this.model.group); this.model.dispose(); this.model = null; } }

  select(id) {
    this.sel = id;
    const spec = AIRCRAFT_BY_ID[id];
    this.root.querySelectorAll('.ac').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    if (this.model) { this.scene.remove(this.model.group); this.model.dispose(); }
    this.model = new AircraftModel(spec, { detail: 1 });
    this.model.group.position.y = spec.gear.cgH;
    this.scene.add(this.model.group);
    const d = spec.dims, m = spec.mass, e = spec.eng, l = spec.limits;
    const thrust = e.abThrust ? `${(e.thrust / 1000).toFixed(1)} kN dry / ${(e.abThrust / 1000).toFixed(0)} kN afterburner` : `${(e.thrust / 1000).toFixed(1)} kN each`;
    this.e.sheet.innerHTML = `
      <div class="mk">${spec.maker}</div><h2>${spec.name}</h2><p class="role">${spec.role}</p>
      <table>
        <tr><th>Length</th><td>${d.length.toFixed(2)} m</td><th>Wingspan</th><td>${d.span.toFixed(2)} m</td></tr>
        <tr><th>Height</th><td>${d.height.toFixed(2)} m</td><th>Wing area</th><td>${spec.wing.area} m²</td></tr>
        <tr><th>Empty</th><td>${fmt(m.oew)} kg</td><th>Max take-off</th><td>${fmt(m.mtow)} kg</td></tr>
        <tr><th>Fuel</th><td>${fmt(m.fuel)} kg</td><th>Ceiling</th><td>${fmt(l.ceiling)} ft</td></tr>
        <tr><th>Engines</th><td colspan="3">${e.count} × ${e.model} — ${thrust}</td></tr>
        <tr><th>Max speed</th><td>Mach ${l.mmo}</td><th>Load limit</th><td>+${l.gPos} / ${l.gNeg} g</td></tr>
        <tr><th>Controls</th><td colspan="3">${{ fbw: 'Fly-by-wire with envelope protection', conventional: 'Conventional with stability augmentation', fighter: 'Fly-by-wire, g-command with AoA limiter' }[spec.ctl.law]}</td></tr>
      </table>`;
    // call sign choices depend on the type
    const fighter = spec.type === 'fighter';
    const cur = this.e.airline.value || settings.airline;
    this.e.airline.innerHTML = '';
    if (fighter) for (const t of TACTICAL) this.e.airline.appendChild(new Option(t, t));
    else for (const a of AIRLINES) this.e.airline.appendChild(new Option(`${a.tel} (${a.icao})`, a.icao));
    const def = fighter ? { f16: 'Viper', f18: 'Hornet', f22: 'Raptor', f35: 'Lightning' }[id] : (AIRLINES.some((a) => a.icao === cur) ? cur : 'UAL');
    this.e.airline.value = [...this.e.airline.options].some((o) => o.value === cur) && (fighter ? TACTICAL.includes(cur) : true) ? cur : def;
    this.refresh();
  }

  refresh() {
    const spec = AIRCRAFT_BY_ID[this.sel], db = this._db();
    const dep = db.byIcao[this.e.dep.value], dest = db.byIcao[this.e.dest.value];
    if (dep && dest) {
      const dnm = Math.hypot(dest.c.x - dep.c.x, dest.c.z - dep.c.z) / NM;
      const rw = (a) => a.runways.map((r) => r.id).join(' · ');
      this.e.route.innerHTML = dep === dest
        ? `<b>Local flight</b> — circuits or radar vectors back to ${dep.icao}<br><small>Runways ${rw(dep)}</small>`
        : `<b>${dnm.toFixed(0)} NM</b> · about ${Math.max(10, Math.round((dnm / (spec.type === 'fighter' ? 520 : 440)) * 60 + 14))} min<br><small>${dep.icao} ${rw(dep)}<br>${dest.icao} ${rw(dest)}</small>`;
    }
    const fuel = +this.e.fuel.value, pay = +this.e.pay.value;
    const mass = spec.mass.oew + spec.mass.fuel * fuel + spec.mass.payload * pay;
    this.e.oFuel.textContent = `${fmt(spec.mass.fuel * fuel)} kg`;
    this.e.oPay.textContent = `${fmt(spec.mass.payload * pay)} kg`;
    this.e.weights.innerHTML = `Gross weight <b>${fmt(mass)} kg</b> <span class="${mass > spec.mass.mtow ? 'bad' : ''}">(${Math.round((mass / spec.mass.mtow) * 100)}% of MTOW)</span>`;
    const h = +this.e.hour.value;
    this.e.oHour.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    const cs = makeCallsign(spec, this.e.airline.value, this.e.num.value);
    this.e.csprev.innerHTML = `On the radio: <b>“${cs.text}”</b>`;
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
    this.angle += dt * 0.22;
    const spec = AIRCRAFT_BY_ID[this.sel];
    const size = Math.max(spec.dims.length, spec.dims.span);
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const dist = size * 2.5, el2 = 0.2;
    // the model sits left of centre so the setup column does not cover it
    const cx = size * 0.16;
    this.camera.position.set(Math.sin(this.angle) * Math.cos(el2) * dist + cx * Math.cos(this.angle), Math.sin(el2) * dist + spec.dims.height * 0.3, -Math.cos(this.angle) * Math.cos(el2) * dist + cx * Math.sin(this.angle));
    this.camera.lookAt(cx * Math.cos(this.angle), spec.dims.height * 0.36, cx * Math.sin(this.angle));
    this.model.update({ elev: 0, ail: 0, rud: 0, flap: 0.25 + 0.25 * Math.sin(this.angle * 0.7), gear: 1, spoiler: 0, n1: 22, ab: 0, lights: { nav: true, beacon: true, strobe: true, landing: false }, camDist: dist }, dt);
    const exp = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 0.85;
    renderer.render(this.scene, this.camera);
    renderer.toneMappingExposure = exp;
  }
}
