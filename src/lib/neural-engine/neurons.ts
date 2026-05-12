// neurons.ts
// Neural network: 200 soma cell bodies (InstancedMesh icosahedron + snoise displacement)
// plus the static axon web (~600 cylindrical tubes nearest-neighbor).
// Ported 1:1 from vhxco-app.js lines 227-466 (somas + axons).
// Synapses (pulse lifecycle) are in synapses.ts.

import {
  IcosahedronGeometry,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  CylinderGeometry,
  ShaderMaterial,
  Object3D,
  AdditiveBlending,
} from 'three';
import type { Scene } from 'three';
import somaVert from './shaders/soma.vert.glsl';
import somaFrag from './shaders/soma.frag.glsl';
import axonVert from './shaders/axon.vert.glsl';
import axonFrag from './shaders/axon.frag.glsl';
import { HERO_NEURON_INDICES } from './hero-anchors.js';
import type { NeuronData, EdgeData, NeuralNetworkHandle } from './types.js';

// Constants preserved from v0
const MAX_NEURONS = 200;
const DEFAULT_HUE = 200 / 360;

export function makeNeuralNetwork(scene: Scene): NeuralNetworkHandle {
  const neurons: NeuronData[] = [];
  const staticEdges: EdgeData[] = [];

  // 1. GENERATE NEURONS — rejection sampling inside 4 brain ellipsoids (v0 lines 235-255)
  for (let i = 0; i < MAX_NEURONS; i++) {
    let x: number, y: number, z: number;

    while (true) {
      x = Math.random() * 12.0 - 6.0;
      y = Math.random() * 11.0 - 5.5;
      z = Math.random() * 8.0 - 4.0;

      const r1 = Math.pow(x / 5.5, 2) + Math.pow((y - 1.0) / 3.5, 2) + Math.pow(z / 4.0, 2);
      const r2 = Math.pow((x + 2.0) / 4.0, 2) + Math.pow((y + 0.5) / 2.5, 2) + Math.pow(z / 3.0, 2);
      const r3 = Math.pow((x + 3.5) / 2.0, 2) + Math.pow((y + 2.5) / 1.5, 2) + Math.pow(z / 2.0, 2);
      const r4 = Math.pow((x + 1.0) / 1.0, 2) + Math.pow((y + 4.0) / 2.0, 2) + Math.pow(z / 1.0, 2);

      if (r1 <= 1.0 || r2 <= 1.0 || r3 <= 1.0 || r4 <= 1.0) break;
    }

    neurons.push({
      id: i,
      x, y, z,
      firingRate: Math.random() * 0.5 + 0.1,
      lastFire: Math.random() * -5,
      baseSeed: Math.random() * 100,
    });
  }

  // 2. GENERATE STATIC AXON WEB — 3 nearest neighbors per neuron (v0 lines 265-279)
  for (let i = 0; i < MAX_NEURONS; i++) {
    const nA = neurons[i];
    const neighbors = neurons
      .filter((nB) => nB.id !== nA.id)
      .map((nB) => ({ nB, d: Math.hypot(nA.x - nB.x, nA.y - nB.y, nA.z - nB.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);

    neighbors.forEach((nn) => {
      // Prevent duplicate undirected edges
      if (!staticEdges.find((e) => (e.nA === nA && e.nB === nn.nB) || (e.nA === nn.nB && e.nB === nA))) {
        staticEdges.push({ nA, nB: nn.nB, dist: nn.d });
      }
    });
  }

  // 3. SOMAS — InstancedMesh icosahedron (v0 lines 282-405)
  const somaGeo = new IcosahedronGeometry(0.12, 4);
  // Three.js types: InstancedBufferGeometry.copy() signature is overly strict (InstancedBufferGeometry),
  // but at runtime it accepts any BufferGeometry. Cast to bypass — runtime safe.
  const somaGeoInst = new InstancedBufferGeometry().copy(somaGeo as unknown as InstancedBufferGeometry);
  somaGeoInst.instanceCount = MAX_NEURONS;

  const somaEnergy = new Float32Array(MAX_NEURONS);
  const somaSeed = new Float32Array(MAX_NEURONS);
  const somaBirth = new Float32Array(MAX_NEURONS);

  for (let i = 0; i < MAX_NEURONS; i++) {
    somaSeed[i] = neurons[i].baseSeed;
    somaBirth[i] = i < 2 ? 0.0 : 0.85;
  }

  const attrSomaEnergy = new InstancedBufferAttribute(somaEnergy, 1);
  somaGeoInst.setAttribute('aEnergy', attrSomaEnergy);
  somaGeoInst.setAttribute('aSeed', new InstancedBufferAttribute(somaSeed, 1));
  somaGeoInst.setAttribute('aBirth', new InstancedBufferAttribute(somaBirth, 1));

  const somaMat = new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uHue: { value: DEFAULT_HUE },
      uBootProgress: { value: 0.0 },
    },
    vertexShader: somaVert,
    fragmentShader: somaFrag,
  });

  const somas = new InstancedMesh(somaGeoInst, somaMat, MAX_NEURONS);
  const dummy = new Object3D();
  for (let i = 0; i < MAX_NEURONS; i++) {
    dummy.position.set(neurons[i].x, neurons[i].y, neurons[i].z);
    const s = 0.6 + Math.random() * 0.6;
    dummy.scale.set(s, s, s);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    dummy.updateMatrix();
    somas.setMatrixAt(i, dummy.matrix);
  }
  scene.add(somas);

  // 4. AXON WEB — InstancedMesh cylindrical tubes (v0 lines 408-465)
  const tubeGeo = new CylinderGeometry(0.025, 0.025, 1, 6, 12);
  tubeGeo.translate(0, 0.5, 0);
  tubeGeo.rotateX(Math.PI / 2);

  const numEdges = staticEdges.length;
  // Same cast as somaGeoInst — runtime safe
  const tubeGeoInst = new InstancedBufferGeometry().copy(tubeGeo as unknown as InstancedBufferGeometry);
  tubeGeoInst.instanceCount = numEdges;

  const tubeSeed = new Float32Array(numEdges);
  for (let i = 0; i < numEdges; i++) tubeSeed[i] = Math.random() * 100.0;
  tubeGeoInst.setAttribute('aSeed', new InstancedBufferAttribute(tubeSeed, 1));

  const webMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uHue: { value: DEFAULT_HUE },
      uBootProgress: { value: 0.0 },
    },
    vertexShader: axonVert,
    fragmentShader: axonFrag,
  });

  const web = new InstancedMesh(tubeGeoInst, webMat, numEdges);
  for (let i = 0; i < numEdges; i++) {
    const e = staticEdges[i];
    dummy.position.set(e.nA.x, e.nA.y, e.nA.z);
    dummy.lookAt(e.nB.x, e.nB.y, e.nB.z);
    dummy.scale.set(1, 1, e.dist);
    dummy.updateMatrix();
    web.setMatrixAt(i, dummy.matrix);
  }
  scene.add(web);

  // Export hero neuron references using HERO_NEURON_INDICES (fix R2 from sketch audit)
  const heroNeurons = HERO_NEURON_INDICES.map((idx) => neurons[idx]);

  function dispose(): void {
    scene.remove(somas);
    scene.remove(web);
    somaGeoInst.dispose();
    somaGeo.dispose();
    somaMat.dispose();
    tubeGeoInst.dispose();
    tubeGeo.dispose();
    webMat.dispose();
  }

  return {
    somas,
    web,
    // pulses live in synapses.ts — placeholder here, set after synapses init
    pulses: null as unknown as InstancedMesh,
    somaMat,
    webMat,
    neurons,
    somaEnergyAttr: attrSomaEnergy,
    synapses: [],
    staticEdges,
    dispose,
    // Extra: hero neurons for render-loop panel extraction
    // Not in the NeuralNetworkHandle interface to keep types clean — accessed via cast
    ..._buildHeroNeurons(heroNeurons),
  };
}

// Exported separately so render-loop can access typed hero neurons
function _buildHeroNeurons(heroNeurons: NeuronData[]): { heroNeurons: NeuronData[] } {
  return { heroNeurons };
}

// Augment the return type inline to expose heroNeurons without polluting NeuralNetworkHandle
export type NeuralNetworkWithHeroes = ReturnType<typeof makeNeuralNetwork> & {
  heroNeurons: NeuronData[];
};
