// synapses.ts
// Traveling synapse pulse lifecycle — max 15 simultaneous pulses.
// Ported 1:1 from vhxco-app.js lines 470-574.
//
// Pulse cap: MAX_SYNAPSES = 15 (strict limit to prevent visual overload).
// Pulse speed: 0.3 - 0.6 (reduced from v0's original 0.8-1.3 to slow travel).
// Fire cooldown: 4.5s per neuron (v0 line 503).

import {
  IcosahedronGeometry,
  InstancedBufferGeometry,
  InstancedMesh,
  ShaderMaterial,
  Object3D,
  AdditiveBlending,
  DynamicDrawUsage,
} from 'three';
import type { Scene } from 'three';
import pulseFrag from './shaders/pulse.frag.glsl';
import type { NeuronData, EdgeData, SynapseData } from './types.js';

// Pulse vertex shader — minimal passthrough (v0 lines 479-483)
const PULSE_VERT = `
void main() {
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Max simultaneous pulses — preserved from v0
const MAX_SYNAPSES = 15;

export interface SynapsesHandle {
  pulses: InstancedMesh;
  update: (t: number, dt: number, neurons: NeuronData[], staticEdges: EdgeData[]) => void;
  dispose: () => void;
}

export function createSynapses(scene: Scene): SynapsesHandle {
  const synapses: SynapseData[] = [];

  const pulseGeo = new IcosahedronGeometry(0.04, 2);
  // Three.js types: .copy() signature is overly strict — cast is runtime safe
  const pulseGeoInst = new InstancedBufferGeometry().copy(pulseGeo as unknown as InstancedBufferGeometry);
  pulseGeoInst.instanceCount = MAX_SYNAPSES;

  const pulseMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: PULSE_VERT,
    fragmentShader: pulseFrag,
  });

  const pulses = new InstancedMesh(pulseGeoInst, pulseMat, MAX_SYNAPSES);
  pulses.instanceMatrix.setUsage(DynamicDrawUsage);
  scene.add(pulses);

  const dummyPulse = new Object3D();

  function update(t: number, dt: number, neurons: NeuronData[], staticEdges: EdgeData[]): void {
    const MAX_NEURONS = neurons.length;

    // 1. Spawning Synapses (v0 lines 499-524)
    // Reduced spawn rate: 0.02 (from 0.1 in original)
    if (synapses.length < MAX_SYNAPSES && Math.random() < 0.02) {
      const nA = neurons[Math.floor(Math.random() * MAX_NEURONS)];
      // Cooldown: 4.5s (v0 line 503)
      if (t - nA.lastFire > 4.5) {
        const connectedEdges = staticEdges.filter((e) => e.nA === nA || e.nB === nA);
        if (connectedEdges.length > 0) {
          const edge = connectedEdges[Math.floor(Math.random() * connectedEdges.length)];
          const nB = edge.nA === nA ? edge.nB : edge.nA;
          // Speed reduced: 0.3-0.6 (from 0.8-1.3 in v0)
          synapses.push({ nA, nB, progress: 0, speed: 0.3 + Math.random() * 0.3 });
          nA.lastFire = t;

          // Audio ping on synapse fire — prob 0.08, rate-limited via spawn rate itself.
          // Reads window.__audioReady so no import needed (lazy-loaded chunk).
          if (Math.random() < 0.08) {
            const audio = (
              typeof window !== 'undefined'
                ? (window as unknown as Record<string, unknown>).__audioReady
                : undefined
            ) as { audioPing?: () => void; isMuted?: () => boolean } | undefined;
            if (audio && !audio.isMuted?.()) {
              audio.audioPing?.();
            }
          }
        }
      }
    }

    // 2. Update Neuron Energy (soma glow, v0 lines 527-536)
    // Note: somaEnergy array is updated in render-loop.ts which has the attrSomaEnergy ref

    // 3. Update Traveling Pulses (v0 lines 539-574)
    for (let i = synapses.length - 1; i >= 0; i--) {
      const syn = synapses[i];
      syn.progress += dt * syn.speed;

      if (syn.progress >= 1.0) {
        // Reached destination — spark nB
        syn.nB.lastFire = t;
        synapses.splice(i, 1);
      }
    }

    // Rebuild pulse matrices
    let numActivePulses = 0;
    for (let i = 0; i < synapses.length; i++) {
      const syn = synapses[i];
      const pA = syn.nA;
      const pB = syn.nB;

      // Interpolate position along axon
      const lx = pA.x + (pB.x - pA.x) * syn.progress;
      const ly = pA.y + (pB.y - pA.y) * syn.progress;
      const lz = pA.z + (pB.z - pA.z) * syn.progress;

      dummyPulse.position.set(lx, ly, lz);

      // Tiny wobble to follow the wavy tube vaguely (v0 line 565)
      const waveX = Math.sin(syn.progress * 15.0) * 0.05;
      dummyPulse.position.x += waveX;

      dummyPulse.updateMatrix();
      pulses.setMatrixAt(i, dummyPulse.matrix);
      numActivePulses++;
    }

    // Three.js 0.184: use InstancedMesh.count (replaces geometry.instanceCount from older API)
    pulses.count = numActivePulses;
    if (numActivePulses > 0) pulses.instanceMatrix.needsUpdate = true;
  }

  function dispose(): void {
    scene.remove(pulses);
    pulseGeoInst.dispose();
    pulseGeo.dispose();
    pulseMat.dispose();
  }

  return { pulses, update, dispose };
}
