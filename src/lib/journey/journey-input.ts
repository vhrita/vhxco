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
//   SCROLL CALIBRATION (rework 3 — see _stepTarget / _onWheel):
//     wheel is a THRESHOLD ACCUMULATOR now — NO lock, NO wheel-idle-unlock timer.
//     Each wheel event adds normalized delta to _wheelAccum; every time |accum|
//     crosses STEP_THRESHOLD we advance the TARGET stop index by ±1 (clamped to
//     [0, STOP_COUNT-1]) and SUBTRACT the threshold from accum (carry remainder).
//     The camera chases stopCenterT(target) via the easing RAF; the target can
//     move mid-glide, so continuous scrolling advances stop-after-stop fluidly
//     and NEVER gets stuck waiting for another input (no pointermove/click/key).
//     A short idle DECAY zeroes leftover accum so a partial remainder can't fire
//     later on its own — decay is cleanup, not a lock.

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

// ── Threshold accumulator stop-stepping (rework 3 — no lock) ──────────────────
//
// WHY AN ACCUMULATOR, NOT A LOCK (root-cause of the rework-2 "stuck" bug):
//   Rework 2 fired ONE step per gesture, then LOCKED until a wheel-idle setTimeout
//   (re-armed on every event) fired. A user scrolling CONTINUOUSLY re-armed that
//   timer on every event → it NEVER fired → the gesture stayed locked at one step.
//   The only thing that unlocked it was a pause — which happened when the user did
//   something ELSE (moved the cursor, clicked, hit a key). So "keep scrolling" got
//   stuck at 1 stop, and the accidental idle from doing another action is what made
//   it "unstick". A lock that depends on stopping is the wrong model for a control
//   whose whole point is continuous travel.
//
//   Rework 3: pure delta accumulator with a threshold, NO lock, NO idle-unlock
//   timer. Each wheel event normalizes its deltaY (deltaMode-aware) and ADDS it to
//   _wheelAccum. Every time |_wheelAccum| >= STEP_THRESHOLD we advance the TARGET
//   index by sign(accum), clamp to [0, STOP_COUNT-1], and SUBTRACT the threshold
//   from accum (carry the remainder — do not zero). One burst that overshoots the
//   threshold several times advances several stops; the camera chases the moving
//   target via easing. Nothing ever blocks the next event. A short idle DECAY
//   (_maybeDecay) drops leftover accum after a quiet gap so a partial remainder
//   never fires on its own later — that is cleanup, not a lock (it removes travel,
//   it never withholds a step that the delta already earned).

/**
 * Normalized wheel delta (px-equivalent) that must accumulate to advance one stop.
 *
 * All deltas are normalized to a common px unit first (see _normalizeWheelDelta),
 * so this threshold is directly comparable across mouse (deltaMode=1, lines) and
 * trackpad (deltaMode=0, pixels).
 *
 * CALIBRATION:
 *   - One mouse notch normalizes to ~120px (browser standard is ~100–133px/notch;
 *     we clamp a line to WHEEL_LINE_PX below). At 120 threshold ≈ ~1 notch/stop —
 *     previsível, sem 2 notches por parada e sem pular.
 *   - A trackpad flick is a burst of small pixel deltas summing to a few hundred
 *     px. With the per-event cap (WHEEL_MAX_STEPS_PER_EVENT) and idle decay, a
 *     single flick lands ~1–2 stops rather than all 6.
 */
const WHEEL_STEP_THRESHOLD = 120;

/**
 * px assigned to one wheel LINE (deltaMode === 1). A mouse notch is typically 3
 * lines; 3 × 40 = 120 ≈ one WHEEL_STEP_THRESHOLD → ~1 stop per notch. Browsers
 * vary (Firefox reports lines), so we normalize here instead of trusting raw px.
 */
const WHEEL_LINE_PX = 40;

/** px assigned to one wheel PAGE (deltaMode === 2) — rare; keep it bounded. */
const WHEEL_PAGE_PX = 800;

/**
 * Per-EVENT cap on how much normalized delta counts toward the accumulator. A
 * trackpad flick / momentum tail can report a single huge delta (or many medium
 * ones); without a cap one physical flick could dump 700px+ and jump ~6 stops.
 * Clamping each event's contribution keeps a flick to ~1–2 stops while a genuine
 * fast mouse spin (many separate notch events) still advances freely — each notch
 * is its own event, so the cap never throttles honest notches.
 */
const WHEEL_MAX_DELTA_PER_EVENT = WHEEL_STEP_THRESHOLD * 1.6; // ~1.6 stops max/event

/** Touch drag distance (px) in one swipe that must accumulate to step a stop. */
const TOUCH_STEP_THRESHOLD = 45;

/**
 * Idle gap (ms) of WHEEL SILENCE after which leftover _wheelAccum DECAYS to zero.
 * This is NOT a lock and NOT an unlock — steps fire immediately on threshold, with
 * zero dependency on this timer. It only cleans a sub-threshold REMAINDER so that,
 * after the user stops scrolling, a stray partial accum can't later combine with a
 * fresh flick to fire an unearned step. Sized short enough to feel like "the
 * scroll ended" (a new deliberate scroll starts from ~0) but long enough to not
 * interrupt a continuous burst (trackpad/momentum events are ~8–16ms apart, far
 * below this, so a live burst never decays mid-stream).
 */
