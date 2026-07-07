// brain-cloud.frag.glsl
// 35k-particle procedural brain cloud — fragment shader
// Ported 1:1 from vhxco-app.js lines 208-217

varying float vAlpha;
varying vec3 vPos;
uniform float uHue;
uniform float uOpacity;
uniform float uBootProgress;

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  // Balanced alpha to be visible but not over-saturate.
  // Reveal progressively alongside the genesis (was a pop at 0.8-0.9): the
  // atmosphere fades in across the whole formation window so the cloud
  // accompanies the network being born rather than appearing at the last moment.
  float bootAlpha = smoothstep(0.05, 0.7, uBootProgress);
  float alpha = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity * 0.5 * bootAlpha;

  float rim = smoothstep(2.0, 6.0, length(vPos.xy));
  vec3 col = hsl2rgb(vec3(uHue, 0.8, 0.2 + rim * 0.2));
  gl_FragColor = vec4(col, alpha);
}
