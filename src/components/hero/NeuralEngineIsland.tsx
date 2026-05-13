import { useEffect, useRef } from 'react';
import { createNeuralEngine } from '@/lib/neural-engine';

export default function NeuralEngineIsland() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
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
