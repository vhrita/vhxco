// hero-anchors.ts
// Journey stop anchors — N frozen Vector3 positions + "nearest neuron lights up" logic.
//
// Blueprint §3.2 D2: anchors are fixed design-time Vector3, NOT indices into the
// Math.random() neuron array. This makes f(t) deterministic without depending on
// PRNG call-order across modules.
//
// Previously: HERO_NEURON_INDICES = [15, 50, 85, 150] (4 magic numbers)
// Now: STOPS positions from stops.config.ts, N parametrizable.

import { Vector3 } from "three";
import { STOPS, STOP_COUNT } from "../journey/stops.config.js";
import type { NeuronData } from "./types.js";

// ─── Exported stop positions (frozen Vector3) ─────────────────────────────────

/** Frozen anchor positions for each journey stop, in order. */
export const ANCHOR_POSITIONS: ReadonlyArray<Readonly<Vector3>> = STOPS.map(
  (s) => s.position,
);

/** Number of journey stops. Use this — never hardcode 5. */
export { STOP_COUNT };

// ─── Nearest-neuron lookup ────────────────────────────────────────────────────

/**
 * Given the full neuron list (post-init), returns the index of the neuron
 * closest to each anchor position.
 * Call once at init; store the result.
 */
export function computeNearestNeuronIndices(neurons: NeuronData[]): number[] {
  return ANCHOR_POSITIONS.map((anchor) => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      const d = Math.hypot(anchor.x - n.x, anchor.y - n.y, anchor.z - n.z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  });
}

/**
 * Given t ∈ [0,1] and N stops, returns the index of the nearest stop.
 * Used by the render-loop to light up the nearest neuron and by the journey
 * store to compute activeStop.
 */
export function nearestStopIndex(t: number): number {
  // Uniform distribution: stop i centered at i/(N-1)
  const N = STOP_COUNT;
  if (N === 1) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < N; i++) {
    const center = i / (N - 1);
    const d = Math.abs(t - center);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Returns t ∈ [0,1] for the center of stop i.
 * Used by stopProgress(i) in JourneyHandle.
 */
export function stopCenterT(i: number): number {
  const N = STOP_COUNT;
  if (N <= 1) return 0;
  return i / (N - 1);
}
