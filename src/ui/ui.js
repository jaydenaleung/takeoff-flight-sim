// UI root: loading screen, menu, in-flight HUD and overlays; wires input actions to the flight
// and owns the per-flight helpers (ATC, traffic, warnings).
import { Menu } from './menu.js';
import { HUD } from './hud.js';
import { ATC } from '../atc/atc.js';
import { Voice } from '../atc/voice.js';
import { makeCallsign } from '../atc/phraseology.js';
import { Traffic } from '../world/traffic.js';
import { Warnings } from '../systems/warnings.js';
import { Sound } from '../audio/sound.js';
import { settings } from '../core/settings.js';
import { KT, FT } from '../core/units.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const HELP = `
<h2>Controls</h2>
<div class="cols">
<table>
<tr><th colspan="2">Flight controls</th></tr>
<tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Pitch (↓ pulls the nose up)</td></tr>
<tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Roll</td></tr>
<tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>Rudder / nose-wheel steering</td></tr>
<tr><td><kbd>W</kbd> <kbd>S</kbd> or <kbd>PgUp</kbd> <kbd>PgDn</kbd></td><td>Throttle (last 13 % = afterburner on fighters)</td></tr>
<tr><td><kbd>Home</kbd> <kbd>End</kbd></td><td>Full thrust / idle</td></tr>
<tr><td><kbd>R</kbd> (hold)</td><td>Reverse thrust on the ground</td></tr>
<tr><td><kbd>B</kbd> (hold) · <kbd>P</kbd></td><td>Wheel brakes · parking brake</td></tr>
<tr><td><kbd>G</kbd></td><td>Landing gear</td></tr>
<tr><td><kbd>[</kbd> <kbd>]</kbd></td><td>Flaps up / down one detent</td></tr>
<tr><td><kbd>/</kbd> · <kbd>Shift</kbd>+<kbd>/</kbd></td><td>Speed brake · arm ground spoilers</td></tr>
<tr><td><kbd>,</kbd> <kbd>.</kbd></td><td>Pitch trim (direct law)</td></tr>
<tr><td><kbd>Y</kbd></td><td>Fly-by-wire ↔ direct law</td></tr>
<tr><td><kbd>I</kbd> · <kbd>L</kbd></td><td>Engines start/stop · landing lights</td></tr>
<tr><td><kbd>M</kbd></td><td>Mouse yoke on/off</td></tr>
</table>
<table>
<tr><th colspan="2">Autopilot</th></tr>
<tr><td><kbd>Z</kbd> · <kbd>X</kbd></td><td>Autopilot · autothrottle</td></tr>
<tr><td><kbd>T</kbd> · <kbd>V</kbd></td><td>Tune nearest ILS · arm approach (LOC + G/S, autoland)</td></tr>
<tr><td>MCP knobs</td><td>Scroll over SPD / HDG / ALT / V/S (Shift = big steps)</td></tr>
<tr><th colspan="2">Radio</th></tr>
<tr><td><kbd>F1</kbd>–<kbd>F8</kbd></td><td>Transmit the numbered call</td></tr>
<tr><td><kbd>Tab</kbd></td><td>Swap COM1 active ↔ standby</td></tr>
<tr><td><kbd>Enter</kbd></td><td>Type a radio call in your own words</td></tr>
<tr><td><kbd>Space</kbd> (hold)</td><td>Push-to-talk (speech recognition, where supported)</td></tr>
<tr><th colspan="2">Views and simulation</th></tr>
<tr><td><kbd>C</kbd> · <kbd>1</kbd>–<kbd>5</kbd></td><td>Next view · cockpit, chase, tower, fly-by, wing</td></tr>
<tr><td>Drag · wheel</td><td>Look around / orbit · zoom</td></tr>
<tr><td><kbd>N</kbd> · <kbd>K</kbd></td><td>Large map · hide instrument panels</td></tr>
<tr><td><kbd>-</kbd> <kbd>=</kbd></td><td>Time acceleration ×1 – ×8</td></tr>
<tr><td><kbd>Esc</kbd> · <kbd>H</kbd></td><td>Pause menu · this help</td></tr>
</table>
</div>
<h3>A first flight</h3>
<ol>
<li>At the gate the radio starts on ATIS. Press <kbd>Tab</kbd> for Clearance and <kbd>F1</kbd> to request your IFR clearance, then <kbd>F1</kbd> again to read it back.</li>
<li><kbd>Tab</kbd> to Ground: request pushback, then taxi. Release the parking brake (<kbd>P</kbd>), add a little thrust and follow the green line on the map display (scroll to zoom).</li>
<li>At the holding point switch to Tower and report ready. Set take-off flaps (<kbd>]</kbd>), then full thrust. Rotate gently at <b>VR</b> on the speed tape.</li>
<li>Gear up (<kbd>G</kbd>), flaps up on schedule, autopilot <kbd>Z</kbd> and autothrottle <kbd>X</kbd> if you like. ATC altitudes and headings are set on the MCP for you — just read them back.</li>
<li>Approach will vector you to the ILS. Press <kbd>V</kbd> to arm the approach; with the autopilot on it will fly the localizer and glideslope and land. Gear down, flaps to landing, arm spoilers.</li>
</ol>
<p class="small">Gamepads are supported: left stick pitch/roll, right stick rudder, triggers throttle, A gear, X/Y flaps, B brakes.</p>
<div class="btns"><button class="primary close">Close</button></div>`;

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.loading = el('div', 'loading', '<div class="brand"><h1>TAKEOFF</h1><span>Flight Simulator</span></div><div class="bar"><i></i></div><p></p>');
    this.root.appendChild(this.loading);
    this.overlay = el('div', 'overlay');
    this.root.appendChild(this.overlay);
    app.sound = new Sound();
    app.voice = new Voice(app.sound);
    this.menu = null; this.hud = null;
    this.atc = null; this.traffic = null; this.warnings = null;
    this.paused = false;
    this.clock = 0;
  }

  bind() {
    const app = this.app, inp = app.input;
    this.menu = new Menu(app, this.root);
    this.hud = new HUD(app, this.root);
    this.root.appendChild(this.overlay);
    const F = () => app.flight;
    const on = (name, fn) => inp.on(name, (arg) => { if (F() && !F().fm.crashed && (!this.paused || name === 'pause' || name === 'help')) fn(F(), arg); });
    on('gear', (f) => f.toggleGear());
    on('flapsUp', (f) => f.flaps(-1));
    on('flapsDown', (f) => f.flaps(1));
    on('parkBrake', (f) => { f.fm.ctl.parkBrake = !f.fm.ctl.parkBrake; this.hud.message(`PARKING BRAKE ${f.fm.ctl.parkBrake ? 'SET' : 'RELEASED'}`); });
    on('autopilot', (f) => f.toggleAP());
    on('autothrottle', (f) => { f.ap.setAT(!f.ap.at); this.hud.message(`AUTOTHROTTLE ${f.ap.at ? 'ON' : 'OFF'}`); });
    on('directLaw', (f) => { f.fcs.direct = !f.fcs.direct; f.fcs.trim = f.fcs.direct ? f.fcs.autoTrim + (f.fcs.eFF || 0) : 0; this.hud.message(f.fcs.direct ? 'DIRECT LAW — manual trim with , and .' : 'NORMAL LAW', f.fcs.direct ? 'caution' : 'info'); });
    on('engines', (f) => f.toggleEngines());
    on('lights', (f) => { f.lights.landing = !f.lights.landing; this.hud.message(`LANDING LIGHTS ${f.lights.landing ? 'ON' : 'OFF'}`); });
    on('speedbrake', (f) => f.cycleSpeedbrake());
    on('spoilerArm', (f) => { f.fm.ctl.spoilerArmed = !f.fm.ctl.spoilerArmed; f.ap.autobrake = f.fm.ctl.spoilerArmed; this.hud.message(`GROUND SPOILERS + AUTOBRAKE ${f.fm.ctl.spoilerArmed ? 'ARMED' : 'DISARMED'}`); });
    on('throttleFull', (f) => f.setThrottle(1));
    on('throttleIdle', (f) => f.setThrottle(0));
    on('viewNext', (f) => app.views.next(f.spec));
    on('view', (f, v) => app.views.set(v, f.spec));
    on('map', () => this.hud.toggleBig());
    on('hudToggle', () => this.hud.togglePanel());
    on('timeUp', (f) => { f.timeScale = Math.min(8, f.timeScale * 2); });
    on('timeDown', (f) => { f.timeScale = Math.max(1, f.timeScale / 2); });
    on('mouseYoke', () => { inp.mouseYoke = !inp.mouseYoke; this.hud.message(`MOUSE YOKE ${inp.mouseYoke ? 'ON' : 'OFF'}`); });
    on('comSwap', () => { this.atc.swap(); app.sound.click(); });
    on('radioText', () => { this.hud.e.tx.focus(); });
    on('atc', (f, i) => this.hud.choose(+i));
    on('ilsTune', () => this.hud.tuneNearestILS());
    on('approach', () => this.hud.armApproach());
    on('pttDown', () => {
      if (!app.voice.canListen) { this.hud.e.tx.focus(); return; }
      app.voice.stop();
      app.voice.listen().then((text) => { if (text && this.atc) this.atc.transmitText(text); else if (!text) this.hud.message('NOTHING HEARD — type with Enter instead', 'caution'); });
    });
    on('pttUp', () => app.voice.stopListening());
    inp.on('pause', () => { if (app.state === 'flying') this.togglePause(); });
    inp.on('help', () => this.showHelp());
  }

  resize(w, h) { if (this.hud) this.hud.resize(w, h); }
  showLoading(p, msg) {
    this.loading.style.display = '';
    this.loading.querySelector('i').style.width = `${Math.round(p * 100)}%`;
    this.loading.querySelector('p').textContent = msg;
  }
  hideLoading() { this.loading.style.display = 'none'; }
  fatal(err) {
    this.loading.style.display = '';
    this.loading.querySelector('p').innerHTML = `Something went wrong while starting the simulator.<br><small>${String(err && err.message ? err.message : err)}</small><br><small>A desktop browser with WebGL 2 is required.</small>`;
  }

  showMenu() { this.hideLoading(); this.closeOverlay(); this.menu.show(); }
  updateMenu(dt) { this.menu.update(dt, this.app.renderer); }

  startFlight(flight) {
    const app = this.app;
    this.menu.hide();
    this.closeOverlay();
    this.paused = false;
    const cs = makeCallsign(flight.spec, settings.airline, settings.flightNo);
    this.traffic = new Traffic(app.world, flight);
    this.atc = new ATC(flight, app.world, { voice: app.voice, callsign: cs, traffic: this.traffic });
    this.traffic.atc = this.atc;
    this.warnings = new Warnings(flight, app.world);
    this.hud.start(flight, this.atc, this.warnings, this.traffic);
    this.clock = settings.hour;
    this.landShown = 0;
    if (flight.start === 'gate') this.hud.message('Press H for the controls and a first-flight guide', 'info', 9);
  }
  endFlight() {
    this.app.voice.stop();
    if (this.traffic) this.traffic.dispose();
    this.hud.stop();
    this.atc = null; this.traffic = null; this.warnings = null;
    this.app.sound.update({ n1: 0, ias: 0, gs: 0, paused: true });
  }

  update(dt) {
    const app = this.app, f = app.flight;
    if (!f) return;
    const sdt = this.paused ? 0 : dt * f.timeScale;
    if (!this.paused && !f.fm.crashed) {
      this.atc.update(sdt);
      this.traffic.update(sdt);
      this.warnings.update(dt);
      // the sun moves with simulated time
      this.clock += sdt / 3600;
      if (Math.abs(this.clock - app.world.env.hour) > 0.02) app.world.env.setTime(this.clock % 24);
    }
    // events from the flight
    for (const e of f.events) {
      if (e.type === 'touchdown') { app.sound.touchdown(Math.min(1.5, e.rep.fpm / 500)); this.landing = e.rep; this.landShown = 2.5; }
      else if (e.type === 'crash') this.showCrash(e.reason);
      else if (e.type === 'apDisconnect') { app.sound.apDisconnect(); this.hud.message('AUTOPILOT DISENGAGED', 'warning'); }
      else if (e.type === 'gear') this.hud.message(`GEAR ${e.down ? 'DOWN' : 'UP'}`);
      else if (e.type === 'flaps') this.hud.message(`FLAPS ${e.name}`);
      else if (e.type === 'parked') this.showParked();
      else if (e.text) this.hud.message(e.text, e.type === 'warning' ? 'warning' : e.type === 'caution' ? 'caution' : 'info');
      if (this.atc) this.atc.flightEvent(e);
    }
    f.events.length = 0;
    // landing report once the touchdown has settled
    if (this.landShown > 0) {
      this.landShown -= dt;
      if (this.landShown <= 0 && this.landing) this.showLanding(this.landing);
    }
    // spoken call-outs
    const c = this.warnings.callout;
    if (c) { this.warnings.callout = null; if (settings.atcVoice && app.voice.synth) { const u = new SpeechSynthesisUtterance(c.text); u.rate = 1.35; u.pitch = 0.7; u.volume = settings.masterVol; try { app.voice.synth.speak(u); } catch { /* ignore */ } } }
    // audio
    const fm = f.fm, o = fm.out;
    let ab = 0;
    for (const e of fm.engines) ab = Math.max(ab, e.ab);
    app.sound.update({
      n1: o.n1, ab, ias: o.ias, gs: o.gs, onGround: o.onGround, paved: o.paved, cockpit: app.views.mode === 'cockpit',
      gearMoving: fm.gear > 0.01 && fm.gear < 0.99, flapMoving: Math.abs(fm.flap - f.spec.flaps[fm.ctl.flapIdx][1]) > 0.004,
      stall: this.warnings.stall, overspeed: this.warnings.overspeed, master: this.warnings.master && !this.warnings.stall,
      paused: this.paused || !!fm.crashed, fighter: f.spec.type === 'fighter',
    });
    this.hud.update(dt);
  }

  // ---------------------------------------------------------------- overlays
  openOverlay(html, cls = '') {
    this.overlay.className = `overlay on ${cls}`;
    this.overlay.innerHTML = `<div class="box">${html}</div>`;
    return this.overlay.querySelector('.box');
  }
  closeOverlay() { this.overlay.className = 'overlay'; this.overlay.innerHTML = ''; }
  togglePause() {
    const f = this.app.flight;
    if (!f || f.fm.crashed) return;
    if (this.overlay.classList.contains('help')) { this.closeOverlay(); if (!this.paused) return; }
    this.paused = !this.paused;
    f.paused = this.paused;
    if (!this.paused) { this.closeOverlay(); return; }
    this.app.voice.stop();
    const b = this.openOverlay(`<h2>Paused</h2>
      <div class="vbtns">
        <button class="primary" data-a="resume">Resume</button>
        <button data-a="help">Controls and first-flight guide</button>
        <button data-a="restart">Restart this flight</button>
        <button data-a="runway">Reposition: on the runway</button>
        <button data-a="final">Reposition: 10 nm final</button>
        <button data-a="cruise">Reposition: cruise</button>
        <button data-a="menu">Main menu</button>
      </div>`, 'pause');
    b.querySelectorAll('button').forEach((btn) => { btn.onclick = () => this.pauseAction(btn.dataset.a); });
  }
  pauseAction(a) {
    const app = this.app;
    if (a === 'resume') this.togglePause();
    else if (a === 'help') this.showHelp();
    else if (a === 'menu') { this.paused = false; app.toMenu(); }
    else {
      this.paused = false;
      app.startFlight({ aircraft: settings.aircraft, dep: settings.dep, dest: settings.dest, start: a === 'restart' ? settings.start : a, hour: settings.hour, weather: settings.weather, fuel: settings.fuel, payload: settings.payload });
    }
  }
  showHelp() {
    if (this.overlay.classList.contains('help')) { this.closeOverlay(); if (this.paused) { this.paused = false; this.togglePause(); } return; }
    const b = this.openOverlay(HELP, 'help');
    b.querySelector('.close').onclick = () => { this.closeOverlay(); if (this.paused) { this.paused = false; this.togglePause(); } };
  }
  showCrash(reason) {
    const app = this.app;
    app.voice.stop();
    const b = this.openOverlay(`<h2 class="bad">Aircraft lost</h2><p class="big">${reason}</p>
      <div class="vbtns"><button class="primary" data-a="restart">Try again</button><button data-a="runway">Restart on the runway</button><button data-a="final">Restart on 10 nm final</button><button data-a="menu">Main menu</button></div>`, 'crash');
    b.querySelectorAll('button').forEach((btn) => { btn.onclick = () => this.pauseAction(btn.dataset.a); });
  }
  showLanding(r) {
    this.landing = null;
    if (this.app.flight.fm.crashed) return;
    const grade = r.score >= 90 ? 'Butter' : r.score >= 75 ? 'Good landing' : r.score >= 55 ? 'Firm' : r.score >= 35 ? 'Hard' : 'Rough';
    const rows = [`<tr><th>Touchdown rate</th><td>${r.fpm} fpm</td></tr>`, `<tr><th>Speed</th><td>${r.kt} kt</td></tr>`];
    if (r.onRunway) {
      rows.push(`<tr><th>Runway</th><td>${r.airport.icao} ${r.end.id}</td></tr>`, `<tr><th>Past the threshold</th><td>${Math.round(r.dist)} m</td></tr>`,
        `<tr><th>Centreline</th><td>${Math.abs(r.offset).toFixed(1)} m ${r.offset > 0 ? 'right' : 'left'}</td></tr>`, `<tr><th>Runway remaining</th><td>${Math.round(r.remaining)} m</td></tr>`);
    } else rows.push('<tr><th>Surface</th><td>Off the runway</td></tr>');
    this.hud.showCard(`<h4>Landing — ${grade} <span>${r.score}/100</span></h4><table>${rows.join('')}</table>`, 16);
  }
  showParked() {
    const f = this.app.flight;
    const used = Math.round(f.spec.mass.fuel * settings.fuel - f.fm.fuel);
    const b = this.openOverlay(`<h2>Flight complete</h2><p class="big">${f.dep.icao} → ${f.dest.icao}</p>
      <p>Block time ${Math.floor(f.time / 60)} min · fuel used ${Math.max(0, used).toLocaleString('en-US')} kg</p>
      <div class="vbtns"><button class="primary" data-a="menu">Main menu</button><button data-a="resume2">Stay in the cockpit</button></div>`, 'pause');
    b.querySelectorAll('button').forEach((btn) => { btn.onclick = () => { if (btn.dataset.a === 'menu') this.app.toMenu(); else this.closeOverlay(); }; });
  }
}
export { KT, FT };
