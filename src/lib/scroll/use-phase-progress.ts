// use-phase-progress.ts
// React hook that reads phase + progress from the orchestrator store.
// Uses useSyncExternalStore for concurrent-safe updates.
//
// Usage:
//   const { phase, progress, target } = usePhaseProgress();

import { useSyncExternalStore } from 'react';
import {
  getPhaseState,
  subscribePhase,
  type PhaseOrchestratorState,
} from './phase-orchestrator.js';

function getSnapshot(): PhaseOrchestratorState {
  return getPhaseState();
}

// Server snapshot — static initial state for SSR (Astro islands render on server)
const _serverSnapshot: PhaseOrchestratorState = { phase: 0, progress: 0.125, target: 0.125 };
function getServerSnapshot(): PhaseOrchestratorState {
  return _serverSnapshot;
}

export function usePhaseProgress(): PhaseOrchestratorState {
  return useSyncExternalStore(subscribePhase, getSnapshot, getServerSnapshot);
}
