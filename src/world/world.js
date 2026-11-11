// The world: loads baked data, owns the scene, terrain, water, sky and airport scenery.
import * as THREE from 'three';
import { HeightField, decodeTerrain, GRID_W, GRID_H } from './heightfield.js';
import { AirportDB, CITIES } from './airports.js';
import { llToWorld } from './projection.js';
import { Terrain } from './terrain.js';
import { createWater } from './water.js';
import { Environment } from './sky.js';
import { buildAirportScenery, disposeAirportScenery, buildCities, lightMaterial } from './airportScenery.js';

async function loadPixels(url, w, h) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export async function loadWorldData(onProgress = () => {}) {
  const base = import.meta.env.BASE_URL || './';
  onProgress(0.05, 'Loading airports');
  const json = await (await fetch(`${base}data/airports.json`)).json();
  onProgress(0.2, 'Loading terrain elevation');
  const terr = await loadPixels(`${base}data/terrain.png`, GRID_W, GRID_H);
  onProgress(0.7, 'Loading land cover');
  const lcRGBA = await loadPixels(`${base}data/landcover.jpg`, 1024, 880);
  const lc = new Uint8Array(1024 * 880 * 3);
  for (let i = 0, j = 0; i < lcRGBA.length; i += 4, j += 3) { lc[j] = lcRGBA[i]; lc[j + 1] = lcRGBA[i + 1]; lc[j + 2] = lcRGBA[i + 2]; }
  onProgress(0.85, 'Building airports');
  const { heights, flags } = decodeTerrain(terr);
  const db = new AirportDB(json);
  const cities = CITIES.map((c) => ({ ...c, ...llToWorld(c.lat, c.lon), R: c.r * 4.5 }));
  onProgress(1, 'Ready');
  return { heights, flags, lc: { data: lc, w: 1024, h: 880, cell: 1200 }, db, cities };
}

export class World {
  constructor(renderer, data, quality = 'high') {
    this.renderer = renderer;
    this.data = data;
    this.db = data.db;
    this.hf = new HeightField(data.heights, data.flags, this.db.pads());
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.6, 2.4e6);
    this.env = new Environment(this.scene, renderer);
    const q = { low: { res: 24, lodK: 1.7 }, medium: { res: 32, lodK: 2.0 }, high: { res: 40, lodK: 2.3 }, ultra: { res: 56, lodK: 2.7 } }[quality] || { res: 40, lodK: 2.3 };
    this.terrain = new Terrain({ scene: this.scene, heights: data.heights, flags: data.flags, lc: data.lc, pads: this.db.pads(), cities: data.cities, ...q });
    this.water = createWater(data.flags, this.terrain.detail);
    this.scene.add(this.water);
    // far ground so the horizon is never empty beyond the mapped region
    const far = new THREE.Mesh(new THREE.CircleGeometry(1.5e6, 48), new THREE.MeshBasicMaterial({ color: 0x8a8068 }));
    far.rotation.x = -Math.PI / 2; far.position.y = -140; this.far = far;
    this.scene.add(far);
    this.cities = buildCities(data.cities, (x, z) => this.hf.heightAt(x, z));
    this.scene.add(this.cities);
    this.active = new Map();          // icao -> scenery group
    this.nearGround = true;
    this._g = { h: 0, water: false, paved: true };
    this.sceneryTimer = 0;
    this.ground = this.ground.bind(this);
  }

  /** Ground query for the flight model. */
  ground(x, z) {
    const g = this._g;
    const h = this.hf.heightAt(x, z);
    if (h < 0) { g.h = 0; g.water = true; g.paved = false; return g; }
    g.h = h; g.water = false; g.paved = false;
    if (this.nearGround) {
      if (this.hf.water(x, z) === 1) { g.water = true; return g; }
      g.paved = !!this.db.surface(x, z);
    }
    return g;
  }
  elevation(x, z) { return Math.max(0, this.hf.heightAt(x, z)); }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt, weather, target, shadowSize) {
    const cam = this.camera;
    this.terrain.update(cam.position);
    this.env.update(dt, weather, cam, target, shadowSize);
    const wu = this.water.material.uniforms;
    wu.time.value += dt;
    wu.sunDir.value.copy(this.env.sunDir);
    wu.sunColor.value.copy(this.env.sunColor).multiplyScalar(this.env.day);
    wu.skyColor.value.copy(this.env.skyColor);
    wu.horizonColor.value.copy(this.env.fogColor);
    this.far.material.color.copy(this.env.fogColor).multiplyScalar(0.85);
    this.far.position.x = cam.position.x; this.far.position.z = cam.position.z;
    lightMaterial.uniforms.intensity.value = 0.22 + 0.78 * (1 - this.env.day) + 0.5 * this.env.inCloud;
    lightMaterial.uniforms.scale.value = this.renderer.domElement.height * 1.1;
    this.cities.material.emissiveIntensity = 0.55 * (1 - this.env.day);
    // airport scenery around the camera
    this.sceneryTimer -= dt;
    if (this.sceneryTimer <= 0) {
      this.sceneryTimer = 1.5;
      for (const ap of this.db.airports) {
        const d = Math.hypot(ap.c.x - cam.position.x, ap.c.z - cam.position.z);
        const has = this.active.has(ap.icao);
        if (d < 70000 && !has) {
          const g = buildAirportScenery(ap);
          this.scene.add(g); this.active.set(ap.icao, g);
          break;                                   // at most one build per tick
        } else if (d > 110000 && has) {
          const g = this.active.get(ap.icao);
          this.scene.remove(g); disposeAirportScenery(g); this.active.delete(ap.icao);
        }
      }
      for (const g of this.active.values()) g.userData.glass.emissiveIntensity = 0.9 * (1 - this.env.day);
    }
  }
}
