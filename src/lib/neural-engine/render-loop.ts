// render-loop.ts
// 60fps RAF render loop with camera-journey f(t) (ADR-0020).
//
// Architecture changes from v0 (blueprint §2.3 / §4):
//   - Removed: dual-mode camera (orbital / anchored), lerp(progress, target, 0.07),
//     progressToPhase, phase-orchestrator dependency.
//   - Installed: Catmull-Rom curve over N anchor positions (stops.config.ts),
//     f(t) = camera_state = pure function of t_journey (INSTANT, no lerp inside f).
//     lookAt with anticipation; lead→0 at extremes + tangent fallback.
//   - Journey t authority: minimal inline store (journey-state, Builder#2 extracts
//     to src/lib/journey/journey-state.ts and Builder#2 connects input adapter).
//   - Nearest-stop lighting replaces old hero-neuron panel-extraction trigger.
//
// Three.js 0.184 note: Clock is deprecated since r183 — using performance.now().
//
// Retained: brain cloud rotation, soma energy, uniforms uTime/uHue/uBootProgress.

import { Vector3, CatmullRomCurve3 } from "three";
import type {
  RendererContext,
  BrainCloudHandle,
  NeuralNetworkHandle,
} from "./types.js";
import type { SynapsesHandle } from "./synapses.js";
import { bootProgress } from "./boot-progress.js";
import type { RenderLoopHandle } from "./types.js";
import {
  ANCHOR_POSITIONS,
  STOP_COUNT,
  STOP_ARC_T,
  computeNearestNeuronIndices,
  nearestStopIndex,
} from "./hero-anchors.js";
import type { NeuronData } from "./types.js";
// Builder#2: store extracted to journey-state.ts — import from there (single source of truth)
import {
  setJourneyT,
  getJourneyT,
  getActiveStop,
  subscribeJourney,
} from "../journey/journey-state.js";

// Re-export so index.ts can still wire JourneyHandle without reaching into journey-state directly
export { setJourneyT, getJourneyT, getActiveStop, subscribeJourney };

