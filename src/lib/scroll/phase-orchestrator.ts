// phase-orchestrator.ts
// Scroll/phase orchestration with magnetic snap, keyboard nav, touch, and a11y.
// Ported from vhxco-app.js lines 598-679 + keyboard nav + a11y additions.
//
// Two modes:
//   - Default (no prefers-reduced-motion): magnetic snap, wheel {passive:false},
//     scroll lock, keyboard nav. render-loop reads targetProgress via getTargetProgress().
//   - prefers-reduced-motion: reduce — disables snap, uses native scroll +
//     IntersectionObserver to detect phase. Still emits phase changes via store.
//
// Store is intentionally separate from phase-state.ts (which is owned by render-loop).
// External consumers (HUD, React components) subscribe here.
//
// Dev: window.__phaseStore.getState() exposes current state.

// ─── Lightweight store ────────────────────────────────────────────────────────

export interface PhaseOrchestratorState {
  /** Current phase index 0-4 */
  phase: number;
  /** Lerped scroll progress 0..1 (render-loop output) */
  progress: number;
  /** Target scroll progress 0..1 (user input) */
  target: number;
}

type PhaseListener = (state: PhaseOrchestratorState) => void;

let _state: PhaseOrchestratorState = { phase: 0, progress: 0.125, target: 0.125 };
const _listeners = new Set<PhaseListener>();

function _notify(): void {
  _listeners.forEach((fn) => fn({ ..._state }));
}

/** Read current state (no clone cost in render-loop hot path) */
export function getPhaseState(): PhaseOrchestratorState {
  return _state;
}

