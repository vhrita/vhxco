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
// All 6 points are verified inside at least one ellipsoid (r≤1).
// Phase 4b-1: stop3 moved from cerebellum periphery → deep left cerebrum;
//             stop4 moved from brainstem tip → right cerebrum (dense, ≥2 units
//             from BRAIN_CENTER to avoid degenerate lookAt). Both fixes eliminate
//             the void frames that appeared at t≈0.8 and t=1.0.
// N=6 (copy plan D1): new SERVIÇOS anchor inserted between MÉTODO and PROVA.
//             Placed in upper-right cerebrum (dense lobe), ≥2 units from
//             BRAIN_CENTER and distinct from every neighbor → rich geometry,
//             not void. Verification math inline below.
// N=7 (contact-v3): new CONTATO anchor appended after DIAGNOSE as the journey's
//             deliberate closing frame — a gentle "rise & pull back" continuation
//             of the dolly (up + back from the deep-back Diagnose anchor). Still
//             INSIDE the cerebrum (dense, no void), short smooth final segment,
//             and at t=1 f(t)'s lookAt falls back to BRAIN_CENTER (render-loop.ts
//             §applyCameraF edge case) so the whole mass frames the close. Math
//             verified inline below.
// If QA finds a stop framing void/black, adjust the Vector3 here — all
// downstream (arc-length, topnav, journey-state) derives from this array.
//
// V1 pain-first order:
//   PROMESSA(0)→GARGALO(1)→MÉTODO(2)→SERVIÇOS(3)→PROVA(4)→DIAGNOSE(5)→CONTATO(6)

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

// SERVIÇOS (N=6, phase 4b-2 copy plan D1) — upper-right cerebrum, dense lobe.
// Distinct from every neighbor (stop2=(-2,-0.5,0), stop4=(-2.5,1,-1)-old-prova).
// dist to BRAIN_CENTER(-0.5,0.3,0): √(1.5²+1.2²+1.5²)=√(2.25+1.44+2.25)=√5.94≈2.44 ✓ (≥2, no degenerate lookAt)
// r1=(1/6.5)²+((1.5-1)/4.5)²+(1.5/5)²=0.024+0.012+0.09=0.126 ✓ (deep inside cerebrum)
const stop3 = Object.freeze(new Vector3(1.0, 1.5, 1.5));

// Deep left cerebrum (was: cerebellum periphery — caused void at t≈0.8).
// r1=(-2.5/6.5)²+((1-1)/4.5)²+((-1)/5)²=0.148+0+0.04=0.188 ✓
const stop4 = Object.freeze(new Vector3(-2.5, 1.0, -1.0));

// Right cerebrum deep (was: brainstem tip — caused void at t=1.0).
// Placed ≥2 units from BRAIN_CENTER(-0.5,0.3,0): dist≈√(6.25+0.09+2.25)=√8.59≈2.93 ✓
// r1=(2/6.5)²+((0.5-1)/4.5)²+((-1.5)/5)²=0.095+0.012+0.09=0.197 ✓
const stop5 = Object.freeze(new Vector3(2.0, 0.5, -1.5));

// CONTATO (N=7, contact-v3) — closing frame. From stop5(2,0.5,-1.5) the camera
// rises and pulls back: up (+2.0 y) and further into the back (-2.5 z), settling
// elevated over the rear cerebrum looking down-forward at BRAIN_CENTER.
// · Short, smooth final segment — dist to stop5: √((-1.5)²+2²+(-2.5)²)=√(2.25+4+6.25)
//   =√12.5≈3.54 (in-family with the 3.4–5.2 earlier segments → no rushed sweep).
// · Dense, NOT void — inside the cerebrum: r1=(0.5/6.5)²+((2.5-1)/4.5)²+((-4)/5)²
//   =0.006+0.111+0.64=0.757 ≤1 ✓ (upper-back lobe, rich geometry around the frame).
// · ≥2 units from BRAIN_CENTER(-0.5,0.3,0): √(1²+2.2²+(-4)²)=√21.84≈4.67 ✓
//   (no degenerate lookAt; at t=1 f(t) looks at BRAIN_CENTER → whole mass framed).
const stop6 = Object.freeze(new Vector3(0.5, 2.5, -4.0));

export const STOPS: StopConfig[] = [
  { position: stop0, label: "Promessa", slug: "promessa" },
  { position: stop1, label: "Gargalo", slug: "gargalo" },
  { position: stop2, label: "Método", slug: "metodo" },
  { position: stop3, label: "Serviços", slug: "servicos" },
  { position: stop4, label: "Prova", slug: "prova" },
  { position: stop5, label: "Diagnose", slug: "diagnose" },
  { position: stop6, label: "Contato", slug: "contato" },
];

/** Number of stops — derive from STOPS array; never hardcode 5 elsewhere */
export const STOP_COUNT = STOPS.length;
