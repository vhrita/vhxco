// soma.frag.glsl
// Neuron cell body — fragment shader with fresnel effect
// Ported 1:1 from vhxco-app.js lines 373-391

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vEnergy;
uniform float uHue;

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);

  // Fresnel effect (glow on edges)
  float fresnel = dot(viewDir, normal);
  fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
  fresnel = pow(fresnel, 2.0);

  // Base soma color (Cyan)
  vec3 baseColor = hsl2rgb(vec3(uHue, 0.9, 0.2 + fresnel * 0.4));

  // Red pulse when firing
  vec3 fireColor = vec3(1.0, 0.2, 0.3) * 5.0; // Bright pink/red
  vec3 col = mix(baseColor, fireColor, vEnergy);

  gl_FragColor = vec4(col, 0.8 + vEnergy * 0.2);
}
