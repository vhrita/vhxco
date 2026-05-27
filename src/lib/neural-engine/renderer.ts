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

export function createRenderer(canvas: HTMLCanvasElement): RendererContext {
  // Renderer — matches v0 exactly
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

  const bloomPass = new UnrealBloomPass(
    new Vector2(window.innerWidth, window.innerHeight),
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
  }
  window.addEventListener("resize", onResize);

  function dispose(): void {
    window.removeEventListener("resize", onResize);
    renderer.dispose();
  }

  return { renderer, scene, camera, composer, dispose };
}
