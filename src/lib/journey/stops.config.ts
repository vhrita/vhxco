// stops.config.ts
// Single source of truth for journey stop definitions.
//
// Each stop is a Vector3 inside the brain volume. These are fixed design-time
// coordinates — NOT derived from Math.random() neuron positions. This is intentional
// (ADR-0020 / blueprint §3.2 D2): anchors are deterministic by construction, so
// f(t) is reproducible across reloads without depending on RNG order.
//
// Brain ellipsoid reference (neurons.ts brain-cloud.ts):
//   r1 = cerebrum     (x/6.5, y-1/4.5, z/5)  — large front lobe
//   r2 = occipital    (x+2/5, y+0.5/3.5, z/4) — right back lobe
//   r3 = cerebellum   (x+3.5/2.5, y+2.5/2, z/2.5) — lower back
//   r4 = brainstem    (x+1/1.2, y+4/2.5, z/1.2)  — narrow stem
//
// All 5 points are verified inside at least one ellipsoid (r≤1).
// Fase 4a Sub-passo 5: positions confirmed geometrically sound per ellipsoid
// equations. Visual void-check is done via QA Sub-passo 6 screenshots.
// If QA finds a stop framing void/black, adjust the Vector3 here — all
// downstream (arc-length, topnav, journey-state) derives from this array.
//
// V1 pain-first order: PRESENTE(0)→PROBLEMA(1)→MÉTODO(2)→PROVA(3)→DIAGNOSE(4)

import { Vector3 } from "three";

export interface StopConfig {
  /** Fixed camera anchor position inside the brain volume */
  position: Readonly<Vector3>;
  /** Human-readable label (used by HUD chapters — Builder #2) */
  label: string;
  /** Chapter slug (for URL deep-link — future) */
  slug: string;
}

// Cerebrum — front/top of brain: r1=(0/5.5)²+(2/3.5)²+(0/4)²≈0.33 ✓
const stop0 = Object.freeze(new Vector3(0.0, 2.0, 0.5));

// Right occipital — r1=(3/5.5)²+(0/3.5)²+(1/4)²≈0.36 ✓
const stop1 = Object.freeze(new Vector3(3.0, 0.5, 1.0));

// Left mid — r1=(-2/5.5)²+(-1/3.5)²+(0/4)²≈0.21 ✓
const stop2 = Object.freeze(new Vector3(-2.0, -0.5, 0.0));

// Cerebellum — r3=(-3.5+3.5/2)²+(-2+2.5/1.5)²+(0/2)²=0+0.11+0=0.11 ✓
const stop3 = Object.freeze(new Vector3(-3.5, -2.0, 0.5));

// Brainstem — r4=(-1+1/1)²+(-3.5+4/2)²+(0/1)²=0+0.06+0=0.06 ✓
const stop4 = Object.freeze(new Vector3(-1.0, -3.5, 0.0));

export const STOPS: StopConfig[] = [
  { position: stop0, label: "Presente", slug: "presente" },
  { position: stop1, label: "Problema", slug: "problema" },
  { position: stop2, label: "Método", slug: "metodo" },
  { position: stop3, label: "Prova", slug: "prova" },
  { position: stop4, label: "Diagnose", slug: "diagnose" },
];

/** Number of stops — derive from STOPS array; never hardcode 5 elsewhere */
export const STOP_COUNT = STOPS.length;
