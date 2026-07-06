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
//
// Phase 4b-2 (+ rework): Cinematic intro dolly.
//   - Camera is parked FAR (INTRO_START_POS, derived from brain bounding radius +
//     FOV/aspect so the whole brain fits) during boot. With the preloader now
//     transparent, the "brain being born" (uBootProgress) is seen forming from
//     a distance — the reveal is the loading moment.
//   - On boot-complete (bootProgress.value >= 1), camera dollies from that far
//     start to curve.getPointAt(0) over INTRO_MS ms with cubic-out easing,
//     looking at BRAIN_CENTER the whole way. During intro render() drives the
//     camera directly; f(t) resumes after.
//   - prefers-reduced-motion: intro skipped entirely, camera starts at f(0).
//   - Fires window.dispatchEvent(new CustomEvent('journey:intro-done')) on land.
//   - a11y-safe: body.dataset.intro tracks state for CSS content-hiding.

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

// ─── Intro dolly constants (Phase 4b-2 rework) ──────────────────────────────
// The old start (0,0,14) sat *inside* the brain cloud: the cerebrum ellipsoid
// alone spans x∈[-6.5,6.5], y∈[-3.5,5.5], z∈[-5,5] (brain-cloud.ts), so at z=14
// the camera is only ~9 units past the front surface — huge zoom, no silhouette.
//
// Rework: start REALLY far so the whole brain reads as a "brain drawing", then
// dolly in to f(0). Distance is derived from the cloud bounding radius + the
// real camera FOV/aspect (NOT a magic number), computed at start() when the
// aspect is known.
//
// BRAIN_BOUND_R: farthest distance from BRAIN_CENTER to any brain-cloud AABB
// corner. Cloud = union of 4 ellipsoids (brain-cloud.ts) + 0.4 noise:
//   AABB = [-7.4,-6.9,-5.4] .. [6.9,5.9,5.4]  →  farthest corner from
//   BRAIN_CENTER(-0.5,0.3,0) is (6.9,5.9,5.4) at ‖·‖ ≈ 11.65.
const BRAIN_BOUND_R = 11.65;

// INTRO_MARGIN: extra breathing room so the brain doesn't kiss the frame edge.
const INTRO_MARGIN = 1.3;

// INTRO_DIR: unit direction from BRAIN_CENTER to the dolly start. Front-dominant
// (+z ≈ 0.83) with elevation (+y ≈ 0.48) and slight +x — an elevated front-3/4
// reveal that reads as a recognizable brain profile, then dives down-forward to
// the top-front landing f(0)=(0,2,0.5). Looking at BRAIN_CENTER the whole way
// keeps the brain framed (no outward lookAt → no void).
const INTRO_DIR = Object.freeze(new Vector3(0.289, 0.48, 0.828));

// INTRO_START_POS: filled in at start() from computeIntroStartPos(camera).
// Mutable (not frozen) — depends on runtime aspect ratio.
const INTRO_START_POS = new Vector3();

/**
 * Distance the camera must sit from BRAIN_CENTER so a sphere of radius
 * BRAIN_BOUND_R fits inside the frustum, using whichever of the vertical or
 * horizontal FOV is the *limiting* (narrower) one. On desktop the vertical FOV
 * limits; in portrait (mobile) the horizontal FOV is much narrower and limits,
 * so the brain is pushed further back to still fit whole.
 */
function computeIntroStartPos(
  camera: RendererContext["camera"],
  out: Vector3,
): void {
  const halfV = ((camera.fov * Math.PI) / 180) / 2;
  // Horizontal half-FOV from vertical + aspect.
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  // Limiting (smaller) half-angle drives the distance.
  const halfLimit = Math.min(halfV, halfH);
  const dist = (BRAIN_BOUND_R * INTRO_MARGIN) / Math.tan(halfLimit);
  out.copy(BRAIN_CENTER).addScaledVector(INTRO_DIR, dist);
}

/**
 * Duration of the dolly-in animation in milliseconds. Bumped from 1200 → 2200:
 * the travel is now ~20-40 units (vs ~14 before), so a longer tween keeps the
 * movement cinematic rather than a rushed snap.
 */
const INTRO_MS = 2200;

