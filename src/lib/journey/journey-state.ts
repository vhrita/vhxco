// journey-state.ts
// Authoritative journey store { t, activeStop }.
//
// Extracted from render-loop.ts inline store (Builder #1).
// This is the single source of truth for camera t and activeStop.
//
// Architecture (blueprint §4.2 / §4.4):
//   - setJourneyT(t) is INSTANT — clamps [0,1], recomputes activeStop,
//     notifies listeners. No lerp here. Easing lives in journey-input.ts.
//   - Two subscription tiers to avoid 60fps audio/DOM spam:
//       subscribeJourney(fn)   — fires every time t changes (React hook, render-loop)
//       subscribeActiveStop(fn) — fires only when activeStop changes (audio, Phase*.astro,
//                                  TopNav active-button toggle)
//
// Blueprint §7 RAF ordering:
//   input.applyEasing() → setJourneyT(t) → render reads getJourneyT() → camera = f(t)

import { nearestStopIndex } from "../neural-engine/hero-anchors.js";

// ─── State ─────────────────────────────────────────────────────────────────────

let _t = 0;
let _activeStop = 0;

// ─── Subscribers ───────────────────────────────────────────────────────────────

// Tier 1: every t change (React useSyncExternalStore, render-loop)
const _journeyListeners = new Set<() => void>();
// Tier 2: only activeStop changes (audio hooks, Phase*.astro data-active, TopNav)
const _stopListeners = new Set<() => void>();

// ─── Setters ───────────────────────────────────────────────────────────────────

/**
 * Set journey t. INSTANT — clamps to [0,1], recomputes activeStop, notifies
 * all listeners. No lerp inside this function (blueprint §4.2).
 */
export function setJourneyT(t: number): void {
  _t = Math.max(0, Math.min(1, t));
  const newStop = nearestStopIndex(_t);
  const stopChanged = newStop !== _activeStop;
  _activeStop = newStop;

  // Tier-1: every t change
  _journeyListeners.forEach((fn) => fn());

  // Tier-2: only when activeStop changes (avoids 60fps audio/DOM spam)
  if (stopChanged) {
    _stopListeners.forEach((fn) => fn());
  }
}

// ─── Getters ───────────────────────────────────────────────────────────────────

/** Current journey t ∈ [0,1]. Hot-path safe — no allocation. */
export function getJourneyT(): number {
  return _t;
}

/** Index of the nearest stop to current t. Derived — not directly settable. */
export function getActiveStop(): number {
  return _activeStop;
}

// ─── Subscriptions ─────────────────────────────────────────────────────────────

/**
 * Subscribe to every t change.
 * Used by: React useSyncExternalStore in use-journey-progress.ts
 * Returns unsubscribe function.
 */
export function subscribeJourney(fn: () => void): () => void {
  _journeyListeners.add(fn);
  return () => _journeyListeners.delete(fn);
}

/**
 * Subscribe to activeStop changes only (fires at most N-1 times total, not 60fps).
 * Used by: audio hook, Phase*.astro data-active toggle, TopNav active button.
 * Returns unsubscribe function.
 */
export function subscribeActiveStop(fn: () => void): () => void {
  _stopListeners.add(fn);
  return () => _stopListeners.delete(fn);
}

// ─── Snapshot for React useSyncExternalStore ───────────────────────────────────

export interface JourneySnapshot {
  t: number;
  activeStop: number;
}

/**
 * Returns a stable snapshot object for useSyncExternalStore.
 * Note: returns a new object on every call — React will re-render when this
 * is called after a notification. For server-side rendering, use getServerSnapshot.
 */
export function getJourneySnapshot(): JourneySnapshot {
  return { t: _t, activeStop: _activeStop };
}

/** Static server-side snapshot for SSR (Astro islands). */
export const SERVER_SNAPSHOT: JourneySnapshot = { t: 0, activeStop: 0 };
