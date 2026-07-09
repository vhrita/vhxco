// journey-input.ts
// Input adapter for the camera journey — replaces phase-orchestrator.ts.
//
// Blueprint §4.2 / §4.4 / §7 / §8 / §9:
//
//   LAYER RESPONSIBILITY:
//     This module owns the EASING. setJourneyT() in journey-state.ts is INSTANT.
//     Human scroll/swipe → this adapter accumulates intent → applies lerp easing
//     → calls setJourneyT(easedT). QA/programmatic calls setJourneyT() directly
//     (bypasses this adapter) and gets instant positioning.
//
//   RAF ORDERING (§7 — critical, do not reorder):
//     Per-tick sequence:
//       1. input RAF: _applyEasing() → setJourneyT(easedT)
//       2. render RAF: t = getJourneyT(); camera = f(t)
//     Both run on separate requestAnimationFrame. Browser guarantees RAF callbacks
//     fire in registration order within the same frame, so input (registered first)
//     writes before render reads. Order preserved by design — do not move easing
//     inside render-loop.ts f(t) or it re-introduces the lerp-in-camera bug.
//
//   EASING:
//     _target holds the DESTINATION stop's arc-length t (set by the discrete
//     stepper). Each RAF: _easedT = lerp(_easedT, _target, ALPHA), until it
//     converges — then the RAF PARKS (perf P2) and re-arms on the next input.
//     ALPHA = 0.08 (80ms feel-lag at 60fps). Preserved from old render-loop lerp.
//     Result: humans feel a fluid glide, QA bypasses and gets instant.
//
//   REDUCED-MOTION (§9):
//     `prefers-reduced-motion: reduce` → easing disabled (ALPHA = 1 = instant).
//     Wheel/touch snaps to nearest stop (next/prev on each event), no in-between t.
//     IntersectionObserver not used — simpler, no DOM dependency.
//
//   REMOVED vs phase-orchestrator.ts:
//     - magnetic snap (SNAP_THRESHOLDS / SNAP_TOLERANCE / SNAP_ESCAPE_DIST)
//     - scroll-lock (SCROLL_LOCK_AUTO_MS / SCROLL_LOCK_MANUAL_MS)
//     - _activePhaseHasScroll guard (blueprint §2.3 — dies with scroll-in-div law)
//     - reduced-motion IntersectionObserver + scrollIntoView
//     - progressToPhase hardcoded to PHASE_COUNT=5
//
//   TOUCH (§8):
//     Swipe ↑/↓ advances/retracts t. No hover dependency.
//
//   HUD / KEYBOARD:
//     hud:goto-phase → setJourneyT(stopProgress(i)) via easing (smooth)
//     ArrowUp/Down, PageUp/Down, Space → step ±1 stop (discrete)
//     Home/End → stop[0]/stop[N-1]
//
//   SCROLL CALIBRATION (fix — see _stepStop / _onWheel):
//     wheel/touch are DISCRETE now — one gesture = one stop step, index-clamped
//     to [0, STOP_COUNT-1]. Kills the old "extra scroll per stop" + the phantom
//     dead-range past the last anchor (which sat at the t=1.0 clamp ceiling).

import { setJourneyT, getJourneyT, subscribeJourney } from "./journey-state.js";
import {
  STOP_COUNT,
  stopCenterT,
  nearestStopIndex,
} from "../neural-engine/hero-anchors.js";
import { markJourneyInteraction } from "./interaction-signal.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Easing factor per RAF tick. 0.08 ≈ feels smooth at 60fps. */
const ALPHA = 0.08;

