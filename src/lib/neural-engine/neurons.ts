// neurons.ts
// Neural network: 200 soma cell bodies (InstancedMesh icosahedron + snoise displacement)
// plus the static axon web (~600 cylindrical tubes nearest-neighbor).
// Ported 1:1 from vhxco-app.js lines 227-466 (somas + axons).
// Synapses (pulse lifecycle) are in synapses.ts.
//
// R1 (determinism) — blueprint §10, ADR-0020:
//   All position/attribute Math.random() calls replaced by mulberry32 PRNG with
//   a fixed seed. This makes neuron positions (and therefore camera anchors)
//   identical across reloads — required for getCameraSnapshot() reproducibility.
//   lastFire intentionally keeps Math.random() (synapse non-determinism, §13.7).

import {
  IcosahedronGeometry,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  CylinderGeometry,
  ShaderMaterial,
  Object3D,
  AdditiveBlending,
} from "three";
import type { Scene } from "three";
import somaVert from "./shaders/soma.vert.glsl";
import somaFrag from "./shaders/soma.frag.glsl";
import axonVert from "./shaders/axon.vert.glsl";
import axonFrag from "./shaders/axon.frag.glsl";
import type { NeuronData, EdgeData, NeuralNetworkHandle } from "./types.js";

// ─── mulberry32 PRNG — fast, seedable, well-distributed ──────────────────────
// Source: https://github.com/nicowillis/mulberry32
// Fixed seed → identical sequence across reloads (R1 contract).

const NEURONS_SEED = 0xdeadbeef;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

// Constants preserved from v0
const MAX_NEURONS = 200;
const DEFAULT_HUE = 200 / 360;

export function makeNeuralNetwork(scene: Scene): NeuralNetworkHandle {
  // Single PRNG instance for the entire neuron/axon setup.
  // Call order below must not change — determines positions.
  const rand = mulberry32(NEURONS_SEED);

  const neurons: NeuronData[] = [];
  const staticEdges: EdgeData[] = [];

  // 1. GENERATE NEURONS — rejection sampling inside 4 brain ellipsoids (v0 lines 235-255)
  //    Uses seeded PRNG — positions are identical on every reload (R1).
  for (let i = 0; i < MAX_NEURONS; i++) {
    let x: number, y: number, z: number;

    while (true) {
      // R1: seeded rand() replaces Math.random()
      x = rand() * 12.0 - 6.0;
      y = rand() * 11.0 - 5.5;
      z = rand() * 8.0 - 4.0;

      const r1 =
        Math.pow(x / 5.5, 2) +
        Math.pow((y - 1.0) / 3.5, 2) +
        Math.pow(z / 4.0, 2);
      const r2 =
        Math.pow((x + 2.0) / 4.0, 2) +
        Math.pow((y + 0.5) / 2.5, 2) +
        Math.pow(z / 3.0, 2);
      const r3 =
        Math.pow((x + 3.5) / 2.0, 2) +
        Math.pow((y + 2.5) / 1.5, 2) +
        Math.pow(z / 2.0, 2);
      const r4 =
        Math.pow((x + 1.0) / 1.0, 2) +
        Math.pow((y + 4.0) / 2.0, 2) +
        Math.pow(z / 1.0, 2);

      if (r1 <= 1.0 || r2 <= 1.0 || r3 <= 1.0 || r4 <= 1.0) break;
    }

    neurons.push({
      id: i,
      x,
      y,
      z,
      firingRate: rand() * 0.5 + 0.1, // R1: seeded
      lastFire: Math.random() * -5, // intentionally non-deterministic (§13.7)
      baseSeed: rand() * 100, // R1: seeded
    });
  }

  // 2. GENERATE STATIC AXON WEB — 3 nearest neighbors per neuron (v0 lines 265-279)
  for (let i = 0; i < MAX_NEURONS; i++) {
    const nA = neurons[i];
    const neighbors = neurons
      .filter((nB) => nB.id !== nA.id)
      .map((nB) => ({
        nB,
        d: Math.hypot(nA.x - nB.x, nA.y - nB.y, nA.z - nB.z),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);

    neighbors.forEach((nn) => {
      // Prevent duplicate undirected edges
      if (
        !staticEdges.find(
          (e) =>
            (e.nA === nA && e.nB === nn.nB) || (e.nA === nn.nB && e.nB === nA),
        )
      ) {
        staticEdges.push({ nA, nB: nn.nB, dist: nn.d });
      }
    });
  }

  // 3. SOMAS — InstancedMesh icosahedron (v0 lines 282-405)
  const somaGeo = new IcosahedronGeometry(0.12, 4);
  // Three.js types: InstancedBufferGeometry.copy() signature is overly strict (InstancedBufferGeometry),
  // but at runtime it accepts any BufferGeometry. Cast to bypass — runtime safe.
  const somaGeoInst = new InstancedBufferGeometry().copy(
    somaGeo as unknown as InstancedBufferGeometry,
  );
  somaGeoInst.instanceCount = MAX_NEURONS;

  const somaEnergy = new Float32Array(MAX_NEURONS);
  const somaSeed = new Float32Array(MAX_NEURONS);
  const somaBirth = new Float32Array(MAX_NEURONS);

  for (let i = 0; i < MAX_NEURONS; i++) {
    somaSeed[i] = neurons[i].baseSeed;
    somaBirth[i] = i < 2 ? 0.0 : 0.85;
  }

  const attrSomaEnergy = new InstancedBufferAttribute(somaEnergy, 1);
  somaGeoInst.setAttribute("aEnergy", attrSomaEnergy);
  somaGeoInst.setAttribute("aSeed", new InstancedBufferAttribute(somaSeed, 1));
  somaGeoInst.setAttribute(
    "aBirth",
    new InstancedBufferAttribute(somaBirth, 1),
  );

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
    const s = 0.6 + rand() * 0.6; // R1: seeded
    dummy.scale.set(s, s, s);
    dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, 0); // R1: seeded
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
  const tubeGeoInst = new InstancedBufferGeometry().copy(
    tubeGeo as unknown as InstancedBufferGeometry,
  );
  tubeGeoInst.instanceCount = numEdges;

  const tubeSeed = new Float32Array(numEdges);
  for (let i = 0; i < numEdges; i++) tubeSeed[i] = rand() * 100.0; // R1: seeded
  tubeGeoInst.setAttribute("aSeed", new InstancedBufferAttribute(tubeSeed, 1));

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
  };
}
