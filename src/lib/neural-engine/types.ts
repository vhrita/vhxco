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
} from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";

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
}

/**
 * Public handle for programmatic control of the camera journey.
 * Blueprint §4.1 — the source of truth for QA + input adapters.
 *
 * setJourneyProgress(t) is INSTANT — next RAF frame renders exactly f(t).
 * No lerp inside the engine. Easing lives in the input adapter (journey-input.ts,
 * Builder #2).
 */
export interface JourneyHandle {
  /** Position camera at t ∈ [0,1] along the journey path. INSTANT. */
  setJourneyProgress(t: number): void;

  /** Read current t (after any input-layer easing). Hot-path safe. */
  getJourneyProgress(): number;

  /** Index of the nearest stop to current t (for HUD / content). */
  getActiveStop(): number;

  /** Number of journey stops (N). */
  readonly stopCount: number;

  /** t at the center of stop i. QA uses this to capture per-stop frames. */
  stopProgress(stopIndex: number): number;

  /**
   * Camera state at current t — { position, quaternion, fov }.
   * Use for determinism validation across reloads (blueprint §13.7).
   * More reliable than pixel-diff of the 3D layer.
   */
  getCameraSnapshot(): {
    position: [number, number, number];
    quaternion: [number, number, number, number];
    fov: number;
  };
}