// ── Discrete stop-stepping (scroll calibration fix) ───────────────────────────
//
// WHY DISCRETE (root-cause of the "1 extra scroll" bug):
//   The old adapter accumulated wheel/touch delta directly into a continuous
//   `t` (WHEEL_SCALE * deltaY), and activeStop only flipped at the MIDPOINT
//   between two arc-length anchors. Because the anchors are unequally spaced
//   (STOP_ARC_T = [0, .16, .40, .59, .79, 1.0]), crossing one stop took ~2–3
//   wheel notches — and the last anchor sits at t=1.0 (the clamp ceiling), so
//   arriving 4→5 flipped the panel at the midpoint (t≈.89) yet the accumulator
//   kept climbing to 1.0: ~2.8 notches of DEAD travel = the "phantom scroll"
//   past the last stop, and 2 scrolls to come back 5→4.
//
//   Fix: one scroll GESTURE = one stop step. We accumulate delta per gesture,
//   fire a single index step (±1) once it crosses WHEEL_STEP_THRESHOLD, then
//   LOCK until the gesture ends (a quiet gap) or the direction reverses. `_target`
//   snaps to stopCenterT(nextIdx) and the easing RAF still glides the camera —
//   so it FEELS smooth but advances exactly one stop per gesture. Index is
//   clamped to [0, STOP_COUNT-1], so t can never exceed stopCenterT(N-1)=1.0 →
//   no phantom range, and 6→5 is a single scroll.

/** Wheel delta (|deltaY|) that must accumulate in one gesture to step a stop. */
const WHEEL_STEP_THRESHOLD = 40;

/** Touch drag distance (px) in one swipe that must accumulate to step a stop. */
const TOUCH_STEP_THRESHOLD = 45;

/**
 * Quiet gap (ms) after the last wheel/touch event that ends a gesture. Trackpads
 * and momentum scroll fire a burst of events per physical swipe; a step must only
 * fire ONCE per burst. After this gap of silence the gesture resets so the next
 * swipe can step again.
 */
const GESTURE_RESET_MS = 140;

// ─── State ────────────────────────────────────────────────────────────────────

let _target = 0; // desired t (set by input handlers) — always a stopCenterT value
let _easedT = 0; // smoothed t (written to store each RAF)
let _rafId = 0;
let _reducedMotion = false;
/** Guard: true while _applyEasing is writing to the store, so the store
 *  subscriber knows to ignore the notification (it's our own write). */
let _internalWrite = false;

// Per-gesture accumulators for the discrete stepper.
let _wheelAccum = 0; // signed |deltaY| accumulated in the current wheel gesture
let _wheelLocked = false; // true after a step fired this gesture (until reset)
let _lastWheelTs = 0; // performance.now() of the last wheel event
let _touchAccum = 0; // signed drag distance accumulated in the current swipe

function _lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** Index of the stop `_target` currently points at (target drives navigation). */
function _targetStopIndex(): number {
  return nearestStopIndex(_target);
}

// ─── Store subscriber (external-write reconciliation) ─────────────────────────

/**
 * Called by subscribeJourney whenever the store changes.
 * If _internalWrite is true the notification came from our own easing RAF —
 * ignore it to avoid a feedback loop. Otherwise it's an external write
 * (e.g. setJourneyProgress called by QA/reduced-motion/deep-link), so we
 * snap both _target and _easedT to the new value, making the easing converge
 * immediately with nothing to fight.
 */
function _onStoreChange(): void {
  if (_internalWrite) return;
  const newT = getJourneyT();
  _target = newT;
  _easedT = newT;
}

// ─── Easing RAF ───────────────────────────────────────────────────────────────

function _applyEasing(): void {
  if (_reducedMotion) {
    // No smoothing in reduced-motion — input handlers write setJourneyT directly
    // (instant snap). There is nothing to converge, so DON'T reschedule the RAF:
    // spinning an empty rAF forever would keep the page from ever idling. If the
    // media query flips to non-reduced later, _onMqChange re-arms the loop.
    _rafId = 0;
    return;
  }
  // Converge _easedT toward _target
  _easedT = _lerp(_easedT, _target, ALPHA);
  // Snap to exact target when close enough to avoid infinite drift
  const converged = Math.abs(_easedT - _target) < 0.0001;
  if (converged) {
    _easedT = _target;
  }
  // Self-write guard: tell the store subscriber this notification is ours.
  _internalWrite = true;
  try {
    setJourneyT(_easedT);
  } finally {
    _internalWrite = false;
  }
  // Perf plan P2: once converged there is nothing left to ease — PARK the RAF
  // instead of re-scheduling it forever. This removes one of the permanent
  // 60fps loops when the journey is idle. It is re-armed by _ensureRaf() from
  // every input handler that moves _target (wheel/touch/key/HUD/advance). The
  // self-write guard above stays intact (still set around setJourneyT), and
  // programmatic setJourneyProgress() remains bit-identical: _onStoreChange
  // syncs _target=_easedT on external writes, so the next tick sees converged
  // and simply doesn't re-arm — no spurious frame, no drift.
  if (converged) {
    _rafId = 0;
    return;
  }
  _rafId = requestAnimationFrame(_applyEasing);
}

