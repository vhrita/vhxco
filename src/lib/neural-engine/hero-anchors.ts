// hero-anchors.ts
// Journey stop anchors — N frozen Vector3 positions + arc-length stop mapping.
//
// Blueprint §3.2 D2: anchors are fixed design-time Vector3, NOT indices into the
// Math.random() neuron array. This makes f(t) deterministic without depending on
// PRNG call-order across modules.
//
// Blueprint §3.3: stopCenterT(i) must return the arc-length t of anchor i on the
// CatmullRom curve — NOT i/(N-1). CatmullRom passes through control points at
// parametric u = i/(N-1), but arc-length t ≠ u for unequally-spaced anchors.
// We build the curve once here, sample 200 cumulative lengths, then map each
// anchor's parametric u to its true arc-length t by linear interpolation.
//
// Previously: HERO_NEURON_INDICES = [15, 50, 85, 150] (4 magic numbers)
// Now: STOPS positions from stops.config.ts, N parametrizable.

import { Vector3, CatmullRomCurve3 } from "three";
import { STOPS, STOP_COUNT } from "../journey/stops.config.js";
import type { NeuronData } from "./types.js";

// ─── Exported stop positions (frozen Vector3) ─────────────────────────────────

/** Frozen anchor positions for each journey stop, in order. */
export const ANCHOR_POSITIONS: ReadonlyArray<Readonly<Vector3>> = STOPS.map(
  (s) => s.position,
);

/** Number of journey stops. Use this — never hardcode 5. */
export { STOP_COUNT };

// ─── Arc-length stop t values (blueprint §3.3) ───────────────────────────────
//
// CatmullRomCurve3 passes through control point i at parametric u = i/(N-1).
// getLengths(SAMPLES) returns cumulative arc lengths at SAMPLES+1 evenly-spaced
// parametric u values: lengths[k] = arc length at u = k/SAMPLES.
// Total arc length = lengths[SAMPLES].
// To find arc-length t for anchor i: parametric u_i = i/(N-1); find its
// cumulative length by interpolating into lengths[]; divide by total length.

const ARC_SAMPLES = 200;

function computeStopArcT(
  anchors: ReadonlyArray<Readonly<Vector3>>,
  N: number,
): number[] {
  if (N <= 1) return [0];
  // Build curve — CatmullRomCurve3 requires mutable Vector3
  const pts = anchors.map((p) => p.clone());
  const curve = new CatmullRomCurve3(pts, false, "catmullrom", 0.5);

  // lengths[k] = cumulative arc length at parametric u = k/ARC_SAMPLES
  const lengths = curve.getLengths(ARC_SAMPLES);
  const totalLen = lengths[lengths.length - 1] ?? 1;

  return Array.from({ length: N }, (_, i) => {
    // Parametric u of anchor i on the curve
    const u = i / (N - 1);
    // Index into lengths array (length[k] is at u = k/ARC_SAMPLES)
    const k = u * ARC_SAMPLES;
    const k0 = Math.floor(k);
    const k1 = Math.min(k0 + 1, ARC_SAMPLES);
    const frac = k - k0;
    const len0 = lengths[k0] ?? 0;
    const len1 = lengths[k1] ?? len0;
    const arcLen = len0 + (len1 - len0) * frac;
    return arcLen / totalLen;
  });
}

/**
 * Arc-length t values for each stop anchor.
 * STOP_ARC_T[i] is the arc-length t ∈ [0,1] at which CatmullRom passes
 * through anchor i. Use instead of i/(N-1) everywhere.
 * Blueprint §3.3.
 */
export const STOP_ARC_T: ReadonlyArray<number> = computeStopArcT(
  ANCHOR_POSITIONS,
  STOP_COUNT,
);

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
 * Given t ∈ [0,1] returns the index of the nearest stop.
 * Uses STOP_ARC_T (arc-length positions) — not the naive i/(N-1).
 * Used by the render-loop to light up the nearest neuron and by the journey
 * store to compute activeStop.
 */
export function nearestStopIndex(t: number): number {
  const N = STOP_COUNT;
  if (N === 1) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < N; i++) {
    const center = STOP_ARC_T[i] ?? i / (N - 1);
    const d = Math.abs(t - center);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Returns the arc-length t ∈ [0,1] at the center of stop i.
 * Used by stopProgress(i) in JourneyHandle (blueprint §3.3).
 * NOT the naive i/(N-1) — that would be wrong for unequally-spaced anchors.
 */
export function stopCenterT(i: number): number {
  return STOP_ARC_T[i] ?? 0;
}