// ─── Lerp utilities ───────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpV3(
  out: Vector3,
  a: Readonly<Vector3>,
  b: Readonly<Vector3>,
  t: number,
): void {
  out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

// ─── Soma energy update ───────────────────────────────────────────────────────
function updateSomaEnergy(network: NeuralNetworkHandle, t: number): void {
  const somaEnergy = network.somaEnergyAttr.array as Float32Array;
  for (let i = 0; i < network.neurons.length; i++) {
    const n = network.neurons[i];
    const timeSinceFire = t - n.lastFire;
    somaEnergy[i] = timeSinceFire < 1.5 ? 1.0 - timeSinceFire / 1.5 : 0;
  }
  network.somaEnergyAttr.needsUpdate = true;
}

// ─── Params ───────────────────────────────────────────────────────────────────

export interface RenderLoopParams {
  ctx: RendererContext;
  cloud: BrainCloudHandle;
  network: NeuralNetworkHandle;
  synapses: SynapsesHandle;
  animSpeed?: number;
}

// ─── Camera-journey f(t) setup ────────────────────────────────────────────────
// Catmull-Rom curve built once at init from ANCHOR_POSITIONS.
// getPointAt(t) uses arc-length parameterization → uniform visual speed.
// lookAt: anticipation (camera "looks where it's going", lead ≈ 0.03) blended
// with INWARD_BIAS toward BRAIN_CENTER — prevents void frames at extremes and
// sparse mid-curve segments. At t≈0/t≈1 extremes: pure BRAIN_CENTER (no tangent).
// Phase 4b-1: tangent fallback replaced + camera.up ordered before lookAt.

const LEAD = 0.03; // anticipation amount (tunable)
const LEAD_RAMP_WINDOW = 0.05; // t window near 0/1 where lead ramps to 0

// Inward bias — pulls lookAt gently toward the dense cerebrum mass.
// Anticipation remains dominant (INWARD_BIAS < 0.5); prevents tangent/anticipation
// escaping to void at extremes and sparse mid-curve segments.
// BRAIN_CENTER ≈ weighted centroid of cerebrum (0,1,0) + occipital (-2,-0.5,0).
const BRAIN_CENTER = Object.freeze(new Vector3(-0.5, 0.3, 0));
const INWARD_BIAS = 0.25; // fraction toward BRAIN_CENTER (tunable, 0=pure anticipation)

function buildCurve(): CatmullRomCurve3 {
  // CatmullRomCurve3 needs mutable Vector3 — clone from frozen positions
  const pts = ANCHOR_POSITIONS.map((p) => p.clone());
  return new CatmullRomCurve3(pts, false, "catmullrom", 0.5);
}

const _camPos = new Vector3();
const _lookTarget = new Vector3();
const _anticipation = new Vector3();

function applyCameraF(
  ctx: RendererContext,
  t: number,
  curve: CatmullRomCurve3,
): void {
  const { camera } = ctx;

  // Position — arc-length uniform
  curve.getPointAt(t, _camPos);
  camera.position.copy(_camPos);

  // lookAt with anticipation + inward bias (blueprint §3.2 edge cases + 4b-1 void fix)
  //
  // Base target:
  //   - mid-curve: anticipation point at t+effectiveLead (camera "looks where it's going")
  //   - extremes (effectiveLead < 0.001): BRAIN_CENTER directly (tangent fallback caused void)
  //
  // Inward bias: lerp the base target 25% toward BRAIN_CENTER so the lookAt never
  // wanders far from the dense cerebrum mass. Anticipation still dominates (75%).
  const nearEdge = Math.min(
    t / LEAD_RAMP_WINDOW,
    (1 - t) / LEAD_RAMP_WINDOW,
    1,
  );
  const effectiveLead = LEAD * nearEdge;

  if (effectiveLead < 0.001) {
    // At extremes: look toward BRAIN_CENTER (was: tangent → pointed out of brain at t=1)
    _anticipation.copy(BRAIN_CENTER);
  } else {
    curve.getPointAt(Math.min(t + effectiveLead, 1), _anticipation);
  }

  // Blend anticipation with BRAIN_CENTER — keeps traversal feeling intact,
  // prevents lookAt drifting into void on sparse/peripheral curve segments.
  lerpV3(_lookTarget, _anticipation, BRAIN_CENTER, INWARD_BIAS);

  // Roll: sin wave along journey for organic feel (preserved from v0).
  // MUST set camera.up BEFORE lookAt — lookAt consumes up to orient the camera.
  const roll = Math.sin(t * Math.PI * 3) * 0.2;
  camera.up.set(roll, 1, 0);

  camera.lookAt(_lookTarget);
}

// ─── createRenderLoop ─────────────────────────────────────────────────────────

export function createRenderLoop(params: RenderLoopParams): RenderLoopHandle {
  const { ctx, cloud, network, synapses } = params;
  const animSpeed = params.animSpeed ?? 0.4;

  // Build Catmull-Rom curve once from deterministic anchor positions
  const curve = buildCurve();

  // Precompute nearest neuron for each stop (for soma lighting)
  const nearestNeuronIndices = computeNearestNeuronIndices(network.neurons);

  let rafId = 0;
  let running = false;

  let startTime = 0;
  let prevTime = 0;

  function render(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - prevTime, 0.1);
    prevTime = now;
    const t_anim = (now - startTime) * animSpeed;

    // Read authoritative journey t — INSTANT, no lerp here (blueprint §4.2)
    const t = getJourneyT();

    // ── Camera f(t) ──────────────────────────────────────────────────────────
    applyCameraF(ctx, t, curve);

    // ── Nearest stop → light up closest neuron ───────────────────────────────
    const stopIdx = nearestStopIndex(t);
    const nearestNeuronIdx = nearestNeuronIndices[stopIdx];
    if (nearestNeuronIdx !== undefined && network.neurons[nearestNeuronIdx]) {
      const neuron = network.neurons[nearestNeuronIdx] as NeuronData;
      // Keep soma lit while near its stop (within ~half the inter-stop distance)
      // Use arc-length t of this stop — not the naive stopIdx/(N-1) (blueprint §3.3)
      const stopCenter =
        STOP_ARC_T[stopIdx] ?? stopIdx / Math.max(1, STOP_COUNT - 1);
      const dist = Math.abs(t - stopCenter);
      if (dist < 0.15) {
        neuron.lastFire = t_anim + 0.1;
      }
    }

    // ── Brain cloud uniforms ─────────────────────────────────────────────────
    cloud.mat.uniforms.uTime.value = t_anim;
    cloud.mat.uniforms.uHue.value = 200 / 360;
    cloud.mat.uniforms.uBootProgress.value = bootProgress.value;

    // Cloud rotation (preserved from v0)
    const rotSpeed = lerp(0.05, 0.01, t);
    cloud.points.rotation.y = t_anim * rotSpeed;
    cloud.points.rotation.x = Math.sin(t_anim * 0.02) * 0.1;

    // ── Neural network updates ───────────────────────────────────────────────
    updateSomaEnergy(network, t_anim);
    network.somaMat.uniforms.uTime.value = t_anim;
    network.webMat.uniforms.uTime.value = t_anim;
    network.somaMat.uniforms.uBootProgress.value = bootProgress.value;
    network.webMat.uniforms.uBootProgress.value = bootProgress.value;
    network.somaMat.uniforms.uHue.value = 200 / 360;
    network.webMat.uniforms.uHue.value = 200 / 360;

    // ── Synapses ─────────────────────────────────────────────────────────────
    synapses.update(t_anim, dt, network.neurons, network.staticEdges);

    // ── Compose + render ─────────────────────────────────────────────────────
    ctx.composer.render();

    if (running) rafId = requestAnimationFrame(render);
  }

  function start(): void {
    if (running) return;
    running = true;
    startTime = performance.now() / 1000;
    prevTime = startTime;
    // Position camera at stop[0] before first frame
    applyCameraF(ctx, 0, curve);
    rafId = requestAnimationFrame(render);
  }

  function stop(): void {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  return { start, stop };
}
