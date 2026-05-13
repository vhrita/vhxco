/**
 * HudWaveform.tsx — React island (client:idle)
 *
 * Canvas-2D waveform rendered in the HUD top-right corner.
 * Ported from vhxco-app.js lines 1001-1028 (tickWaveform).
 *
 * - 40-sample circular history
 * - Primary stroke: hsl(200, 80%, 65%)
 * - Glow stroke: same colour at 30% opacity, lineWidth=3
 * - Sample input: mouse speed normalised + subtle sine noise
 * - prefers-reduced-motion: draws static line, no rAF loop
 * - Mounted by BaseLayout as <HudWaveform client:idle />
 */

import { useEffect, useRef } from 'react';
import { WaveformDrawer } from '@/lib/effects/waveform';

const CANVAS_W = 80;
const CANVAS_H = 16;

export default function HudWaveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const drawer = new WaveformDrawer(canvas);

    if (reducedMotion) {
      // Push a mid-amplitude sample and draw once as a static line
      drawer.pushSample(0.5);
      drawer.drawStatic();
      return;
    }

    // Mouse speed tracking
    let mouseSpeed = 0;
    let prevX = 0;
    let prevY = 0;

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      mouseSpeed = Math.sqrt(dx * dx + dy * dy);
      prevX = e.clientX;
      prevY = e.clientY;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let rafId: number;

    const loop = () => {
      const t = performance.now();
      // Sample: normalised mouse speed + subtle sine noise (mirrors v0 formula)
      const sample =
        Math.min(1, mouseSpeed / 30) * 0.7 +
        Math.sin(t * 0.008) * 0.15 +
        0.15;
      drawer.pushSample(sample);
      drawer.draw();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="hudWaveform"
      width={CANVAS_W}
      height={CANVAS_H}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  );
}
