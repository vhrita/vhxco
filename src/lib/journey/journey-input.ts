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
//   EASING (rework 4 — time-based ease-out):
//     _target holds the DESTINATION stop's arc-length t (set by the discrete
//     stepper). Each RAF advances a TIME-BASED tween: _easedT = _tweenFrom +
//     (_tweenTo - _tweenFrom) * easeOutQuart(elapsed / CAMERA_TWEEN_MS), until the
//     duration elapses — then the RAF PARKS (perf P2) and re-arms on the next input.
//     Frame-rate independent (unlike the old exponential lerp): a satisfying premium
//     settle. Result: humans feel the glide, QA bypasses and gets instant.
//
//   REDUCED-MOTION (§9):
//     `prefers-reduced-motion: reduce` → easing disabled (instant snap, no dwell).
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
//   SCROLL CALIBRATION (rework 4 — Apple-style magnetic snap w/ soft stick):
//     wheel is a THRESHOLD ACCUMULATOR — NO lock, NO wheel-idle-unlock timer.
//     Each wheel event adds normalized delta to _wheelAccum; every time |accum|
//     crosses STEP_THRESHOLD we advance the TARGET stop index by ±1 (clamped to
//     [0, STOP_COUNT-1]). On a step we ZERO the accumulator (not carry) and open a
//     short SETTLE/DWELL window (SETTLE_MS): during settle, incoming delta is
//     DAMPED (× SETTLE_DAMP, decaying back to 1.0 over the window) so the stop
//     "sticks" for a beat. The damping only adds resistance — a sustained strong
//     scroll still accumulates past the threshold and crosses anyway, so it is a
//     soft stick, NEVER a lock. The camera chases stopCenterT(target) via a
//     TIME-BASED ease-out tween (quart, ~0.6s) for a premium, satisfying settle.
//     A short idle DECAY zeroes leftover accum so a partial remainder can't fire
//     later on its own — decay is cleanup, not a lock.

import { setJourneyT, getJourneyT, subscribeJourney } from "./journey-state.js";
import {
  STOP_COUNT,
  stopCenterT,
  nearestStopIndex,
} from "../neural-engine/hero-anchors.js";
import { markJourneyInteraction } from "./interaction-signal.js";

// ─── TUNABLES (the feel dials — change ONE number here) ───────────────────────
//
//   Vitor will say "um tico mais lento/rápido" — these four are the knobs.
//   Everything below is normalized to the same px unit, so they're comparable.
//
//   ┌─ WHEEL_STEP_THRESHOLD  how much scroll to advance ONE stop (↑ = slower/more
//   │                        deliberate; ↓ = faster). ~120 was 1 notch = 1 stop.
//   ├─ SETTLE_MS             the "stick" duration — how long a stop grabs after you
//   │                        arrive (↑ = grabbier; ↓ = slippier). 0 disables stick.
//   ├─ SETTLE_DAMP           how hard the stick resists during settle: incoming
//   │                        delta × this at the START of the window, decaying to 1
//   │                        by the end (lower = grabbier; 1 = no stick). ~0.45.
//   └─ CAMERA_TWEEN_MS       camera glide duration to the target stop (the premium
//                            ease-out). ↑ = more languid; ↓ = snappier. ~600ms.