/**
 * Re-arm the easing RAF if it has parked (perf plan P2). Called by every handler
 * that changes _target. Guarded on _rafId === 0 so we never stack two RAFs.
 * No-op in reduced-motion (that path writes the store directly, never eases).
 */
function _ensureRaf(): void {
  if (_reducedMotion) return;
  if (_rafId === 0) {
    _rafId = requestAnimationFrame(_applyEasing);
  }
}

// ─── Input helpers ────────────────────────────────────────────────────────────

/**
 * Step exactly one stop in `dir` (±1) from the CURRENT target stop.
 * The camera glides there via the easing RAF (or snaps instantly in
 * reduced-motion). This is the single primitive behind wheel, touch and keyboard
 * navigation now — one call = one stop transition, index-clamped so t never
 * escapes [stopCenterT(0), stopCenterT(N-1)] = [0, 1] (no phantom range).
 */
function _stepStop(dir: number): void {
  markJourneyInteraction();
  // Anchor the step on where we're HEADED (target), not the mid-glide eased t,
  // so a fast second gesture composes cleanly (1→2→3) instead of snapping back.
  const fromIdx = _reducedMotion ? nearestStopIndex(getJourneyT()) : _targetStopIndex();
  const nextIdx = Math.max(0, Math.min(STOP_COUNT - 1, fromIdx + Math.sign(dir)));
  const t = stopCenterT(nextIdx);
  _target = t;
  if (_reducedMotion) {
    // Instant snap — no easing RAF in reduced-motion.
    _easedT = t;
    setJourneyT(t);
    return;
  }
  _ensureRaf();
}

function _goToStop(idx: number): void {
  markJourneyInteraction();
  const clampedIdx = Math.max(0, Math.min(STOP_COUNT - 1, idx));
  const t = stopCenterT(clampedIdx);
  _target = t;
  if (_reducedMotion) {
    // Instant jump
    _easedT = t;
    setJourneyT(t);
  } else {
    // Smooth via easing RAF (re-arm it if it parked while idle)
    _ensureRaf();
  }
}

// ─── Event handlers ──────────────────────────────────────────────────────────

function _onWheel(e: WheelEvent): void {
  e.preventDefault();
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  // Gesture segmentation: a physical swipe fires a burst of wheel events. After
  // GESTURE_RESET_MS of silence, or when the scroll direction reverses, we treat
  // it as a NEW gesture — reset the accumulator and unlock so it can step again.
  const dir = Math.sign(e.deltaY);
  const gapEnded = now - _lastWheelTs > GESTURE_RESET_MS;
  const reversed = _wheelAccum !== 0 && Math.sign(_wheelAccum) !== dir && dir !== 0;
  if (gapEnded || reversed) {
    _wheelAccum = 0;
    _wheelLocked = false;
  }
  _lastWheelTs = now;
  _wheelAccum += e.deltaY;

  // Fire at most one step per gesture, once the accumulated delta crosses the
  // threshold. Stays locked until the gesture resets (gap/reverse above).
  if (!_wheelLocked && Math.abs(_wheelAccum) >= WHEEL_STEP_THRESHOLD) {
    _wheelLocked = true;
    _stepStop(dir);
  }
}

let _touchY: number | null = null;

function _onTouchStart(e: TouchEvent): void {
  _touchY = e.touches[0]?.clientY ?? null;
  _touchAccum = 0; // new swipe → fresh accumulator (one step per swipe)
}

function _onTouchMove(e: TouchEvent): void {
  if (_touchY === null) return;
  const clientY = e.touches[0]?.clientY;
  if (clientY === undefined) return;
  const dy = _touchY - clientY; // >0 = finger moved up = advance (forward)
  _touchY = clientY;

  // Accumulate drag within this swipe; step ONCE per threshold crossed. Reset the
  // accumulator (keep the remainder) after each step so a long drag can chain
  // multiple stops, but a short flick advances exactly one.
  _touchAccum += dy;
  while (Math.abs(_touchAccum) >= TOUCH_STEP_THRESHOLD) {
    const dir = Math.sign(_touchAccum);
    _touchAccum -= dir * TOUCH_STEP_THRESHOLD;
    _stepStop(dir);
  }
}

