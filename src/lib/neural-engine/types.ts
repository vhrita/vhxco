// types.ts — shared types for the neural engine
// Used across renderer, brain-cloud, neurons, synapses, render-loop

import type {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  InstancedMesh,
  InstancedBufferAttribute,
} from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';

export interface RendererContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  composer: EffectComposer;
  dispose: () => void;
}

export interface BrainCloudHandle {
  points: Points;
  mat: ShaderMaterial;
  dispose: () => void;
}

export interface NeuronData {
  id: number;
  x: number;
  y: number;
  z: number;
  firingRate: number;
  lastFire: number;
  baseSeed: number;
}

export interface EdgeData {
  nA: NeuronData;
  nB: NeuronData;
  dist: number;
}

export interface SynapseData {
  nA: NeuronData;
  nB: NeuronData;
  progress: number;
  speed: number;
}

export interface NeuralNetworkHandle {
  somas: InstancedMesh;
  web: InstancedMesh;
  pulses: InstancedMesh;
  somaMat: ShaderMaterial;
  webMat: ShaderMaterial;
  neurons: NeuronData[];
  somaEnergyAttr: InstancedBufferAttribute;
  synapses: SynapseData[];
  staticEdges: EdgeData[];
  dispose: () => void;
}

export interface RenderLoopHandle {
  start: () => void;
  stop: () => void;
  setPhase: (phase: number, progress: number) => void;
}