// DEFAULTS — the shipping values. The live object below starts here; the DEV
// tuning panel mutates SCROLL_TUNE and can reset back to these. Keeping the
// defaults as a frozen literal lets the panel's "reset" restore them exactly.
const SCROLL_TUNE_DEFAULTS = Object.freeze({
  /**
   * Normalized wheel delta (px-equivalent) to advance ONE stop. ↑ = need more
   * deliberate scroll per stop (slower); ↓ = quicker. Raised from 120 (1 notch/stop,
   * which felt like a blur / free-scroll) so continuous scroll advances stop-by-stop
   * with a beat, not a smear. ~2 mouse notches per stop at 220.
   */
  wheelStepThreshold: 220,
  /**
   * The "stick" — ms after arriving at a stop during which incoming scroll is DAMPED
   * so the stop grabs for a beat (Apple-style magnetic snap). This is soft resistance,
   * never a lock: sustained strong scroll still accumulates past threshold and crosses.
   * Set 0 to disable the stick entirely.
   */
  settleMs: 320,
  /**
   * Damping factor for scroll delta at the START of the settle window (decays linearly
   * back to 1.0 by settleMs). Lower = grabbier stick; 1.0 = no stick. At 0.45 the
   * first ~half of a settle needs roughly double the scroll to break out, but a hard
   * sustained scroll still overpowers it — resistance, not a wall.
   */
  settleDamp: 0.45,
  /**
   * Camera glide duration (ms) to stopCenterT(target) — the premium ease-out. Time-
   * based (quart), restarts from the live eased position on a new target so chained
   * steps compose smoothly. ↑ = more languid settle; ↓ = snappier.
   */
  cameraTweenMs: 600,
});

/**
 * LIVE tunables — a MUTABLE config object read fresh on every wheel event / RAF frame
 * (never captured in a closure), so changing a value takes effect on the NEXT scroll
 * with no rebuild. In DEV this is exposed on window.__scrollTune (get/set) and driven
 * by the temporary tuning panel (?tune=1). In prod it just holds the ship defaults.
 *
 * WHY AN OBJECT, NOT `const`s: the old `const WHEEL_STEP_THRESHOLD = 220` was baked
 * at bundle time. The panel needs to move the dials at runtime and have the input
 * logic honor the new number immediately — so the logic reads SCROLL_TUNE.xxx at the
 * point of use rather than a hoisted primitive.
 */
const SCROLL_TUNE: {
  wheelStepThreshold: number;
  settleMs: number;
  settleDamp: number;
  cameraTweenMs: number;
} = { ...SCROLL_TUNE_DEFAULTS };

/**
 * DEV: expose the live tunables on window.__scrollTune with getters/setters so the
 * tuning panel (?tune=1) mutates the SAME object the input logic reads each frame.
 * `reset()` restores the ship defaults; `defaults` is the frozen reference. No-op in
 * prod (never called there). Safe to call more than once — idempotent redefinition.
 */
