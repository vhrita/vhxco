// render-loop.ts
// 60fps RAF render loop with camera orchestration and panel extraction math.
// Ported 1:1 from vhxco-app.js lines 1277-1428 (Seção 11 — Render Loop).
//
// Key behaviors preserved:
// - lerp progress → targetProgress (smoothing factor 0.07)
// - Phase 0: orbital camera outside brain (z=11→6.5, orbital XY)
// - Phases 1-4: anchor to hero neuron + panel extraction trigger
// - Brain roll: sin(progress * PI * 3) * 0.2
// - brainCloud rotation: y = t * rotSpeed, x = sin(t * 0.02) * 0.1
//
// Three.js 0.184 note: Clock is deprecated since r183 in favor of Timer.
// We use performance.now() directly to avoid the deprecation warning — same
// semantics, no behavior change.

import { Vector3 } from 'three';
import type { RendererContext, BrainCloudHandle, NeuralNetworkHandle } from './types.js';
import type { NeuralNetworkWithHeroes } from './neurons.js';
import type { SynapsesHandle } from './synapses.js';
import { bootProgress } from './boot-progress.js';
import { phaseStore } from './phase-state.js';
import type { RenderLoopHandle } from './types.js';
import { getTargetProgress, setLerpedProgress, setTargetProgress } from '../scroll/phase-orchestrator.js';

// Lerp utility — inline to keep this module self-contained
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Convert raw progress (0-1) to phase index (0-4)
function progressToPhase(p: number): number {
  return Math.min(4, Math.floor(p * 5 * 0.999));
}

export interface RenderLoopParams {
  ctx: RendererContext;
  cloud: BrainCloudHandle;
  network: NeuralNetworkHandle;
  synapses: SynapsesHandle;
  animSpeed?: number;
}

