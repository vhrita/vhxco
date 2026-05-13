// waveform.ts
// Pure canvas-2D waveform drawer — no DOM queries, no React, no Astro.
// Consumers create a WaveformDrawer, feed samples, and call draw() each frame.
//
// Port of vhxco-app.js lines 1006-1028 (tickWaveform / hudWaveform canvas).

const SAMPLE_COUNT = 40;
const HUE = 200; // hsl(200, 80%, 65%) — brand cyan

export class WaveformDrawer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly history = new Float32Array(SAMPLE_COUNT);
  private writeIdx = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('WaveformDrawer: canvas 2D context unavailable');
    this.ctx = ctx;
  }

  /**
   * Push one sample (0..1) into the circular history buffer.
   * Call once per frame (or per desired sample rate).
   */
  pushSample(value: number): void {
    this.history[this.writeIdx % SAMPLE_COUNT] = Math.min(1, Math.max(0, value));
    this.writeIdx++;
  }

  /**
   * Render the current history to the canvas.
   * Draws two passes: thin primary stroke + wide glow stroke.
   */
  draw(): void {
    const { ctx } = this;
    const { width, height } = ctx.canvas;
    const midY = height / 2;
    const amplitude = height * 0.44; // keeps waveform within canvas bounds

    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const sampleIdx = (this.writeIdx + i) % SAMPLE_COUNT;
      const x = (i / (SAMPLE_COUNT - 1)) * width;
      const y = midY - this.history[sampleIdx] * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Primary stroke
    ctx.strokeStyle = `hsl(${HUE}, 80%, 65%)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Glow stroke (wider, 30% opacity)
    ctx.strokeStyle = `hsla(${HUE}, 80%, 65%, 0.3)`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /**
   * Draw a static flat line (for prefers-reduced-motion).
   * Represents a quiescent signal at mid-amplitude.
   */
  drawStatic(): void {
    const { ctx } = this;
    const { width, height } = ctx.canvas;
    const y = height / 2 - height * 0.22; // slightly above centre = 0.5 sample

    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);

    ctx.strokeStyle = `hsl(${HUE}, 80%, 65%)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = `hsla(${HUE}, 80%, 65%, 0.3)`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
