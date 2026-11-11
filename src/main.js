// Takeoff - Flight Simulator: application bootstrap and main loop.
import * as THREE from 'three';
import './ui/styles.css';
import { initFirebase } from './firebase.js';
import { settings, saveSettings } from './core/settings.js';
import { Input } from './core/input.js';
import { Views } from './core/views.js';
import { loadWorldData, World } from './world/world.js';
import { AIRCRAFT_BY_ID } from './aircraft/specs.js';
import { Flight } from './flight.js';
import { UI } from './ui/ui.js';

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.quality === 'low' ? 1 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.input = new Input(this.canvas);
    this.flight = null;
    this.state = 'loading';
    this.last = performance.now();
    this.fps = 60;
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.resize());
  }

  async init() {
    initFirebase();
    this.ui.showLoading(0, 'Starting');
    const data = await loadWorldData((p, msg) => this.ui.showLoading(p * 0.8, msg));
    this.world = new World(this.renderer, data, settings.quality);
    this.views = new Views(this.world.camera);
    this.input.onOrbit = (dx, dy) => this.views.orbit(dx, dy);
    this.input.onZoom = (d) => { if (this.flight) this.views.zoom(d, this.flight.spec); };
    this.resize();
    this.world.env.setTime(settings.hour);
    this.ui.bind();
    const q = new URLSearchParams(location.search);
    if (q.has('fly')) {
      // quick start for testing: ?fly&ac=b738&dep=KSFO&dest=KLAX&start=runway&hour=10&wx=clear&view=chase
      this.startFlight({
        aircraft: q.get('ac') || settings.aircraft, dep: q.get('dep') || settings.dep, dest: q.get('dest') || settings.dest,
        start: q.get('start') || 'runway', hour: +(q.get('hour') || settings.hour), weather: q.get('wx') || settings.weather,
        fuel: settings.fuel, payload: settings.payload, view: q.get('view'),
      });
    } else {
      this.state = 'menu';
      this.ui.showMenu();
      window.__ready = true;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    if (this.world) this.world.resize(w, h);
    this.ui.resize(w, h);
  }

  startFlight(o) {
    if (this.flight) { this.ui.endFlight(); this.flight.dispose(); this.flight = null; }
    const db = this.world.db;
    const spec = AIRCRAFT_BY_ID[o.aircraft] || AIRCRAFT_BY_ID.b738;
    const dep = db.byIcao[o.dep] || db.byIcao.KSFO;
    const dest = db.byIcao[o.dest] || dep;
    Object.assign(settings, { aircraft: spec.id, dep: dep.icao, dest: dest.icao, start: o.start, hour: o.hour, weather: o.weather, fuel: o.fuel, payload: o.payload });
    saveSettings();
    this.world.env.setTime(o.hour);
    this.flight = new Flight(this.world, { spec, dep, dest, start: o.start, weather: o.weather, fuel: o.fuel, payload: o.payload });
    this.views.dist = 0;
    this.views.smoothHdg = null;
    this.views.set(o.view || (o.start === 'gate' ? 'chase' : 'chase'), spec);
    this.state = 'flying';
    this.input.enabled = true;
    this.warm = 0;
    this.ui.startFlight(this.flight);
  }

  toMenu() {
    if (this.flight) { this.ui.endFlight(); this.flight.dispose(); this.flight = null; }
    this.state = 'menu';
    this.input.enabled = false;
    this.ui.showMenu();
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    const world = this.world;
    if (this.state === 'flying' && this.flight) {
      const f = this.flight;
      this.input.update(dt);
      // hold the simulation until the terrain around the aircraft has loaded
      const loading = this.warm < 3 && !(world.terrain.idle && this.warm > 0.4);
      if (loading) { this.warm += dt; this.ui.showLoading(0.8 + 0.2 * Math.min(1, this.warm / 2), 'Generating terrain'); f.syncModel(0); }
      else { if (this.warm < 99) { this.warm = 99; this.ui.hideLoading(); window.__ready = true; } f.update(dt, this.input); }
      this.views.update(dt, f.fm, f.model, world);
      world.update(dt, f.weather, f.fm.pos, Math.max(f.spec.dims.span, f.spec.dims.length) * 0.75);
      this.ui.update(dt);
    } else if (this.state === 'menu') {
      this.ui.updateMenu(dt);
      return;
    }
    this.renderer.render(world.scene, world.camera);
  }
}

const app = new App();
window.__app = app;
app.init().catch((err) => {
  console.error(err);
  app.ui.fatal(err);
});
