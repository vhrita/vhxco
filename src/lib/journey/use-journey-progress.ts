// use-journey-progress.ts
// React hook that reads t + activeStop from journey-state.ts.
// Evolves use-phase-progress.ts — same useSyncExternalStore pattern.
//
// Usage:
//   const { t, activeStop } = useJourneyProgress();
//
// Blueprint §4.4: this hook is the React bridge for Phase*.astro content layers
// and any React component that needs to react to journey position.

import { useSyncExternalStore } from "react";
import {
  subscribeJourney,
  getJourneySnapshot,
  SERVER_SNAPSHOT,
  type JourneySnapshot,
} from "./journey-state.js";

export type { JourneySnapshot };

export function useJourneyProgress(): JourneySnapshot {
  return useSyncExternalStore(
    subscribeJourney,
    getJourneySnapshot,
    () => SERVER_SNAPSHOT,
  );
}
