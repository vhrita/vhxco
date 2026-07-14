// pulse.frag.glsl
// Traveling synapse pulse — fragment shader
// Ported 1:1 from vhxco-app.js lines 480-488

void main() {
  // Neon red/pink core. HDR multiplier lowered 3.0 -> 1.9: this is what drives
  // the UnrealBloom bleed, so trimming it keeps the "alive" firing but stops the
  // hot red glow from washing off-brand behind the content panels (brand = cyan).
  // Subtle reduction, not a hue change — the genesis look is preserved.
  gl_FragColor = vec4(1.0, 0.3, 0.45, 1.0) * 1.9;
}
