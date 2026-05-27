// synapse-sound.ts
// Procedural audio system — no binary assets, full Web Audio API.
// Ported from vhxco-app.js lines 1085-1197.
//
// Design: all state is module-level singletons (lazy-init on first use).
// AudioContext is created only after a user gesture (browser policy).
// Exposed on window.__audioReady after lazy-init.ts boots it.
//
// Phase-adaptive ambient drone (freqs/filters/gains preserved from v0):
//   phase 0: 55Hz  / filter 120 / gain 0.018  (deep)
//   phase 1: 65Hz  / filter 200 / gain 0.015  (rising)
//   phase 2: 82Hz  / filter 300 / gain 0.012  (rhythmic)
//   phase 3: 48Hz  / filter 100 / gain 0.020  (tension)
//   phase 4: 55Hz  / filter 120 / gain 0.018  (fallback = phase 0)

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AmbientNodes {
  o: OscillatorNode;
  o2: OscillatorNode;
  o3: OscillatorNode;
  g: GainNode;
  f: BiquadFilterNode;
}

// ─── Singleton state ───────────────────────────────────────────────────────────

let _ctx: AudioContext | null = null;
let _muted = false;
let _ambientNodes: AmbientNodes | null = null;
let _ambientPhase = -1;

// Phase-specific tuning — exact values from v0
const PHASE_FREQS = [55, 65, 82, 48, 55] as const;
const PHASE_FILTERS = [120, 200, 300, 100, 120] as const;
const PHASE_GAINS = [0.018, 0.015, 0.012, 0.02, 0.018] as const;

// ─── AudioContext singleton ────────────────────────────────────────────────────

export function getAudioContext(): AudioContext | null {
  if (_ctx) return _ctx;
  try {
    _ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
  } catch {
    return null;
  }
  return _ctx;
}

// ─── Transient sounds ─────────────────────────────────────────────────────────

/** Short sine-wave ping. freq defaults to 880 Hz. */
export function audioPing(freq = 880): void {
  if (_muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.value = 0;
  o.connect(g);
  g.connect(ctx.destination);

  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.start(t);
  o.stop(t + 0.45);
}

/**
 * Dimensional-shift swoosh: sawtooth + filter sweep + white-noise burst.
 * Exact port from v0 lines 1112-1148.
 */
export function audioSwoosh(): void {
  if (_muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  // Sawtooth layer
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = "sawtooth";
  f.type = "lowpass";
  f.frequency.value = 800;
  f.Q.value = 8;
  o.connect(f);
  f.connect(g);
  g.connect(ctx.destination);

  const t = ctx.currentTime;
  o.frequency.setValueAtTime(200, t);
  o.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
  o.frequency.exponentialRampToValueAtTime(80, t + 0.4);
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(2000, t + 0.12);
  f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.04, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.start(t);
  o.stop(t + 0.5);

  // White-noise burst layer
  const bufSz = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, bufSz, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSz; i++) data[i] = (Math.random() * 2 - 1) * 0.5;

  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = 1000;
  nf.Q.value = 2;
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(ctx.destination);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.025, t + 0.02);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  noise.start(t);
  noise.stop(t + 0.35);
}

/** Boot sequence: two sequenced pings (660 Hz → 990 Hz, 180 ms apart). */
export function audioBoot(): void {
  if (_muted) return;
  setTimeout(() => audioPing(660), 0);
  setTimeout(() => audioPing(990), 180);
}

// ─── Ambient drone ─────────────────────────────────────────────────────────────

/** Start 3-oscillator ambient drone. Idempotent — stops existing nodes first. */
export function startAmbient(): void {
  if (_muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (_ambientNodes) stopAmbient();

  const o = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const o3 = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();

  f.type = "lowpass";
  f.frequency.value = 120;

  o.type = "sine";
  o.frequency.value = 55;
  o2.type = "sine";
  o2.frequency.value = 55.3;
  o3.type = "triangle";
  o3.frequency.value = 82.5;

  o.connect(f);
  o2.connect(f);
  o3.connect(f);
  f.connect(g);
  g.connect(ctx.destination);

  // Fade in gently from silence
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.018, t + 1.5);

  o.start();
  o2.start();
  o3.start();
  _ambientNodes = { o, o2, o3, g, f };
  _ambientPhase = 0;
}

/**
 * Re-tune ambient drone for a given stop index.
 * Accepts any number — clamps to [0, PHASE_FREQS.length - 1] for backwards
 * compatibility with the 5-bucket tuning table (blueprint §10 R6).
 *
 * Generalized from `(phaseIdx: 0|1|2|3|4)` to `(phaseIdx: number)` so
 * N-parametrizable journey (STOP_COUNT != 5) still works without type errors.
 * Audio buckets remain 5; extra stops above 4 fall back to bucket 4 (deep).
 */
export function setPhase(phaseIdx: number): void {
  const clamped = Math.max(
    0,
    Math.min(PHASE_FREQS.length - 1, Math.floor(phaseIdx)),
  ) as 0 | 1 | 2 | 3 | 4;
  if (!_ambientNodes || _ambientPhase === clamped) return;
  _ambientPhase = clamped;

  const ctx = getAudioContext();
  if (!ctx) return;

  const t = ctx.currentTime;
  const freq = PHASE_FREQS[clamped];
  const filt = PHASE_FILTERS[clamped];
  const gain = PHASE_GAINS[clamped];

  _ambientNodes.o.frequency.linearRampToValueAtTime(freq, t + 1.5);
  _ambientNodes.o2.frequency.linearRampToValueAtTime(freq + 0.3, t + 1.5);
  _ambientNodes.o3.frequency.linearRampToValueAtTime(freq * 1.5, t + 1.5);
  _ambientNodes.f.frequency.linearRampToValueAtTime(filt, t + 1);
  _ambientNodes.g.gain.linearRampToValueAtTime(gain, t + 1);
}

/** Stop and tear down ambient oscillators. */
export function stopAmbient(): void {
  if (!_ambientNodes) return;
  try {
    _ambientNodes.o.stop();
    _ambientNodes.o2.stop();
    _ambientNodes.o3.stop();
  } catch {
    // Already stopped — safe to ignore
  }
  _ambientNodes = null;
  _ambientPhase = -1;
}

// ─── Mute control ─────────────────────────────────────────────────────────────

export function mute(): void {
  _muted = true;
  stopAmbient();
}

export function unmute(): void {
  _muted = false;
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") ctx.resume();
  startAmbient();
  audioPing(880);
}

/** Toggle mute state. Returns new muted value. */
export function toggle(): boolean {
  if (_muted) {
    unmute();
  } else {
    mute();
  }
  return _muted;
}

export function isMuted(): boolean {
  return _muted;
}
