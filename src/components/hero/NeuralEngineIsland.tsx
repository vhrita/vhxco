import { useEffect, useRef } from 'react';
import { createNeuralEngine } from '@/lib/neural-engine';
import { isWebGLAvailable } from '@/lib/neural-engine/webgl-support';

export default function NeuralEngineIsland() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Robustness gate (Fase 5): if WebGL is unavailable/disabled, do NOT mount
    // the engine. Mounting would throw in WebGLRenderer and paint a black canvas
    // — a broken first impression for clients on old/corporate/GPU-blocked
    // browsers. Instead flag the body so CSS reveals the static fallback and
    // drop the canvas entirely. The journey content still reveals: `data-intro`
    // is only set by the render-loop (which never starts here), and
    // `data-active-stop="0"` is set by BaseLayout, so stop 0 is visible.
    if (!isWebGLAvailable()) {
      document.body.dataset.webgl = 'unavailable';
      // Remove the dead canvas so no empty black element sits over the fallback.
      canvasRef.current?.remove();
      return;
    }

    if (!canvasRef.current) return;
    const engine = createNeuralEngine(canvasRef.current);
    if (import.meta.env.DEV) (window as any).__engine = engine;
    return () => engine.dispose();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="webgl"
      aria-label="Visualização 3D de uma rede neural digital com 35 mil partículas formando a silhueta de um cérebro, neurônios pulsando e sinapses se conectando em tempo real"
      role="img"
    />
  );
}