/** Cubic-out easing: fast start, decelerates into landing. */
function _cubicOut(p: number): number {
  return 1 - Math.pow(1 - p, 3);
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

  // ── Intro dolly state (Phase 4b-2 rework) ─────────────────────────────────
  // introPending: camera is parked FAR at INTRO_START_POS, waiting for boot complete.
  // introActive: dolly is running — render() drives camera, ignores getJourneyT().
  // introStart: performance.now() / 1000 snapshot when dolly fired.
  let introPending = false;
  let introActive = false;
  let introStart = 0;

  // Reusable Vector3 for lerp during intro (avoids GC per frame)
  const _introPos = new Vector3();

  // ── QA-only intro-debug hook (opt-in via ?introDebug) ─────────────────────
  // Lets QA freeze the dolly at a fixed progress p to capture deterministic
  // frames (p=0 far start / p=0.5 mid / p=1 landing) instead of racing a ~2.2s
  // animation on slow SwiftShader. NO effect unless the URL flag is present, so
  // production is untouched. Not gated on import.meta.env.DEV because QA runs
  // against the preview (prod) build too.
  const introDebug =
    typeof window !== "undefined" &&
    /[?&]introDebug\b/.test(window.location.search);
  let introDebugP: number | null = null; // when set, freezes dolly at this p

  function render(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - prevTime, 0.1);
    prevTime = now;
    const t_anim = (now - startTime) * animSpeed;

    // ── Camera: intro dolly state machine (Phase 4b-2) ───────────────────────
    if (introPending && bootProgress.value >= 1) {
      // Boot just completed — fire the dolly
      introPending = false;
      introActive = true;
      introStart = now;
    }

    if (introActive) {
      // Drive camera through dolly tween — ignore journey t.
      // QA introDebug: when a frozen p is set, use it (raw, no time advance) so
      // the frame is deterministic; otherwise advance by wall-clock as normal.
      const timeRawP = (now - introStart) / (INTRO_MS / 1000);
      const rawP =
        introDebug && introDebugP !== null ? introDebugP : timeRawP;
      const p = _cubicOut(Math.min(rawP, 1));

      // Landing position: curve start point (same target as applyCameraF at t=0)
      const landPos = curve.getPointAt(0);
      lerpV3(_introPos, INTRO_START_POS, landPos, p);
      ctx.camera.position.copy(_introPos);

      // Keep up before lookAt (always required for Three.js lookAt to orient correctly)
      ctx.camera.up.set(0, 1, 0);
      ctx.camera.lookAt(BRAIN_CENTER);

      // QA introDebug freezes the dolly (never auto-completes); otherwise the
      // dolly lands and hands off to f(t) once the tween reaches the end.
      const frozen = introDebug && introDebugP !== null;
      if (!frozen && rawP >= 1) {
        // Dolly landed — hand off to f(t) on next frame
        introActive = false;
        // Remove intro marker so CSS content rules deactivate
        if (typeof document !== "undefined") {
          delete document.body.dataset.intro;
        }
        // Signal DOM that intro is done (content fade-in hooks, etc.)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("journey:intro-done"));
        }
      }
    } else if (!introPending) {
      // Normal journey mode — fully deterministic f(t)
      // Read authoritative journey t — INSTANT, no lerp here (blueprint §4.2)
      const t = getJourneyT();

      // ── Camera f(t) ────────────────────────────────────────────────────────
      applyCameraF(ctx, t, curve);

      // ── Nearest stop → light up closest neuron ──────────────────────────────
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
    }

    // ── Brain cloud uniforms (runs every frame, including during intro) ────────
    const tJourney = getJourneyT(); // t for cloud rotation; 0 during pending/intro
    cloud.mat.uniforms.uTime.value = t_anim;
    cloud.mat.uniforms.uHue.value = 200 / 360;
    cloud.mat.uniforms.uBootProgress.value = bootProgress.value;

    // Cloud rotation (preserved from v0)
    const rotSpeed = lerp(0.05, 0.01, tJourney);
    cloud.points.rotation.y = t_anim * rotSpeed;
    cloud.points.rotation.x = Math.sin(t_anim * 0.02) * 0.1;

    // ── Neural network updates (runs every frame) ─────────────────────────────
    updateSomaEnergy(network, t_anim);
    network.somaMat.uniforms.uTime.value = t_anim;
    network.webMat.uniforms.uTime.value = t_anim;
    network.somaMat.uniforms.uBootProgress.value = bootProgress.value;
    network.webMat.uniforms.uBootProgress.value = bootProgress.value;
    network.somaMat.uniforms.uHue.value = 200 / 360;
    network.webMat.uniforms.uHue.value = 200 / 360;

    // ── Synapses (runs every frame) ───────────────────────────────────────────
    synapses.update(t_anim, dt, network.neurons, network.staticEdges);

    // ── Compose + render ──────────────────────────────────────────────────────
    ctx.composer.render();

    if (running) rafId = requestAnimationFrame(render);
  }

  function start(): void {
    if (running) return;
    running = true;
    startTime = performance.now() / 1000;
    prevTime = startTime;

    // Phase 4b-2: intro dolly — check prefers-reduced-motion (§9 / a11y)
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      // Skip intro entirely — place camera at f(0) immediately
      introPending = false;
      introActive = false;
      applyCameraF(ctx, 0, curve);
    } else {
      // Compute the far start from the real aspect ratio (frames whole brain),
      // then park the camera there — the dolly fires when bootProgress >= 1.
      // Parking far during boot is intentional: the transparent preloader lets
      // the "brain being born" (uBootProgress) be seen forming from a distance.
      computeIntroStartPos(ctx.camera, INTRO_START_POS);
      introPending = true;
      introActive = false;
      ctx.camera.position.copy(INTRO_START_POS);
      ctx.camera.up.set(0, 1, 0);
      ctx.camera.lookAt(BRAIN_CENTER);
      // Mark body so CSS can hide content panels during intro
      if (typeof document !== "undefined") {
        document.body.dataset.intro = "active";
      }
    }

    // QA-only: expose a deterministic driver for the intro dolly (opt-in flag).
    if (introDebug && typeof window !== "undefined") {
      // Force boot to complete so the brain is fully formed for framing shots.
      bootProgress.set(1);
      (window as unknown as Record<string, unknown>).__introDebug = {
        /** Freeze the dolly at progress p ∈ [0,1] (0=far start, 1=landing). */
        setP(p: number): void {
          introPending = false;
          introActive = true;
          introDebugP = Math.max(0, Math.min(1, p));
        },
        /** Current camera world position [x,y,z]. */
        cam(): [number, number, number] {
          const c = ctx.camera.position;
          return [c.x, c.y, c.z];
        },
        /** The computed far start position (for framing assertions). */
        startPos(): [number, number, number] {
          return [INTRO_START_POS.x, INTRO_START_POS.y, INTRO_START_POS.z];
        },
      };
    }

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
