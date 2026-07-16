// interaction-signal.ts
// Tiny shared signal for "when did the user last interact with the journey".
//
// Purpose (perf plan P1 — idle fps throttle):
//   journey-input.ts bumps this timestamp on every wheel/touch/key/HUD input.
//   render-loop.ts reads it each frame to decide the fps cap: 60fps while the
//   camera is actively being navigated, throttled to 30fps once the journey has
//   been idle for IDLE_MS (the ambient brain animation — slow cloud rotation,
//   sparse soma pulses — is imperceptible at 30fps, so this halves GPU/compositor
//   work when nobody is scrolling).
//
// Kept in its own module (not journey-input.ts) so render-loop can import it
// without pulling in the DOM-bound input adapter, and to avoid a circular dep
// (journey-input already imports from neural-engine/hero-anchors).

/** performance.now() ms of the most recent journey input. Seeded to 0. */
let _lastInteraction = 0;

/** Record a journey interaction "now". Called by journey-input handlers. */
export function markJourneyInteraction(): void {
  _lastInteraction =
    typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** ms timestamp of the last journey interaction (0 if none yet). */
export function getLastInteraction(): number {
  return _lastInteraction;
}