export function createRenderLoop(params: RenderLoopParams): RenderLoopHandle {
  const { ctx, cloud, network, synapses } = params;
  const animSpeed = params.animSpeed ?? 0.4;

  // Cast to access heroNeurons (set in neurons.ts)
  const netWithHeroes = network as unknown as NeuralNetworkWithHeroes;

  let rafId = 0;
  let running = false;

  // Manual timing using performance.now() — replaces deprecated THREE.Clock
  let startTime = 0;
  let prevTime = 0;

  // Scroll progress state — targetProgress is now owned by phase-orchestrator.
  // render-loop reads it via getTargetProgress() and lerps toward it each frame.
  let progress = 0;

  // Soma energy update (v0 lines 527-537) — runs in render loop where we have attrSomaEnergy
  function updateSomaEnergy(t: number): void {
    const somaEnergy = network.somaEnergyAttr.array as Float32Array;
    for (let i = 0; i < network.neurons.length; i++) {
      const n = network.neurons[i];
      const timeSinceFire = t - n.lastFire;
      // Glow lasts 1.5s (v0 line 532)
      somaEnergy[i] = timeSinceFire < 1.5 ? 1.0 - timeSinceFire / 1.5 : 0;
    }
    network.somaEnergyAttr.needsUpdate = true;
  }

  function render(): void {
    const now = performance.now() / 1000; // seconds
    const dt = Math.min(now - prevTime, 0.1); // cap dt at 100ms
    prevTime = now;
    const t = (now - startTime) * animSpeed;

    // Read target from the orchestrator (user scroll/keyboard input)
    const targetProgress = getTargetProgress();
    progress = lerp(progress, targetProgress, 0.07);

    // Publish lerped progress back to orchestrator store (drives React hooks + HUD)
    setLerpedProgress(progress);

    // Update internal phase store so engine camera can react
    const phaseIdx = progressToPhase(progress);
    if (phaseStore.phase !== phaseIdx) phaseStore.setPhase(phaseIdx);
    phaseStore.setProgress(progress);

    // Camera targets
    let zT: number, xT: number, yT: number, fovT: number;
    let targetLookX = 0, targetLookY = 0, targetLookZ = 0;

    if (progress < 0.25) {
      // Phase 0: orbital outside brain (v0 lines 1288-1296)
      const k = progress / 0.25;
      zT = lerp(11, 6.5, k);
      xT = Math.sin(t * 0.15 + k * Math.PI) * 2.0;
      yT = Math.cos(t * 0.1) * 1.5;
      fovT = 65;
      targetLookX = -xT * 0.15;
      targetLookY = -yT * 0.15;
      targetLookZ = 0;
    } else {
      // Phases 1-4: anchored to hero neurons (v0 lines 1299-1316)
      const phaseData = progressToPhase(progress);
      const heroIdx = Math.max(0, phaseData - 1);
      const hero = netWithHeroes.heroNeurons?.[heroIdx];

      if (!hero) {
        xT = 0; yT = 0; zT = 0;
      } else {
        xT = hero.x + 0.5; // Offset for text panel
        yT = hero.y;
        zT = hero.z + 1.8;
        targetLookX = hero.x;
        targetLookY = hero.y;
        targetLookZ = hero.z;
      }

      fovT = 95;
    }

    const { camera } = ctx;
    camera.position.x = lerp(camera.position.x, xT, 0.05);
    camera.position.y = lerp(camera.position.y, yT, 0.05);
    camera.position.z = lerp(camera.position.z, zT, 0.05);

    if (Math.abs(camera.fov - fovT) > 0.05) {
      camera.fov = lerp(camera.fov, fovT, 0.05);
      camera.updateProjectionMatrix();
    }

    camera.lookAt(new Vector3(targetLookX, targetLookY, targetLookZ));

    // Camera roll (v0 line 1403)
    const roll = Math.sin(progress * Math.PI * 3) * 0.2;
    camera.up.set(roll, 1, 0);

    // Brain cloud uniforms
    cloud.mat.uniforms.uTime.value = t;
    cloud.mat.uniforms.uHue.value = 200 / 360; // VHXCO cyan — matches v0 TWEAKS.primaryHue
    cloud.mat.uniforms.uBootProgress.value = bootProgress.value;

    // Brain cloud rotation (v0 lines 1417-1418)
    const rotSpeed = lerp(0.05, 0.01, progress);
    cloud.points.rotation.y = t * rotSpeed;
    cloud.points.rotation.x = Math.sin(t * 0.02) * 0.1;

    // Neural network updates
    updateSomaEnergy(t);
    network.somaMat.uniforms.uTime.value = t;
    network.webMat.uniforms.uTime.value = t;
    network.somaMat.uniforms.uBootProgress.value = bootProgress.value;
    network.webMat.uniforms.uBootProgress.value = bootProgress.value;
    network.somaMat.uniforms.uHue.value = 200 / 360;
    network.webMat.uniforms.uHue.value = 200 / 360;

    // Synapses (pulse traveling update)
    synapses.update(t, dt, network.neurons, network.staticEdges);

    // Hero neuron stays active when camera is close (panel extraction trigger)
    // Keeps soma glowing red + inflated (v0 line 1386)
    if (progress >= 0.25 && netWithHeroes.heroNeurons) {
      const currentPhaseIdx = progressToPhase(progress);
      if (currentPhaseIdx > 0) {
        const heroIdx = Math.max(0, currentPhaseIdx - 1);
        const hero = netWithHeroes.heroNeurons[heroIdx];
        if (hero) {
          const dist = Math.abs(camera.position.z - zT);
          if (dist < 0.6) {
            hero.lastFire = t + 0.1;
          }
        }
      }
    }

    // Compose + render
    ctx.composer.render();

    if (running) rafId = requestAnimationFrame(render);
  }

  function start(): void {
    if (running) return;
    running = true;
    startTime = performance.now() / 1000;
    prevTime = startTime;
    rafId = requestAnimationFrame(render);
  }

  function stop(): void {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function setPhase(phase: number, progress_: number): void {
    // Update orchestrator target so the render-loop lerps to it next frame.
    // Kept for backward-compat with engine.setPhase() API.
    const tp = progress_ !== undefined ? progress_ : (phase + 0.5) / 5;
    setTargetProgress(tp, phase);
    phaseStore.set(phase, tp);
  }

  return { start, stop, setPhase };
}
