// Sky dome, sun/moon lighting, fog, stars and cloud layers, all driven by time of day and weather.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { DEG, clamp, smoothstep, lerp } from '../core/units.js';

const cloudFrag = `
  uniform float cover, time, opacity; uniform vec3 sunDir, lightColor, shadeColor; uniform vec2 wind;
  varying vec3 vW;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = (vW.xz + wind * time) / 2600.0;
    float n = fbm(p) * 0.75 + fbm(p * 0.23 + 9.0) * 0.45;
    float th = 1.02 - cover * 0.95;
    float a = smoothstep(th, th + 0.22, n);
    float d = length(cameraPosition.xz - vW.xz);
    a *= (1.0 - smoothstep(60000.0, 110000.0, d)) * opacity;
    if (a < 0.01) discard;
    float dens = smoothstep(th, th + 0.5, n);
    float below = cameraPosition.y < vW.y ? 1.0 : 0.0;
    vec3 col = mix(lightColor, shadeColor, dens * (0.35 + 0.5 * below));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
const cloudVert = `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`;

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(1.6e6);
    this.sky.material.fog = false;
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b6250, 1);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xbfd0e0, 0.00002);
    scene.fog = this.fog;

    // stars
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = Math.random() * 0.98 + 0.02, a = Math.random() * 6.283, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 9e5; pos[i * 3 + 1] = y * 9e5; pos[i * 3 + 2] = Math.sin(a) * r * 9e5;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // cloud layers
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        cover: { value: 0.3 }, time: { value: 0 }, opacity: { value: 1 }, wind: { value: new THREE.Vector2(8, 3) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, lightColor: { value: new THREE.Color(1, 1, 1) }, shadeColor: { value: new THREE.Color(0.5, 0.55, 0.62) },
      }]),
      vertexShader: cloudVert, fragmentShader: cloudFrag,
    });
    const cg = new THREE.PlaneGeometry(230000, 230000, 48, 48);
    cg.rotateX(-Math.PI / 2);
    this.clouds = [new THREE.Mesh(cg, this.cloudMat), new THREE.Mesh(cg, this.cloudMat)];
    for (const c of this.clouds) { c.frustumCulled = false; c.renderOrder = 5; scene.add(c); }

    // a small copy of the sky is rendered into an environment map for reflections
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(100);
    this.envScene.add(this.envSky);
    this.envHour = -99;
    this.envTarget = null;

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.hour = 12;
    this.groundRef = 0;
    this.fogColor = new THREE.Color();
    this.skyColor = new THREE.Color();
    this.horizonColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.time = 0;
    this.inCloud = 0;
  }

  /** hour: local solar time 0..24. */
  setTime(hour) {
    this.hour = hour;
    const lat = 36 * DEG, decl = 12 * DEG;
    const H = (hour - 12) * 15 * DEG;
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(sinEl);
    let az = Math.acos(clamp((Math.sin(decl) - sinEl * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat)), -1, 1));
    if (H > 0) az = 2 * Math.PI - az;
    this.sunEl = el; this.sunAz = az;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const elD = el / DEG;
    const day = smoothstep(-6, 8, elD);
    this.day = day;
    this.night = 1 - smoothstep(-12, -2, elD);
    const warm = 1 - smoothstep(0, 28, elD);
    this.sunColor.setRGB(1, lerp(0.96, 0.62, warm), lerp(0.9, 0.36, warm));
    // sky model wants the sun above the horizon; at night aim it below and dim everything
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const moon = this.night;
    if (elD > -4) {
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 3.4 * smoothstep(-3, 14, elD);
      this.lightDir = this.sunDir;
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1);
      this.sun.intensity = 0.1 * moon;
      this.lightDir = new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
    }
    this.hemi.intensity = 0.06 + 1.15 * day;
    this.hemi.color.setRGB(lerp(0.2, 0.74, day), lerp(0.25, 0.83, day), lerp(0.45, 1, day));
    this.hemi.groundColor.setRGB(lerp(0.05, 0.42, day), lerp(0.05, 0.38, day), lerp(0.06, 0.31, day));
    const sunset = smoothstep(-6, 2, elD) * (1 - smoothstep(2, 16, elD));
    this.horizonColor.setRGB(lerp(0.015, 0.74, day), lerp(0.02, 0.82, day), lerp(0.04, 0.92, day));
    this.horizonColor.lerp(new THREE.Color(0.95, 0.58, 0.36), sunset * 0.65);
    this.skyColor.setRGB(lerp(0.005, 0.2, day), lerp(0.008, 0.42, day), lerp(0.02, 0.8, day));
    this.stars.material.opacity = this.night * 0.9;
    this.renderer.toneMappingExposure = lerp(0.34, 0.5, day);
    if (Math.abs(hour - this.envHour) > 0.2) {
      this.envHour = hour;
      const eu = this.envSky.material.uniforms, su = this.sky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
      eu.sunPosition.value.copy(this.sunDir);
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 500);
      this.envTexture = this.envTarget.texture;
      this.envIntensity = 0.08 + 0.34 * day;
      if (old) old.dispose();
    }
  }

  /** weather: the Weather object; cam: camera; target: point the shadow follows. */
  update(dt, weather, cam, target, shadowSize) {
    this.time += dt;
    const camY = cam.position.y;
    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    // sun light follows the aircraft for shadows
    const s = shadowSize || 60;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.lightDir, 400);
    const sc = this.sun.shadow.camera;
    if (sc.right !== s) { sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 10; sc.far = 900; sc.updateProjectionMatrix(); }

    // haze: visibility-driven, thinning with altitude; overcast greys the palette
    const cover = weather.cover;
    const grey = smoothstep(0.55, 1, cover);
    this.fogColor.copy(this.horizonColor).lerp(new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(0.25 + 0.75 * this.day), grey * 0.8);
    const base = this.groundRef + weather.base, top = this.groundRef + weather.top;
    let vis = weather.vis;
    // inside the cloud layer the world goes white
    const inLayer = smoothstep(base - 60, base + 40, camY) * (1 - smoothstep(top - 40, top + 80, camY));
    this.inCloud = inLayer * smoothstep(0.15, 0.7, cover);
    if (camY > top) vis = Math.max(vis, 90000);
    vis = lerp(vis, 140, this.inCloud);
    const thin = clamp(1 - (camY - this.groundRef) / 30000, 0.45, 1);
    this.fog.density = (1.7 / vis) * (this.inCloud > 0.01 ? 1 : thin);
    this.fog.color.copy(this.fogColor);
    if (this.inCloud > 0.01) this.fog.color.lerp(new THREE.Color(0.8, 0.82, 0.85).multiplyScalar(0.2 + 0.8 * this.day), this.inCloud);
    const su = this.sky.material.uniforms;
    su.turbidity.value = lerp(4, 16, grey);
    su.rayleigh.value = lerp(1.5, 0.6, grey);

    const cu = this.cloudMat.uniforms;
    cu.cover.value = cover; cu.time.value = this.time; cu.sunDir.value.copy(this.sunDir);
    cu.lightColor.value.setRGB(1, 1, 1).multiplyScalar(0.12 + 1.0 * this.day).lerp(this.sunColor.clone().multiplyScalar(0.9), 0.3 * this.day);
    cu.shadeColor.value.setRGB(0.42, 0.46, 0.53).multiplyScalar(0.08 + 0.92 * this.day);
    const w = weather.windAt(base, 500);
    cu.wind.value.set(w[0], w[2]);
    const snap = 4000;
    const cx = Math.round(cam.position.x / snap) * snap, cz = Math.round(cam.position.z / snap) * snap;
    this.clouds[0].position.set(cx, base, cz);
    this.clouds[1].position.set(cx, top, cz);
    this.clouds[0].visible = this.clouds[1].visible = cover > 0.02;
  }
}
