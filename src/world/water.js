// Ocean surface: one large plane at sea level, masked by the baked ocean flag so that deserts
// below sea level stay dry. Fresnel sky reflection, animated ripples and sun glint.
import * as THREE from 'three';
import { GRID_W, GRID_H, HALF_W, HALF_H } from './heightfield.js';

export function createWater(flags, detailTex) {
  // ocean mask, dilated by one cell so the shoreline is decided by the terrain depth
  const mask = new Uint8Array(GRID_W * GRID_H);
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const o = j * GRID_W + i;
      let v = flags[o] === 255;
      if (!v) {
        v = (i > 0 && flags[o - 1] === 255) || (i < GRID_W - 1 && flags[o + 1] === 255)
          || (j > 0 && flags[o - GRID_W] === 255) || (j < GRID_H - 1 && flags[o + GRID_W] === 255);
      }
      mask[o] = v ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(mask, GRID_W, GRID_H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      mask: { value: null }, detail: { value: null }, time: { value: 0 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 1, 1) },
      skyColor: { value: new THREE.Color(0.25, 0.45, 0.8) }, horizonColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
      deepColor: { value: new THREE.Color(0.015, 0.07, 0.13) },
      extent: { value: new THREE.Vector2(HALF_W, HALF_H) },
    }]),
    vertexShader: `
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
      }`,
    fragmentShader: `
      uniform sampler2D mask; uniform sampler2D detail; uniform float time;
      uniform vec3 sunDir, sunColor, skyColor, horizonColor, deepColor; uniform vec2 extent;
      varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 uv = (vW.xz + extent) / (2.0 * extent);
        if (texture2D(mask, uv).r < 0.5) discard;
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vW.xz;
        vec2 n1 = texture2D(detail, p / 23.0 + vec2(time * 0.021, time * 0.013)).rg - 0.5;
        vec2 n2 = texture2D(detail, p / 71.0 - vec2(time * 0.011, time * 0.017)).rg - 0.5;
        vec2 n3 = texture2D(detail, p / 640.0 + vec2(time * 0.004, -time * 0.003)).gb - 0.5;
        float nearF = 1.0 - smoothstep(200.0, 9000.0, dist);
        vec2 sl = (n1 * 0.55 + n2 * 0.45) * (0.05 + 0.5 * nearF) + n3 * 0.12;
        vec3 N = normalize(vec3(sl.x, 1.0, sl.y));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(horizonColor, skyColor, clamp(R.y * 1.6, 0.0, 1.0));
        float spec = pow(max(dot(R, sunDir), 0.0), 260.0) * 2.5 + pow(max(dot(R, sunDir), 0.0), 24.0) * 0.12;
        vec3 col = mix(deepColor * (0.6 + 0.8 * max(sunDir.y, 0.0)), sky, fres) + sunColor * spec;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.mask.value = tex;
  mat.uniforms.detail.value = detailTex;
  const geo = new THREE.PlaneGeometry(3.2e6, 3.2e6, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'water';
  return mesh;
}
