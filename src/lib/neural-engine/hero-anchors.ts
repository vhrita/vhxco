// hero-anchors.ts
// Hero neuron indices — the 4 neurons used as camera anchors for phases 2-5.
// These are the "spine" of the scrollytelling extraction effect.
//
// Ported from vhxco-app.js lines 258-263:
//   window.heroNeurons = [neurons[15], neurons[50], neurons[85], neurons[150]]
//
// R2 (sketch audit): hard-coded magic numbers extracted as named constant to
// prevent silent breakage if MAX_NEURONS changes.

export const HERO_NEURON_INDICES = [15, 50, 85, 150] as const;
export type HeroNeuronIndices = typeof HERO_NEURON_INDICES;