const WHEEL_IDLE_DECAY_MS = 120;

// ─── State ────────────────────────────────────────────────────────────────────

let _target = 0; // desired t (set by input handlers) — always a stopCenterT value
let _easedT = 0; // smoothed t (written to store each RAF)
let _rafId = 0;
let _reducedMotion = false;
/** Guard: true while _applyEasing is writing to the store, so the store
 *  subscriber knows to ignore the notification (it's our own write). */
let _internalWrite = false;

// Threshold accumulator for the wheel stepper (rework 3 — no lock).
let _wheelAccum = 0; // signed NORMALIZED delta accumulated since the last decay
/** setTimeout handle for the idle DECAY of leftover accum. Re-armed on every wheel
 *  event; when it fires (WHEEL_IDLE_DECAY_MS of silence) it zeroes any sub-threshold
 *  remainder. This is cleanup only — steps never wait on it, so scrolling is never
 *  blocked (no pointermove / interaction-signal coupling on the journey path). */
let _wheelDecayTimer: ReturnType<typeof setTimeout> | 0 = 0;
let _touchAccum = 0; // signed drag distance accumulated in the current swipe

/**
 * Normalize a wheel event's deltaY to a common px unit, deltaMode-aware, then cap
 * its per-event contribution (WHEEL_MAX_DELTA_PER_EVENT) so a single flick/momentum
 * spike can't dump many stops at once. Sign preserved.
 */
function _normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  let px: number;
  switch (deltaMode) {
    case 1: // DOM_DELTA_LINE — Firefox mouse wheel reports lines
      px = deltaY * WHEEL_LINE_PX;
      break;
    case 2: // DOM_DELTA_PAGE — rare
      px = deltaY * WHEEL_PAGE_PX;
      break;
    default: // 0 = DOM_DELTA_PIXEL — trackpad / Chrome mouse
      px = deltaY;
      break;
  }
  const capped = Math.min(Math.abs(px), WHEEL_MAX_DELTA_PER_EVENT);
  return Math.sign(px) * capped;
}

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

/**
 * Threshold-accumulator wheel handler (rework 3). NO lock, NO input dependency.
 *
 * Every event:
 *   1. Normalize deltaY (deltaMode-aware, per-event capped) → _wheelAccum.
 *   2. On a direction REVERSAL, drop the opposite-sign remainder first so the very
 *      first reverse notch counts toward going back (never has to "unwind" forward
 *      accum before it can move) — then continue accumulating in the new direction.
 *   3. While |_wheelAccum| >= STEP_THRESHOLD: advance the TARGET index by one
 *      (sign of accum), SUBTRACT the threshold (carry remainder). A burst that
 *      overshoots several thresholds advances several stops in one event; a single
 *      event is bounded by the per-event delta cap, so a flick lands ~1–2 stops.
 *   4. Re-arm the idle DECAY timer (cleanup of leftover remainder only).
 *
 * Because the step loop keys off delta magnitude — never a lock or a timer — a
 * continuous scroll advances stop-after-stop with zero dependency on pointermove,
 * click, or keypress. The camera chases the moving target via the easing RAF.
 */
function _onWheel(e: WheelEvent): void {
  e.preventDefault();

  const delta = _normalizeWheelDelta(e.deltaY, e.deltaMode);
  if (delta === 0) return;

  // Reversal: clear an opposite-sign remainder so the first reverse notch counts
  // toward the new direction immediately (no "unwind the old accum" lag). This is
  // magnitude-based, not a timer — reversing never needs a pause or a cursor move.
  if (_wheelAccum !== 0 && Math.sign(_wheelAccum) !== Math.sign(delta)) {
    _wheelAccum = 0;
  }
  _wheelAccum += delta;

  // Advance one target stop per threshold crossed, carrying the remainder so a
  // fast burst chains multiple stops (1→2→3) and never gets stuck at one.
  while (Math.abs(_wheelAccum) >= WHEEL_STEP_THRESHOLD) {
    const dir = Math.sign(_wheelAccum);
    _wheelAccum -= dir * WHEEL_STEP_THRESHOLD;
    _stepStop(dir);
  }

  // Re-arm idle decay (cleanup of the sub-threshold remainder — NOT a lock; no
  // step ever waits on this). A live burst (events ~8–16ms apart) keeps clearing
  // and re-arming it, so it only fires once scrolling truly stops.
  if (_wheelDecayTimer !== 0) clearTimeout(_wheelDecayTimer);
  _wheelDecayTimer = setTimeout(() => {
    _wheelDecayTimer = 0;
    _wheelAccum = 0;
  }, WHEEL_IDLE_DECAY_MS);
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
    if (_wheelDecayTimer !== 0) {
      clearTimeout(_wheelDecayTimer);
      _wheelDecayTimer = 0;
    }
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