function _exposeScrollTuneDev(): void {
  if (typeof window === "undefined") return;
  const api = {
    get wheelStepThreshold() {
      return SCROLL_TUNE.wheelStepThreshold;
    },
    set wheelStepThreshold(v: number) {
      SCROLL_TUNE.wheelStepThreshold = v;
    },
    get settleMs() {
      return SCROLL_TUNE.settleMs;
    },
    set settleMs(v: number) {
      SCROLL_TUNE.settleMs = v;
    },
    get settleDamp() {
      return SCROLL_TUNE.settleDamp;
    },
    set settleDamp(v: number) {
      SCROLL_TUNE.settleDamp = v;
    },
    get cameraTweenMs() {
      return SCROLL_TUNE.cameraTweenMs;
    },
    set cameraTweenMs(v: number) {
      SCROLL_TUNE.cameraTweenMs = v;
    },
    get defaults() {
      return SCROLL_TUNE_DEFAULTS;
    },
    reset() {
      Object.assign(SCROLL_TUNE, SCROLL_TUNE_DEFAULTS);
    },
  };
  (window as unknown as Record<string, unknown>).__scrollTune = api;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// ── Threshold accumulator stop-stepping (rework 4 — soft stick, no lock) ──────
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
//   index by sign(accum). The camera chases the moving target via easing. Nothing
//   ever blocks the next event.
//
//   Rework 4: adds the Apple-style SOFT STICK on top of rework 3's no-lock core.
//   On a step we ZERO the accumulator (was: carry remainder) so the next stop needs
//   a fresh threshold from ~0 — this is what makes a stop "arrive and settle" rather
//   than the leftover instantly punting you to the next one. We also open a SETTLE
//   window (SETTLE_MS): incoming delta during settle is multiplied by a factor that
//   ramps SETTLE_DAMP → 1.0 across the window, so the stop resists for a beat. The
//   damping only slows accumulation — a sustained hard scroll still crosses the
//   (higher) threshold and advances, so it is resistance, never a lock. Sign-based
//   reversal handling and the idle DECAY (cleanup of a sub-threshold remainder) are
//   unchanged — no step ever waits on a timer or on any pointer/click/key input.

/**
 * px assigned to one wheel LINE (deltaMode === 1). A mouse notch is typically 3
 * lines. Browsers vary (Firefox reports lines), so we normalize here instead of
 * trusting raw px. 3 × 40 = 120 ≈ one old notch; at WHEEL_STEP_THRESHOLD=220 that
 * is ~1.8 notches per stop.
 */
const WHEEL_LINE_PX = 40;

/** px assigned to one wheel PAGE (deltaMode === 2) — rare; keep it bounded. */
const WHEEL_PAGE_PX = 800;

/**
 * Per-EVENT cap on how much normalized delta counts toward the accumulator. A
 * trackpad flick / momentum tail can report a single huge delta (or many medium
 * ones); without a cap one physical flick could dump 700px+ and jump ~6 stops.
 * Clamping each event's contribution keeps a flick to ~1 stop while a genuine
 * fast mouse spin (many separate notch events) still advances freely — each notch
 * is its own event, so the cap never throttles honest notches. Sized just under one
 * threshold so a single flick lands exactly one stop and then hits the settle.
 *
 * Derived LIVE from SCROLL_TUNE.wheelStepThreshold (was a bundle-time const) so it
 * tracks the panel's threshold slider — otherwise raising the threshold would let a
 * single flick dump multiple stops (cap frozen below the new threshold).
 */
function _wheelMaxDeltaPerEvent(): number {
  return SCROLL_TUNE.wheelStepThreshold * 0.95; // ≤1 stop max/event
}

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

// Time-based camera tween (rework 4). Instead of a frame-rate-dependent exponential
// lerp (which felt mushy and never "settled"), the eased t glides from _tweenFrom to
// _tweenTo over CAMERA_TWEEN_MS with an ease-out-quart curve — a premium, satisfying
// snap. A new target restarts the tween FROM the live eased position, so chained
// steps compose smoothly instead of snapping back.
let _tweenFrom = 0; // eased t at the moment the current tween started
let _tweenTo = 0; // destination t (mirrors _target for the tween)
let _tweenStart = 0; // performance.now() timestamp when the tween started

/** Timestamp we last STEPPED to a new stop — the anchor for the settle window. */
let _lastStepAt = -Infinity;

// Threshold accumulator for the wheel stepper (rework 3 — no lock).
let _wheelAccum = 0; // signed NORMALIZED delta accumulated since the last decay
/** setTimeout handle for the idle DECAY of leftover accum. Re-armed on every wheel
 *  event; when it fires (WHEEL_IDLE_DECAY_MS of silence) it zeroes any sub-threshold
 *  remainder. This is cleanup only — steps never wait on it, so scrolling is never
 *  blocked (no pointermove / interaction-signal coupling on the journey path). */
let _wheelDecayTimer: ReturnType<typeof setTimeout> | 0 = 0;
let _touchAccum = 0; // signed drag distance accumulated in the current swipe

/** Monotonic-ish clock. performance.now in browser; Date.now fallback (tests). */
function _now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * Settle damping multiplier for a scroll delta arriving `now`. During the SETTLE_MS
 * window after a step, incoming delta is scaled down (starting at SETTLE_DAMP,
 * ramping linearly back to 1.0 by the end of the window) so the just-reached stop
 * "sticks" for a beat. Outside the window (or with SETTLE_MS/DAMP disabling it) it
 * returns 1.0 — no damping. This ONLY slows accumulation; it never blocks a step, so
 * sustained hard scroll always crosses the threshold anyway (soft stick, not a lock).
 */
function _settleFactor(now: number): number {
  // Read the dials LIVE each call so the tuning panel takes effect on the next event.
  const { settleMs, settleDamp } = SCROLL_TUNE;
  if (settleMs <= 0 || settleDamp >= 1) return 1;
  const elapsed = now - _lastStepAt;
  if (elapsed >= settleMs) return 1;
  // Linear ramp settleDamp → 1.0 across the window.
  const p = elapsed / settleMs; // 0..1
  return settleDamp + (1 - settleDamp) * p;
}

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
  const capped = Math.min(Math.abs(px), _wheelMaxDeltaPerEvent());
  return Math.sign(px) * capped;
}

