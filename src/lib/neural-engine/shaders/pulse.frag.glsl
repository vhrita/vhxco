// pulse.frag.glsl
// Traveling synapse pulse — fragment shader
// Ported 1:1 from vhxco-app.js lines 480-488

void main() {
  // Bright neon red/pink core
  gl_FragColor = vec4(1.0, 0.2, 0.4, 1.0) * 8.0;
}
