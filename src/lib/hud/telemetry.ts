// telemetry.ts
// Pure HUD telemetry — no DOM, no side-effects.
// Consumers call getTelemetry() each tick to get the current display values.
// All strings are locale-agnostic (numbers, codes, fixed labels).
//
// Mouse state is fed in via updateMouseState(x, y, speed).
// Frame counter is incremented via tickFrame().

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TelemetryState {
  /** UTC time string: HH:MM:SS */
  utc: string;
  /** Zero-padded 6-digit frame counter */
  frame: string;
  /** Coordinate string: x:NNNN y:NNNN z:NNNN */
  coord: string;
  /** Latency estimate string: NNms */
  latency: string;
  /** Temperature estimate string: NN.N°C */
  temp: string;
  /** Node label for current phase */
  node: string;
}

// ─── Node labels per phase (idioma-agnóstico) ──────────────────────────────

const NODE_LABELS: readonly string[] = [
  'CORE/PRIMARY',
  'ENGINEERING/VECTORS',
  'ECOSYSTEM/PRODUCTS',
  'DATA/ROOM',
  'DIAGNOSE/LINK',
];

// ─── Internal mutable state ───────────────────────────────────────────────────

let _frameCount = 0;
let _mouseX = 0;
let _mouseY = 0;
let _mouseSpeed = 0;
let _phase = 0;
let _progress = 0;

// ─── Exported mutators ────────────────────────────────────────────────────────

/** Feed mouse position + speed into telemetry each pointermove. */
export function updateMouseState(
  x: number,
  y: number,
  speed: number
): void {
  _mouseX = x;
  _mouseY = y;
  _mouseSpeed = speed;
}

/** Feed phase/progress from the phase orchestrator store. */
export function updatePhaseState(phase: number, progress: number): void {
  _phase = phase;
  _progress = progress;
}

/**
 * Increment internal frame counter by 1.
 * Returns true every 4th frame (consumer should update DOM on true).
 * Returns false immediately when prefers-reduced-motion is active (caller
 * should throttle to 1s instead).
 */
export function tickFrame(): boolean {
  _frameCount++;
  return _frameCount % 4 === 0;
}

/** Current raw frame count (for waveform throttle). */
export function getFrameCount(): number {
  return _frameCount;
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/**
 * Compute and return a full telemetry snapshot.
 * Safe to call on every animation frame — pure calculation, no side effects.
 */
export function getTelemetry(t: number = performance.now()): TelemetryState {
  const now = new Date();
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');
  const ss = now.getUTCSeconds().toString().padStart(2, '0');

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;

  const coordX = ((_mouseX / vw) * 2000 - 1000) | 0;
  const coordY = ((_mouseY / vh) * 2000 - 1000) | 0;
  const coordZ = (_progress * 9999) | 0;

  const baseLat = 8 + Math.min(_mouseSpeed * 0.5, 15);
  const latency = ((baseLat + Math.sin(t * 0.001) * 2) | 0) + 'ms';
  const temp =
    (35.5 + Math.sin(t * 0.0003) * 1.2 + _mouseSpeed * 0.02).toFixed(1) +
    '°C';

  return {
    utc: `${hh}:${mm}:${ss}`,
    frame: _frameCount.toString().padStart(6, '0'),
    coord: `x:${coordX.toString().padStart(4, ' ')} y:${coordY
      .toString()
      .padStart(4, ' ')} z:${coordZ.toString().padStart(4, ' ')}`,
    latency,
    temp,
    node: NODE_LABELS[Math.min(_phase, NODE_LABELS.length - 1)] ?? 'CORE/PRIMARY',
  };
}
