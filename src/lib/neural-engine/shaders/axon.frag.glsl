// axon.frag.glsl
// Static axon web — fragment shader with edge fade and fibrous texture
// Ported 1:1 from vhxco-app.js lines 442-454

varying float vZ;
varying float vSeed;
varying float vBirth;
uniform float uHue;
uniform float uBootProgress;

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  // Semi-transparent deep cyan, much brighter than before
  vec3 col = hsl2rgb(vec3(uHue, 0.9, 0.25));
  float tex = sin(vZ * 40.0 + vSeed) * 0.5 + 0.5;
  col *= (0.7 + tex * 0.3); // Add subtle fibrous texture

  // Fade at ends so it blends into somas
  float edgeFade = smoothstep(0.0, 0.1, vZ) * smoothstep(1.0, 0.9, vZ);

  // ── Per-edge genesis growth ────────────────────────────────────────────────
  // The line "grows" from the A end (vZ=0) toward the B end (vZ=1) over a short
  // window (GROW_LEN) once uBootProgress crosses this edge's aBirth. Fragments
  // ahead of the growth front are discarded, so the viewer literally watches the
  // connection reach out between two born neurons.
  const float GROW_LEN = 0.06;
  float growth = smoothstep(vBirth, vBirth + GROW_LEN, uBootProgress);
  if (vZ > growth) discard;

  // Bright leading tip: emphasise the growing front so the line reads as
  // actively drawing rather than just fading in.
  float tip = smoothstep(growth - 0.15, growth, vZ);
  col += vec3(0.4, 0.7, 1.0) * tip * (1.0 - smoothstep(0.99, 1.0, growth));

  gl_FragColor = vec4(col, 0.6 * edgeFade);
}
