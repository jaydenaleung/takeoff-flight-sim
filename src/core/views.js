// Camera views: chase/orbit, cockpit, tower, fly-by and wing.
import * as THREE from 'three';
import { DEG, clamp, expK } from './units.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
export const VIEW_ORDER = ['chase', 'cockpit', 'tower', 'flyby', 'wing'];

export class Views {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.yaw = 0; this.pitch = 12 * DEG; this.dist = 0;
    this.lookYaw = 0; this.lookPitch = 0;
    this.flyby = new THREE.Vector3();
    this.flybyT = 0;
    this.smoothHdg = null;
    this.target = new THREE.Vector3();
  }
  set(mode, spec) {
    this.mode = mode;
    this.lookYaw = 0; this.lookPitch = mode === 'wing' ? -6 * DEG : 0;
    if (mode === 'chase') { this.yaw = 0; this.pitch = 12 * DEG; }
    this.flybyT = 0;
    if (spec && !this.dist) this.dist = Math.max(spec.dims.length, spec.dims.span) * 1.5;
  }
  next(spec) { this.set(VIEW_ORDER[(VIEW_ORDER.indexOf(this.mode) + 1) % VIEW_ORDER.length], spec); }
  orbit(dx, dy) {
    if (this.mode === 'chase') { this.yaw -= dx * 0.006; this.pitch = clamp(this.pitch + dy * 0.005, -0.3, 1.45); }
    else { this.lookYaw = clamp(this.lookYaw - dx * 0.004, -2.6, 2.6); this.lookPitch = clamp(this.lookPitch - dy * 0.004, -1.2, 1.2); }
  }
  zoom(delta, spec) {
    if (this.mode === 'chase') {
      const min = Math.max(spec.dims.length, spec.dims.span) * 0.6;
      this.dist = clamp(this.dist * (1 + delta * 0.0012), min, 4000);
    } else {
      this.camera.fov = clamp(this.camera.fov + delta * 0.02, 12, 80);
      this.camera.updateProjectionMatrix();
    }
  }
  /** fm: flight model, model: AircraftModel, world: World, dt seconds. */
  update(dt, fm, model, world) {
    const cam = this.camera, spec = fm.spec, o = fm.out;
    const pos = fm.pos, mode = this.mode;
    model.group.visible = mode !== 'cockpit';
    const wantFov = mode === 'cockpit' ? 62 : 52;
    if (mode !== 'tower' && Math.abs(cam.fov - wantFov) > 0.5 && this._lastMode !== mode) { cam.fov = wantFov; cam.updateProjectionMatrix(); }
    this._lastMode = mode;
    const nearWanted = mode === 'cockpit' ? 0.35 : mode === 'wing' ? 0.5 : 1.2;
    if (cam.near !== nearWanted) { cam.near = nearWanted; cam.updateProjectionMatrix(); }

    if (mode === 'chase') {
      const hdg = o.hdg * DEG;
      if (this.smoothHdg == null) this.smoothHdg = hdg;
      let d = hdg - this.smoothHdg; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.smoothHdg += d * expK(4, dt);
      const a = this.smoothHdg + Math.PI + this.yaw;
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      this.target.set(pos.x, pos.y + spec.dims.height * 0.12, pos.z);
      cam.position.set(this.target.x + Math.sin(a) * cp * this.dist, this.target.y + sp * this.dist, this.target.z - Math.cos(a) * cp * this.dist);
      const gh = world.elevation(cam.position.x, cam.position.z) + 1.5;
      if (cam.position.y < gh) cam.position.y = gh;
      cam.up.copy(UP);
      cam.lookAt(this.target);
    } else if (mode === 'cockpit' || mode === 'wing') {
      const e = spec.eye;
      if (mode === 'cockpit') _v.set(e.x, e.y, e.z - fm.geo.cgX);
      else _v.set(-(spec.dims.fuseW / 2 + 0.25), spec.dims.fuseH * 0.18, fm.geo.le(spec.dims.fuseW / 2).z - 3.5);
      cam.position.copy(_v).applyQuaternion(fm.quat).add(pos);
      const baseYaw = mode === 'wing' ? 100 * DEG : 0;
      _q.setFromEuler(_e.set(this.lookPitch, baseYaw + this.lookYaw, 0, 'YXZ'));
      cam.quaternion.copy(fm.quat).multiply(_q);
    } else if (mode === 'tower') {
      const ap = world.db.nearest(pos.x, pos.z);
      cam.position.set(ap.tower.x, ap.elev + ap.towerH + 4, ap.tower.z);
      const d = cam.position.distanceTo(pos);
      cam.fov = clamp((Math.atan((spec.dims.span * 2.2) / d) * 2) / DEG, 1.2, 50);
      cam.updateProjectionMatrix();
      cam.up.copy(UP);
      cam.lookAt(pos);
    } else if (mode === 'flyby') {
      this.flybyT -= dt;
      const d = cam.position.distanceTo(pos);
      if (this.flybyT <= 0 || d > Math.max(900, o.tas * 9)) {
        // a new vantage point ahead of and beside the flight path
        const lead = Math.max(120, o.tas * 4.5);
        _v.copy(fm.vel); if (_v.lengthSq() < 4) _v.set(0, 0, -1).applyQuaternion(fm.quat); _v.normalize();
        const side = Math.random() < 0.5 ? -1 : 1;
        this.flyby.set(pos.x + _v.x * lead - _v.z * side * (40 + spec.dims.span), pos.y + _v.y * lead + (o.agl > 60 ? -10 - Math.random() * 20 : 6), pos.z + _v.z * lead + _v.x * side * (40 + spec.dims.span));
        const gh = world.elevation(this.flyby.x, this.flyby.z) + 2;
        if (this.flyby.y < gh) this.flyby.y = gh;
        this.flybyT = 14;
      }
      cam.position.copy(this.flyby);
      cam.up.copy(UP);
      cam.lookAt(pos);
    }
  }
}
