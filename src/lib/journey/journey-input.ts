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
//     _target accumulates wheel/touch delta. Each RAF: _easedT = lerp(_easedT, _target, ALPHA).
//     ALPHA = 0.08 (80ms feel-lag at 60fps). Preserved from old render-loop lerp.
//     Result: humans feel fluid, QA bypasses and gets instant.
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
//     ArrowUp/Down, PageUp/Down → step ±STEP
//     Home/End → stop[0]/stop[N-1]

import { setJourneyT, getJourneyT } from "./journey-state.js";
import { STOP_COUNT, stopCenterT } from "../neural-engine/hero-anchors.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Easing factor per RAF tick. 0.08 ≈ feels smooth at 60fps. */
const ALPHA = 0.08;

/** Wheel delta scaling. 0.00038 preserved from phase-orchestrator v0. */
const WHEEL_SCALE = 0.00038;

/** Touch drag scaling. 0.001 preserved from phase-orchestrator v0. */
const TOUCH_SCALE = 0.001;

/** Arrow/PageUp-Down step size (fraction of journey). */
const KEY_STEP = 0.04;

// ─── State ────────────────────────────────────────────────────────────────────

let _target = 0; // desired t (set by input handlers)
let _easedT = 0; // smoothed t (written to store each RAF)
let _rafId = 0;
let _reducedMotion = false;

function _clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function _lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

// ─── Easing RAF ───────────────────────────────────────────────────────────────

function _applyEasing(): void {
  if (_reducedMotion) {
    // No smoothing in reduced-motion — jump is already done by handlers
    _rafId = requestAnimationFrame(_applyEasing);
    return;
  }
  // Converge _easedT toward _target
  _easedT = _lerp(_easedT, _target, ALPHA);
  // Snap to exact target when close enough to avoid infinite drift
  if (Math.abs(_easedT - _target) < 0.0001) {
    _easedT = _target;
  }
  setJourneyT(_easedT);
  _rafId = requestAnimationFrame(_applyEasing);
}

// ─── Input helpers ────────────────────────────────────────────────────────────

function _advance(delta: number): void {
  if (_reducedMotion) {
    // Snap to next/prev stop
    const current = getJourneyT();
    const dir = delta > 0 ? 1 : -1;
    // Find current stop index
    let currentStopIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < STOP_COUNT; i++) {
      const d = Math.abs(current - stopCenterT(i));
      if (d < bestDist) {
        bestDist = d;
        currentStopIdx = i;
      }
    }
    const nextIdx =
      _clamp(currentStopIdx + dir) === currentStopIdx + dir
        ? currentStopIdx + dir
        : currentStopIdx;
    const clampedIdx = Math.max(0, Math.min(STOP_COUNT - 1, nextIdx));
    const t = stopCenterT(clampedIdx);
    _target = t;
    _easedT = t;
    setJourneyT(t);
    return;
  }
  _target = _clamp(_target + delta);
}

function _goToStop(idx: number): void {
  const clampedIdx = Math.max(0, Math.min(STOP_COUNT - 1, idx));
  const t = stopCenterT(clampedIdx);
  if (_reducedMotion) {
    // Instant jump
    _target = t;
    _easedT = t;
    setJourneyT(t);
  } else {
    // Smooth via easing RAF
    _target = t;
  }
}

// ─── Event handlers ──────────────────────────────────────────────────────────

function _onWheel(e: WheelEvent): void {
  e.preventDefault();
  _advance(e.deltaY * WHEEL_SCALE);
}

let _touchY: number | null = null;

function _onTouchStart(e: TouchEvent): void {
  _touchY = e.touches[0]?.clientY ?? null;
}

function _onTouchMove(e: TouchEvent): void {
  if (_touchY === null) return;
  const clientY = e.touches[0]?.clientY;
  if (clientY === undefined) return;
  const dy = _touchY - clientY;
  _advance(dy * TOUCH_SCALE);
  _touchY = clientY;
}

function _onTouchEnd(): void {
  _touchY = null;
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
      _advance(KEY_STEP);
      break;
    case "ArrowUp":
    case "PageUp":
      e.preventDefault();
      _advance(-KEY_STEP);
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
    _reducedMotion = ev.matches;
  }
  mq?.addEventListener("change", _onMqChange);

  // Sync initial state
  _target = getJourneyT();
  _easedT = _target;

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

  // Start easing RAF
  _rafId = requestAnimationFrame(_applyEasing);

  function destroy(): void {
    cancelAnimationFrame(_rafId);
    _rafId = 0;
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