/** Quart ease-out: fast start, long gentle settle — the premium "arrival" curve. */
function _easeOutQuart(p: number): number {
  const inv = 1 - p;
  return 1 - inv * inv * inv * inv;
}

/**
 * (Re)start the camera tween toward `to`, beginning from the current eased position.
 * Called whenever _target changes. Restarting from _easedT (not _tweenFrom) keeps a
 * chained step smooth — no snap-back to the previous stop mid-glide.
 */
function _startTween(to: number): void {
  _tweenFrom = _easedT;
  _tweenTo = to;
  _tweenStart = _now();
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
 * snap _target, _easedT AND the tween all to the new value — the tween is
 * already at its destination, so the next RAF converges with nothing to fight.
 * This keeps programmatic setJourneyProgress() bit-identical (no glide).
 */
function _onStoreChange(): void {
  if (_internalWrite) return;
  const newT = getJourneyT();
  _target = newT;
  _easedT = newT;
  _tweenFrom = newT;
  _tweenTo = newT;
  _tweenStart = _now();
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
  // Time-based ease-out-quart tween toward _tweenTo (rework 4 — premium settle).
  // Progress is real elapsed time / duration, so the feel is frame-rate independent
  // (a 30fps idle-throttle frame and a 120fps frame land the same eased t).
  const elapsed = _now() - _tweenStart;
  // Read the glide duration LIVE so the panel's cameraTweenMs slider affects the
  // in-flight and subsequent tweens without a rebuild.
  const cameraTweenMs = SCROLL_TUNE.cameraTweenMs;
  const p = cameraTweenMs <= 0 ? 1 : Math.min(1, elapsed / cameraTweenMs);
  _easedT = _tweenFrom + (_tweenTo - _tweenFrom) * _easeOutQuart(p);
  // Converged when the tween has run its full duration AND we're at the target.
  const converged = p >= 1 || Math.abs(_easedT - _tweenTo) < 0.0001;
  if (converged) {
    _easedT = _tweenTo;
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
  // Clamp guard: if already at the edge, nextIdx === fromIdx — no step, no settle.
  // (Keeps _lastStepAt from re-arming the stick every wheel event at stop 0 or N-1.)
  if (nextIdx === fromIdx) return;
  const t = stopCenterT(nextIdx);
  _target = t;
  if (_reducedMotion) {
    // Instant snap — no easing RAF, no settle (reduced-motion has no dwell/stick).
    _easedT = t;
    setJourneyT(t);
    return;
  }
  // Open the settle/stick window for the stop we just arrived at, and (re)start the
  // premium ease-out tween from the live eased position toward the new target.
  _lastStepAt = _now();
  _startTween(t);
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
    // Smooth via the ease-out tween (re-arm the RAF if it parked while idle).
    // A direct jump (keyboard Home/End, HUD) doesn't arm the scroll stick — the
    // settle window is for scroll-arrivals, not deliberate jumps.
    _startTween(t);
    _ensureRaf();
  }
}

// ─── Event handlers ──────────────────────────────────────────────────────────

/**
 * Threshold-accumulator wheel handler (rework 4 — soft stick, NO lock).
 *
 * Every event:
 *   1. Normalize deltaY (deltaMode-aware, per-event capped).
 *   2. DAMP it by the settle factor (× SETTLE_DAMP…1.0 during the SETTLE_MS window
 *      after a step) so a just-reached stop resists for a beat — the "stick".
 *   3. On a direction REVERSAL, drop the opposite-sign remainder first so the very
 *      first reverse notch counts toward going back (never has to "unwind" forward
 *      accum before it can move) — then continue accumulating in the new direction.
 *   4. While |_wheelAccum| >= STEP_THRESHOLD: advance the TARGET index by one
 *      (sign of accum) and ZERO the accumulator. Zeroing (not carrying) is what
 *      makes each stop settle — the next stop needs a fresh threshold from ~0, so
 *      leftover delta can't instantly punt you onward. The per-event cap keeps one
 *      event to ≤1 step, so a single flick lands exactly one stop then sticks.
 *   5. Re-arm the idle DECAY timer (cleanup of leftover remainder only).
 *
 * The stick is SOFT: damping only slows accumulation, it never blocks a step. A
 * sustained hard scroll piles up damped delta across events and still crosses the
 * threshold, advancing stop-after-stop — resistance, never a lock. Zero dependency
 * on pointermove / click / keypress. Camera chases the target via the ease-out tween.
 */
function _onWheel(e: WheelEvent): void {
  e.preventDefault();

  let delta = _normalizeWheelDelta(e.deltaY, e.deltaMode);
  if (delta === 0) return;

  // Soft stick: damp incoming delta during the settle window. This ONLY slows
  // accumulation toward the next threshold — sustained scroll still crosses it, so
  // it is resistance, not a lock (the golden rule: keep scrolling ⇒ always advance).
  delta *= _settleFactor(_now());

  // Reversal: clear an opposite-sign remainder so the first reverse notch counts
  // toward the new direction immediately (no "unwind the old accum" lag). This is
  // magnitude-based, not a timer — reversing never needs a pause or a cursor move.
  if (_wheelAccum !== 0 && Math.sign(_wheelAccum) !== Math.sign(delta)) {
    _wheelAccum = 0;
  }
  _wheelAccum += delta;

  // Advance one target stop per threshold crossed, ZEROing the accumulator on each
  // step so the next stop needs a fresh threshold (the settle). The per-event delta
  // cap (≤1 threshold) means at most one step fires per event — no multi-stop jumps.
  // Read threshold LIVE so the panel's threshold slider changes scroll-per-stop now.
  while (Math.abs(_wheelAccum) >= SCROLL_TUNE.wheelStepThreshold) {
    const dir = Math.sign(_wheelAccum);
    _wheelAccum = 0;
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
  let dy = _touchY - clientY; // >0 = finger moved up = advance (forward)
  _touchY = clientY;

  // Soft stick (same as wheel): damp drag during the settle window so a just-reached
  // stop resists for a beat. Resistance only — a sustained hard drag still crosses.
  dy *= _settleFactor(_now());

  // Accumulate drag within this swipe; step ONCE per threshold crossed, ZEROing the
  // accumulator on each step so the next stop needs a fresh threshold (the stick).
  _touchAccum += dy;
  while (Math.abs(_touchAccum) >= TOUCH_STEP_THRESHOLD) {
    const dir = Math.sign(_touchAccum);
    _touchAccum = 0;
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
      _tweenFrom = _target;
      _tweenTo = _target;
      _tweenStart = _now();
    }
  }
  mq?.addEventListener("change", _onMqChange);

  // Sync initial state (eased + tween both at the live t — nothing to converge).
  _target = getJourneyT();
  _easedT = _target;
  _tweenFrom = _target;
  _tweenTo = _target;
  _tweenStart = _now();

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

  // DEV: expose the live tunables on window.__scrollTune so the temporary tuning
  // panel (?tune=1) can move the dials at runtime. Prod path never runs this.
  if (import.meta.env.DEV) {
    _exposeScrollTuneDev();
  }

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
