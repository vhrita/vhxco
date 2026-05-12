// phase-state.ts
// Lightweight store for current phase + scroll progress.
// ~40 lines, no external dependencies — replaces window.VHXCO phase globals.
// Pattern: micro-subscribe store, compatible with React useEffect subscriptions.

export interface PhaseState {
  phase: number;
  progress: number;
}

type Listener = (state: PhaseState) => void;

let _state: PhaseState = { phase: 0, progress: 0.125 };
const _listeners = new Set<Listener>();

function _notify(): void {
  _listeners.forEach((fn) => fn({ ..._state }));
}

export const phaseStore = {
  get state(): PhaseState {
    return { ..._state };
  },

  get phase(): number {
    return _state.phase;
  },

  get progress(): number {
    return _state.progress;
  },

  setPhase(phase: number): void {
    if (_state.phase !== phase) {
      _state = { ..._state, phase };
      _notify();
    }
  },

  setProgress(progress: number): void {
    _state = { ..._state, progress };
    _notify();
  },

  set(phase: number, progress: number): void {
    _state = { phase, progress };
    _notify();
  },

  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};