function _onTouchEnd(): void {
  _touchY = null;
  _touchAccum = 0;
}

function _onKeyDown(e: KeyboardEvent): void {
  // Don't intercept inside form elements
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  switch (e.key) {
    case "ArrowDown":
    case "PageDown":
    case " ":
      e.preventDefault();
      _stepStop(1);
      break;
    case "ArrowUp":
    case "PageUp":
      e.preventDefault();
      _stepStop(-1);
      break;
    case "Home":
      e.preventDefault();
      _goToStop(0);
      break;
    case "End":
      e.preventDefault();
      _goToStop(STOP_COUNT - 1);
      break;
  }
}

function _onHudGotoPhase(e: Event): void {
  const phase = (e as CustomEvent<{ phase: number }>).detail.phase;
  _goToStop(phase);
}

// ─── Mount / Destroy ─────────────────────────────────────────────────────────

export interface JourneyInputController {
  destroy(): void;
  readonly reducedMotion: boolean;
}

export function createJourneyInput(
  container: Window | HTMLElement = window,
): JourneyInputController {
  // Detect reduced-motion at mount time; re-check on media query change
  const mq =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  _reducedMotion = mq?.matches ?? false;

  function _onMqChange(ev: MediaQueryListEvent): void {
    const wasReduced = _reducedMotion;
    _reducedMotion = ev.matches;
    // Transitioned reduced → normal: sync _target/_easedT to the live store so
    // the easing has nothing stale to fight. No need to force-arm the RAF — with
    // target === eased it would just park again on the next tick; the next real
    // input calls _ensureRaf() and glides from the correct position (perf P2).
    if (wasReduced && !_reducedMotion) {
      _target = getJourneyT();
      _easedT = _target;
    }
  }
  mq?.addEventListener("change", _onMqChange);

  // Sync initial state
  _target = getJourneyT();
  _easedT = _target;

  // Subscribe to external writes on the store (after initial sync so the sync
  // itself doesn't trigger _onStoreChange).
  const _unsubscribeJourney = subscribeJourney(_onStoreChange);

  // Attach input listeners
  // wheel: {passive: false} required for preventDefault (Chrome DevTools will warn —
  // intentional, same as phase-orchestrator v0).
  container.addEventListener("wheel", _onWheel as EventListener, {
    passive: false,
  });
  container.addEventListener("touchstart", _onTouchStart as EventListener, {
    passive: true,
  });
  container.addEventListener("touchmove", _onTouchMove as EventListener, {
    passive: true,
  });
  container.addEventListener("touchend", _onTouchEnd as EventListener, {
    passive: true,
  });
  container.addEventListener("keydown", _onKeyDown as EventListener);

  // HUD navigation events (dispatched by TopNav.astro button clicks)
  window.addEventListener("hud:goto-phase", _onHudGotoPhase);

  // Perf plan P2: do NOT start the easing RAF unconditionally. At mount
  // _target === _easedT (both synced to getJourneyT above) so there is nothing
  // to converge — an unconditional RAF would run one frame and immediately park.
  // Instead the RAF stays asleep until the first input calls _ensureRaf(), and
  // parks again on convergence. This removes a permanent 60fps loop while idle.

  function destroy(): void {
    cancelAnimationFrame(_rafId);
    _rafId = 0;
    _unsubscribeJourney();
    container.removeEventListener("wheel", _onWheel as EventListener);
    container.removeEventListener("touchstart", _onTouchStart as EventListener);
    container.removeEventListener("touchmove", _onTouchMove as EventListener);
    container.removeEventListener("touchend", _onTouchEnd as EventListener);
    container.removeEventListener("keydown", _onKeyDown as EventListener);
    window.removeEventListener("hud:goto-phase", _onHudGotoPhase);
    mq?.removeEventListener("change", _onMqChange);
  }

  return {
    destroy,
    get reducedMotion() {
      return _reducedMotion;
    },
  };
}
