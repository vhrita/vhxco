// brain-cloud.vert.glsl
// 35k-particle procedural brain cloud — vertex shader
// Ported 1:1 from vhxco-app.js lines 196-206

attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
varying vec3 vPos;
uniform float uTime;

void main() {
  vAlpha = aAlpha;
  vPos = position;

  float pulse = sin(uTime * 1.5 + aSeed) * 0.5 + 0.5;
  vAlpha *= (0.6 + pulse * 0.4);

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  // Clamp point size to prevent hardware clipping on Mac/Mobile
  float pSize = (2.5 + pulse) * (250.0 / -mv.z);
  gl_PointSize = clamp(pSize, 1.0, 48.0);
}
