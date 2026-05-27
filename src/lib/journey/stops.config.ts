// stops.config.ts
// Single source of truth for journey stop definitions.
//
// Each stop is a Vector3 inside the brain volume. These are fixed design-time
// coordinates — NOT derived from Math.random() neuron positions. This is intentional
// (ADR-0020 / blueprint §3.2 D2): anchors are deterministic by construction, so
// f(t) is reproducible across reloads without depending on RNG order.
//
// Brain ellipsoid reference (neurons.ts brain-cloud.ts):
//   r1 = cerebrum     (x/6.5,   (y-1)/4.5, z/5)    — large front lobe
//   r2 = occipital    ((x+2)/5, (y+0.5)/3.5, z/4)  — right back lobe
//   r3 = cerebellum   ((x+3.5)/2.5, (y+2.5)/2, z/2.5) — lower back
//   r4 = brainstem    ((x+1)/1.2, (y+4)/2.5, z/1.2) — narrow stem
//
// All 5 points are verified inside at least one ellipsoid (r≤1).
// Phase 4b-1: stop3 moved from cerebellum periphery → deep left cerebrum;
//             stop4 moved from brainstem tip → right cerebrum (dense, ≥2 units
//             from BRAIN_CENTER to avoid degenerate lookAt). Both fixes eliminate
//             the void frames that appeared at t≈0.8 and t=1.0.
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

// Cerebrum front/top — r1=(0/6.5)²+((2-1)/4.5)²+(0.5/5)²=0+0.049+0.01=0.059 ✓
const stop0 = Object.freeze(new Vector3(0.0, 2.0, 0.5));

// Right cerebrum — r1=(3/6.5)²+((0.5-1)/4.5)²+(1/5)²=0.213+0.012+0.04=0.265 ✓
const stop1 = Object.freeze(new Vector3(3.0, 0.5, 1.0));

// Left mid cerebrum — r1=(-2/6.5)²+((-0.5-1)/4.5)²+(0/5)²=0.095+0.111+0=0.206 ✓
const stop2 = Object.freeze(new Vector3(-2.0, -0.5, 0.0));

// Deep left cerebrum (was: cerebellum periphery — caused void at t≈0.8).
// r1=(-2.5/6.5)²+((1-1)/4.5)²+((-1)/5)²=0.148+0+0.04=0.188 ✓
const stop3 = Object.freeze(new Vector3(-2.5, 1.0, -1.0));

// Right cerebrum deep (was: brainstem tip — caused void at t=1.0).
// Placed ≥2 units from BRAIN_CENTER(-0.5,0.3,0): dist≈√(6.25+0.09+2.25)=√8.59≈2.93 ✓
// r1=(2/6.5)²+((0.5-1)/4.5)²+((-1.5)/5)²=0.095+0.012+0.09=0.197 ✓
const stop4 = Object.freeze(new Vector3(2.0, 0.5, -1.5));

export const STOPS: StopConfig[] = [
  { position: stop0, label: "Presente", slug: "presente" },
  { position: stop1, label: "Problema", slug: "problema" },
  { position: stop2, label: "Método", slug: "metodo" },
  { position: stop3, label: "Prova", slug: "prova" },
  { position: stop4, label: "Diagnose", slug: "diagnose" },
];

/** Number of stops — derive from STOPS array; never hardcode 5 elsewhere */
export const STOP_COUNT = STOPS.length;
