// brain-cloud.ts
// Generates the 35k-particle procedural brain cloud via rejection sampling.
// Ported 1:1 from vhxco-app.js lines 148-222.

import {
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  Points,
  AdditiveBlending,
} from 'three';
import type { Scene } from 'three';
import brainCloudVert from './shaders/brain-cloud.vert.glsl';
import brainCloudFrag from './shaders/brain-cloud.frag.glsl';
import type { BrainCloudHandle } from './types.js';

// Particle count — preserved from v0
const COUNT = 35000;

// Primary hue default — 200 (VHXCO cyan)
const DEFAULT_HUE = 200 / 360;

function hash(n: number): number {
  return Math.sin(n) * 43758.5453;
}

function noise3D(x: number, y: number, z: number): number {
  const p = Math.floor(x) * 17 + Math.floor(y) * 53 + Math.floor(z) * 101;
  return hash(p);
}

export function generateBrainCloud(scene: Scene): BrainCloudHandle {
  const geo = new BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  const alphas = new Float32Array(COUNT);
  const seeds = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    let x: number, y: number, z: number;

    // Rejection sampling: keep points inside at least one of the 4 brain ellipsoids
    // Ported 1:1 from v0 lines 162-178
    while (true) {
      x = Math.random() * 14.0 - 7.0;
      y = Math.random() * 13.0 - 6.5;
      z = Math.random() * 10.0 - 5.0;

      const r1 = Math.pow(x / 6.5, 2) + Math.pow((y - 1.0) / 4.5, 2) + Math.pow(z / 5.0, 2); // Cerebrum
      const r2 = Math.pow((x + 2.0) / 5.0, 2) + Math.pow((y + 0.5) / 3.5, 2) + Math.pow(z / 4.0, 2); // Occipital
      const r3 = Math.pow((x + 3.5) / 2.5, 2) + Math.pow((y + 2.5) / 2.0, 2) + Math.pow(z / 2.5, 2); // Cerebellum
      const r4 = Math.pow((x + 1.0) / 1.2, 2) + Math.pow((y + 4.0) / 2.5, 2) + Math.pow(z / 1.2, 2); // Brain Stem

      if (r1 <= 1.0 || r2 <= 1.0 || r3 <= 1.0 || r4 <= 1.0) break;
    }

    // Noise displacement (v0 lines 180-181)
    const n = noise3D(x * 1.5, y * 1.5, z * 1.5) * 0.4;
    x += n; y += n; z += n;

    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    alphas[i] = 0.5 + Math.random() * 0.5;
    seeds[i] = Math.random() * 100;
  }

  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new BufferAttribute(alphas, 1));
  geo.setAttribute('aSeed', new BufferAttribute(seeds, 1));

  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uHue: { value: DEFAULT_HUE },
      uOpacity: { value: 0.9 },
      uBootProgress: { value: 0.0 },
    },
    vertexShader: brainCloudVert,
    fragmentShader: brainCloudFrag,
  });

  const points = new Points(geo, mat);
  scene.add(points);

  function dispose(): void {
    scene.remove(points);
    geo.dispose();
    mat.dispose();
  }

  return { points, mat, dispose };
}
