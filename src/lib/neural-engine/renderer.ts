// renderer.ts
// WebGL renderer setup: scene, camera, fog, EffectComposer + UnrealBloom.
// Ported 1:1 from vhxco-app.js lines 122-147.
//
// Bloom constants tuned for Fase 4a D7 (atmosphere):
//   strength: 0.7  (was 1.5 — softer glow, less competing with text)
//   radius:   0.4  (unchanged)
//   threshold: 0.6 (unchanged)
// Fog density tuned for Fase 4a D7:
//   FogExp2 density: 0.07 (was 0.04 — more atmospheric depth falloff)

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  FogExp2,
  Vector2,
  Color,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { RendererContext } from "./types.js";

// ─── Device tier (Phase 4b-2 perf) ───────────────────────────────────────────
// Cheap heuristic to scale GPU cost on weaker hardware. "low" targets phones and
// low-core machines; "high" is desktop. Drives DPR cap + bloom resolution.
//   - width < 768  → mobile-ish viewport
//   - hardwareConcurrency <= 4 → few cores (phones, low-end laptops)
//   - deviceMemory <= 4 → little RAM (when the browser exposes it)
// Any one trigger → "low". Conservative on purpose: false-positives only cost a
// slightly softer bloom / lower DPR, never a broken look.
type DeviceTier = "low" | "high";

function detectDeviceTier(): DeviceTier {
  if (typeof window === "undefined") return "high";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const smallViewport = window.innerWidth < 768;
  const fewCores =
    typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
  const lowMem = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  return smallViewport || fewCores || lowMem ? "low" : "high";
}

export function createRenderer(canvas: HTMLCanvasElement): RendererContext {
  const tier = detectDeviceTier();

  // Renderer — matches v0 exactly
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  // DPR cap (Phase 4b-2 perf). Retina/4K report devicePixelRatio 2-3; at DPR 3
  // the GPU shades ~9x the CSS-pixel count vs DPR 1. Cap at 2 on desktop, and
  // 1.5 on low-tier/mobile (≈1.78x fewer pixels than DPR 2, ≈4x fewer than DPR 3)
  // — the bloom-heavy neural scene is fill-rate bound, so this is the cheapest
  // big win on phones. [VISUAL-FLAG: mobile 1.5 is slightly softer than 2.]
  const dprCap = tier === "low" ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(new Color(0x000000), 1);

  // Scene + exponential fog (v0 line 130)
  const scene = new Scene();
  scene.fog = new FogExp2(0x000000, 0.07); // D7: was 0.04 — more depth falloff

  // Camera — FOV 50, near 0.1, far 200, pos z=14 (v0 lines 132-133)
  const camera = new PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(0, 0, 14);

  // Post-processing — bloom pipeline (v0 lines 136-146)
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom resolution (Phase 4b-2 perf). UnrealBloomPass allocates a chain of
  // downsample render targets sized from this Vector2 and runs a separable
  // Gaussian blur per mip — it's typically the single biggest GPU cost in the
  // frame. Rendering the bloom chain at HALF the framebuffer resolution cuts its
  // texel work ~4x. Because bloom is a wide low-frequency glow, the softness is
  // barely perceptible; strength/radius/threshold are UNCHANGED so the glow
  // character is preserved. [VISUAL-FLAG: half-res bloom — glow edges marginally
  // softer, most visible on thin bright axon lines. Vitor: confirm in smoke.]
  const BLOOM_SCALE = 0.5;
  const bloomPass = new UnrealBloomPass(
    new Vector2(
      window.innerWidth * BLOOM_SCALE,
      window.innerHeight * BLOOM_SCALE,
    ),
    0.7, // strength  — D7: was 1.5, softer glow recedes behind content
    0.4, // radius    — unchanged
    0.6, // threshold — unchanged
  );
  composer.addPass(bloomPass);

  // Resize handler
  function onResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    // Keep the bloom chain at half-res on resize (setSize above resets passes).
    bloomPass.setSize(
      window.innerWidth * BLOOM_SCALE,
      window.innerHeight * BLOOM_SCALE,
    );
  }
  window.addEventListener("resize", onResize);

  function dispose(): void {
    window.removeEventListener("resize", onResize);
    renderer.dispose();
  }

  return { renderer, scene, camera, composer, dispose };
}
