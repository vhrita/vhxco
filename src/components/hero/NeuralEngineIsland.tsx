import { useEffect, useRef } from "react";
import {
  createNeuralEngine,
  type NeuralEngineHandle,
} from "@/lib/neural-engine";
import { isWebGLAvailable } from "@/lib/neural-engine/webgl-support";

type Locale = "pt" | "en";

// Localized canvas description (a11y). Was hardcoded PT — now honors the page
// locale so /en/ announces English (audit: aria-label i18n).
const CANVAS_LABEL: Record<Locale, string> = {
  pt: "Visualização 3D de uma rede neural digital com 35 mil partículas formando a silhueta de um cérebro, neurônios pulsando e sinapses se conectando em tempo real",
  en: "A 3D visualization of a digital neural network: 35,000 particles forming the silhouette of a brain, with neurons pulsing and synapses connecting in real time",
};

// Watchdog: if the engine mounts but never signals ready (journey:intro-done)
// within this window, treat it as stuck and fall back. Genesis+dolly is ~2.6s,
// so this is generous headroom; it exists purely to guarantee "never a black
// screen". Below the BaseLayout 8s hard reveal so we swap to the (on-brand)
// static brain BEFORE the bare boot-gate removal would expose black canvas.
const READY_WATCHDOG_MS = 7000;

export default function NeuralEngineIsland({
  locale = "pt",
}: {
  locale?: Locale;
}) {
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
      document.body.dataset.webgl = "unavailable";
      // Remove the dead canvas so no empty black element sits over the fallback.
      canvasRef.current?.remove();
      return;
    }

    if (!canvasRef.current) return;

    // Error boundary: if the engine throws during init (bad GPU / OOM / driver
    // quirk that passed the isWebGLAvailable() probe but fails on real work), do
    // NOT leave the user behind a hidden screen over a black canvas for 8s.
    // Route through the SAME no-WebGL fallback path: set data-webgl=unavailable
    // (BaseLayout's inline gate reveals content + the CSS shows the static
    // brain) and drop the dead canvas.
    const failToFallback = () => {
      document.body.dataset.webgl = "unavailable";
      canvasRef.current?.remove();
    };

    let engine: NeuralEngineHandle | null = null;
    try {
      engine = createNeuralEngine(canvasRef.current);
    } catch (err) {
      console.error("[neural-engine] init failed — revealing fallback", err);
      failToFallback();
      return;
    }

    if (import.meta.env.DEV) (window as any).__engine = engine;

    // Ready watchdog — if the engine never fires intro-done, reveal the fallback
    // so content is never stuck behind a black canvas. Cleared once ready.
    let watchdog: number | undefined = window.setTimeout(() => {
      watchdog = undefined;
      console.error(
        "[neural-engine] no ready signal in time — revealing fallback",
      );
      engine?.dispose();
      failToFallback();
    }, READY_WATCHDOG_MS);

    const onReady = () => {
      if (watchdog !== undefined) {
        clearTimeout(watchdog);
        watchdog = undefined;
      }
    };
    window.addEventListener("journey:intro-done", onReady, { once: true });

    return () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      window.removeEventListener("journey:intro-done", onReady);
      engine?.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="webgl"
      aria-label={CANVAS_LABEL[locale]}
      role="img"
    />
  );
}
