// boot-progress.ts
// Lightweight store for bootProgress (0 → 1) shared between preloader and shaders.
// Replaces window.bootProgress global from v0.
// Pattern: subscribe-based store (~30 lines).

type Listener = (value: number) => void;

let _value = 0.0;
const _listeners = new Set<Listener>();

export const bootProgress = {
  get value(): number {
    return _value;
  },

  set(v: number): void {
    _value = Math.max(0, Math.min(1, v));
    _listeners.forEach((fn) => fn(_value));
  },

  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};
