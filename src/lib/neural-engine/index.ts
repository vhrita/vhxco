// index.ts — Neural Engine entrypoint
// Creates and wires the full Three.js neural engine from a canvas element.
//
// Usage:
//   import { createNeuralEngine } from '@/lib/neural-engine';
//   const engine = createNeuralEngine(canvas);
//   engine.setJourneyProgress(0.5);  // instant camera jump
//   // on cleanup: engine.dispose();
//
// DEV: window.__journey exposes JourneyHandle for harness/QA.

import { createRenderer } from "./renderer.js";
import { generateBrainCloud } from "./brain-cloud.js";
import { makeNeuralNetwork } from "./neurons.js";
import { createSynapses } from "./synapses.js";
import { createRenderLoop } from "./render-loop.js";
import {
  setJourneyT,
  getJourneyT,
  getActiveStop,
  subscribeJourney,
  subscribeActiveStop,
} from "../journey/journey-state.js";
import { STOP_COUNT, stopCenterT } from "./hero-anchors.js";
import type { RenderLoopHandle, JourneyHandle } from "./types.js";

export type { JourneyHandle } from "./types.js";

export interface NeuralEngineOptions {
  animSpeed?: number;
}

export interface NeuralEngineHandle {
  dispose: () => void;
  // Exposed for smoke test inspection
  _loop?: RenderLoopHandle;
  // Journey API (§4.1) — primary API
  journey: JourneyHandle;
}

export function createNeuralEngine(
  canvas: HTMLCanvasElement,
  opts?: NeuralEngineOptions,
): NeuralEngineHandle {
  const ctx = createRenderer(canvas);
  const cloud = generateBrainCloud(ctx.scene);
  const network = makeNeuralNetwork(ctx.scene);
  const synapsesHandle = createSynapses(ctx.scene);

  // Wire pulses into network handle so render-loop can access it
  (network as unknown as Record<string, unknown>).pulses =
    synapsesHandle.pulses;

  const loop = createRenderLoop({
    ctx,
    cloud,
    network,
    synapses: synapsesHandle,
    animSpeed: opts?.animSpeed,
  });

  loop.start();

  // ── JourneyHandle (§4.1) ────────────────────────────────────────────────────
  const journey: JourneyHandle = {
    setJourneyProgress(t: number): void {
      setJourneyT(t);
    },
    getJourneyProgress(): number {
      return getJourneyT();
    },
    getActiveStop(): number {
      return getActiveStop();
    },
    get stopCount(): number {
      return STOP_COUNT;
    },
    stopProgress(stopIndex: number): number {
      return stopCenterT(stopIndex);
    },
    getCameraSnapshot() {
      const cam = ctx.camera;
      const pos = cam.position;
      const q = cam.quaternion;
      return {
        position: [pos.x, pos.y, pos.z] as [number, number, number],
        quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number],
        fov: cam.fov,
      };
    },
  };

  // Expose window.__journey in DEV for QA harness (blueprint §4.1)
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__journey = journey;
  }

  function dispose(): void {
    loop.stop();
    cloud.dispose();
    network.dispose();
    synapsesHandle.dispose();
    ctx.dispose();
  }

  return {
    dispose,
    _loop: loop,
    journey,
  };
}

// Re-export stores for external consumers (HUD, preloader, etc.)
export { bootProgress } from "./boot-progress.js";
// hero-anchors: HERO_NEURON_INDICES removed (no longer indices); export new API instead
export { ANCHOR_POSITIONS, STOP_COUNT, stopCenterT } from "./hero-anchors.js";
// Journey state — subscriptions for consumers that need activeStop changes
export {
  subscribeJourney,
  subscribeActiveStop,
  getJourneyT,
  getActiveStop,
} from "../journey/journey-state.js";