/** Subscribe to state changes. Returns unsubscribe fn. */
export function subscribePhase(fn: PhaseListener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Update progress (called by render-loop each frame) */
export function _setProgress(progress: number): void {
  if (_state.progress === progress) return;
  _state = { ..._state, progress };
  _notify();
}

/** Internal — update target + phase together */
function _setTarget(target: number, phase: number): void {
  _state = { ..._state, target, phase };
  _notify();
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASE_COUNT = 5;
const SNAP_THRESHOLDS: number[] = Array.from(
  { length: PHASE_COUNT },
  (_, i) => (i + 0.5) / PHASE_COUNT // [0.125, 0.375, 0.625, 0.875, 1.125 (clamped)]
);
const SCROLL_LOCK_AUTO_MS = 600;
const SCROLL_LOCK_MANUAL_MS = 1200;
const SNAP_TOLERANCE = 0.015;
const SNAP_ESCAPE_DIST = 0.06;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function progressToPhase(p: number): number {
  return Math.min(PHASE_COUNT - 1, Math.floor(p * PHASE_COUNT * 0.999));
}

// ─── Orchestrator factory ─────────────────────────────────────────────────────

export interface PhaseOrchestratorOpts {
  /** Override reduced-motion detection (mainly for tests) */
  reducedMotion?: boolean;
  /** Scroll container — defaults to window */
  container?: Window | HTMLElement;
}

export interface PhaseOrchestratorController {
  /** Navigate programmatically to phase index */
  goToPhase(idx: number): void;
  /** Detach all event listeners */
  destroy(): void;
  /** Whether running in reduced-motion mode */
  readonly reducedMotion: boolean;
}

export function createPhaseOrchestrator(
  opts: PhaseOrchestratorOpts = {}
): PhaseOrchestratorController {
  const reducedMotion =
    opts.reducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Reset store to initial state on mount
  _state = { phase: 0, progress: 0.125, target: 0.125 };

  if (reducedMotion) {
    return _createReducedMotionOrchestrator();
  }

  return _createSnapOrchestrator(opts.container ?? window);
}

// ─── Normal mode (magnetic snap) ─────────────────────────────────────────────

function _createSnapOrchestrator(
  container: Window | HTMLElement
): PhaseOrchestratorController {
  let targetProgress = 0.125;
  let scrollLock = false;
  let lastPhaseSnapped = 0;

  function updateScrollProgress(delta: number): void {
    if (scrollLock) return;

    const prevTarget = targetProgress;
    targetProgress = clamp(targetProgress + delta, 0, 1);

    for (let i = 0; i < PHASE_COUNT; i++) {
      const center = SNAP_THRESHOLDS[i];
      const crossedForward = prevTarget < center && targetProgress >= center;
      const crossedBackward = prevTarget > center && targetProgress <= center;
      const closeEnough = Math.abs(targetProgress - center) < SNAP_TOLERANCE;

      if ((crossedForward || crossedBackward || closeEnough) && lastPhaseSnapped !== i) {
        targetProgress = center;
        lastPhaseSnapped = i;
        scrollLock = true;
        setTimeout(() => { scrollLock = false; }, SCROLL_LOCK_AUTO_MS);
        break;
      }
    }

    // Escape zone — allow re-snapping to same phase if user scrolls away and back
    if (!scrollLock && lastPhaseSnapped !== -1) {
      const currentCenter = SNAP_THRESHOLDS[lastPhaseSnapped];
      if (Math.abs(targetProgress - currentCenter) > SNAP_ESCAPE_DIST) {
        lastPhaseSnapped = -1;
      }
    }

    _setTarget(targetProgress, progressToPhase(targetProgress));
  }

  function goToPhase(idx: number): void {
    const clamped = clamp(idx, 0, PHASE_COUNT - 1);
    targetProgress = SNAP_THRESHOLDS[clamped];
    lastPhaseSnapped = clamped;
    scrollLock = true;
    setTimeout(() => { scrollLock = false; }, SCROLL_LOCK_MANUAL_MS);
    _setTarget(targetProgress, clamped);
  }

  // Sync target into store initial state
  _setTarget(targetProgress, 0);

  // ── Scroll-bound guard helpers ──
  //
  // Before consuming a wheel/touch event to change phase, check whether the
  // active phase has internal overflow AND the user has not yet scrolled to
  // the edge in the intended direction.  If overflow exists and the extremum
  // hasn't been reached, return true (caller should bail out and let the
  // browser handle the native scroll).  If the phase fits, or the user is
  // already at the top/bottom edge, return false (consume + change phase).
  //
  // Threshold of 2px avoids sub-pixel rounding issues on HiDPI screens.

  function _activePhaseHasScroll(direction: 'down' | 'up'): boolean {
    const activeEl = document.querySelector<HTMLElement>('.phase[data-active]');
    if (!activeEl) return false;

    const overflow = activeEl.scrollHeight > activeEl.clientHeight + 2;
    if (!overflow) return false;

    const scrollTop = activeEl.scrollTop;
    const scrollMax = activeEl.scrollHeight - activeEl.clientHeight;
    const atTop    = scrollTop <= 1;
    const atBottom = scrollTop >= scrollMax - 1;

    if (direction === 'down' && !atBottom) return true; // let browser scroll
    if (direction === 'up'   && !atTop)    return true; // let browser scroll
    return false; // at the edge → fall through to phase change
  }

  // ── Event handlers ──

  function onWheel(e: WheelEvent): void {
    const direction = e.deltaY > 0 ? 'down' : 'up';
    if (_activePhaseHasScroll(direction)) {
      // Active phase has room to scroll internally — don't prevent default,
      // let the browser handle native scroll on the phase element.
      return;
    }
    e.preventDefault();
    updateScrollProgress(e.deltaY * 0.00038);
  }

  let touchY: number | null = null;
  let touchDirection: 'down' | 'up' | null = null;

  function onTouchStart(e: TouchEvent): void {
    touchY = e.touches[0].clientY;
    touchDirection = null;
  }

  function onTouchMove(e: TouchEvent): void {
    if (touchY === null) return;
    const dy = touchY - e.touches[0].clientY;
    // Determine swipe direction on first meaningful movement
    if (touchDirection === null && Math.abs(dy) > 2) {
      touchDirection = dy > 0 ? 'down' : 'up';
    }
    // Touch events are passive — we can't preventDefault here (already
    // registered passive:true).  The scroll-bound guard still applies so we
    // skip the phase progress update when the phase has internal scroll room.
    if (touchDirection !== null && _activePhaseHasScroll(touchDirection)) {
      touchY = e.touches[0].clientY;
      return;
    }
    updateScrollProgress(dy * 0.001);
    touchY = e.touches[0].clientY;
  }

  function onTouchEnd(): void {
    touchY = null;
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Don't intercept shortcuts when focus is inside a form element
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        updateScrollProgress(0.05);
        break;
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        updateScrollProgress(-0.05);
        break;
      case 'Home':
        e.preventDefault();
        goToPhase(0);
        break;
      case 'End':
        e.preventDefault();
        goToPhase(PHASE_COUNT - 1);
        break;
    }
  }

  // Attach listeners
  // wheel: {passive: false} required for preventDefault — Chrome DevTools will
  // show "non-passive" warning; this is intentional and documented (same as v0).
  container.addEventListener('wheel', onWheel as EventListener, { passive: false });
  container.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
  container.addEventListener('touchmove', onTouchMove as EventListener, { passive: true });
  container.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
  container.addEventListener('keydown', onKeyDown as EventListener);

  function destroy(): void {
    container.removeEventListener('wheel', onWheel as EventListener);
    container.removeEventListener('touchstart', onTouchStart as EventListener);
    container.removeEventListener('touchmove', onTouchMove as EventListener);
    container.removeEventListener('touchend', onTouchEnd as EventListener);
    container.removeEventListener('keydown', onKeyDown as EventListener);
  }

  return { goToPhase, destroy, reducedMotion: false };
}

// ─── Reduced-motion mode (native scroll + IntersectionObserver) ──────────────

function _createReducedMotionOrchestrator(): PhaseOrchestratorController {
  // Snap is disabled. We observe phase sentinel elements (data-phase="0..4")
  // or fall back to document.body scroll position.
  let observer: IntersectionObserver | null = null;

  function _observePhaseElements(): void {
    if (typeof IntersectionObserver === 'undefined') return;

    const entries: Map<number, IntersectionObserverEntry> = new Map();

    observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          const idx = parseInt(
            (entry.target as HTMLElement).dataset.phase ?? '-1',
            10
          );
          if (idx >= 0 && idx < PHASE_COUNT) {
            entries.set(idx, entry);
          }
        }

        // Find most visible phase
        let bestPhase = _state.phase;
        let bestRatio = -1;
        entries.forEach((entry, idx) => {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPhase = idx;
          }
        });

        const center = SNAP_THRESHOLDS[bestPhase];
        _setTarget(center, bestPhase);
      },
      { threshold: [0.25, 0.5, 0.75] }
    );

    // Observe elements with data-phase attribute
    document.querySelectorAll<HTMLElement>('[data-phase]').forEach((el) => {
      observer!.observe(el);
    });
  }

  // Observe after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _observePhaseElements, { once: true });
  } else {
    _observePhaseElements();
  }

  function goToPhase(idx: number): void {
    const clamped = clamp(idx, 0, PHASE_COUNT - 1);
    const center = SNAP_THRESHOLDS[clamped];
    _setTarget(center, clamped);
    // Scroll natively to corresponding element if it exists
    const el = document.querySelector<HTMLElement>(`[data-phase="${clamped}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function destroy(): void {
    observer?.disconnect();
    observer = null;
  }

  return { goToPhase, destroy, reducedMotion: true };
}

// ─── Public exports for engine integration ───────────────────────────────────

/**
 * Get current targetProgress (0..1) for the render-loop to lerp toward.
 * Hot path — reads directly from state without clone.
 */
export function getTargetProgress(): number {
  return _state.target;
}

/**
 * Called by render-loop each frame with the lerped progress value.
 * Updates store so React hooks get re-rendered.
 */
export { _setProgress as setLerpedProgress };

/**
 * Imperatively set target + phase — used by render-loop.setPhase() API
 * so engine.setPhase() still works for programmatic navigation.
 */
export function setTargetProgress(target: number, phase: number): void {
  _setTarget(target, phase);
}
