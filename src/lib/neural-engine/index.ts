// index.ts — Neural Engine entrypoint
// Creates and wires the full Three.js neural engine from a canvas element.
//
// Usage:
//   import { createNeuralEngine } from '@/lib/neural-engine';
//   const engine = createNeuralEngine(canvas);
//   engine.setPhase(1, 0.375);
//   // on cleanup: engine.dispose();

import { createRenderer } from './renderer.js';
import { generateBrainCloud } from './brain-cloud.js';
import { makeNeuralNetwork } from './neurons.js';
import { createSynapses } from './synapses.js';
import { createRenderLoop } from './render-loop.js';
import type { RenderLoopHandle } from './types.js';

export interface NeuralEngineOptions {
  animSpeed?: number;
}

export interface NeuralEngineHandle {
  dispose: () => void;
  setPhase: (phase: number, progress: number) => void;
  // Exposed for smoke test inspection
  _loop?: RenderLoopHandle;
}

export function createNeuralEngine(
  canvas: HTMLCanvasElement,
  opts?: NeuralEngineOptions
): NeuralEngineHandle {
  const ctx = createRenderer(canvas);
  const cloud = generateBrainCloud(ctx.scene);
  const network = makeNeuralNetwork(ctx.scene);
  const synapsesHandle = createSynapses(ctx.scene);

  // Wire pulses into network handle so render-loop can access it
  // (synapses.ts manages pulses independently, network just stores ref)
  (network as unknown as Record<string, unknown>).pulses = synapsesHandle.pulses;

  const loop = createRenderLoop({
    ctx,
    cloud,
    network,
    synapses: synapsesHandle,
    animSpeed: opts?.animSpeed,
  });

  loop.start();

  function dispose(): void {
    loop.stop();
    cloud.dispose();
    network.dispose();
    synapsesHandle.dispose();
    ctx.dispose();
  }

  return {
    dispose,
    setPhase: loop.setPhase,
    _loop: loop,
  };
}

// Re-export stores for external consumers (HUD, preloader, etc.)
export { bootProgress } from './boot-progress.js';
export { phaseStore } from './phase-state.js';
export { HERO_NEURON_INDICES } from './hero-anchors.js';
