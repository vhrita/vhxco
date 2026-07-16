// axon.vert.glsl
// Static axon web (cylindrical tubes connecting somas) — vertex shader
// Ported 1:1 from vhxco-app.js lines 425-440

attribute float aSeed;
attribute float aBirth;
varying float vZ;
varying float vSeed;
varying float vBirth;
uniform float uTime;

void main() {
  vZ = position.z;
  vSeed = aSeed;
  vBirth = aBirth;
  vec3 pos = position;

  // Static wavy distortion to look like organic tubes
  float waveX = sin(pos.z * 15.0 + aSeed) * 0.05;
  float waveY = cos(pos.z * 12.0 + aSeed * 2.0) * 0.05;

  // Thin out the middle slightly
  float thickness = 1.0 - sin(pos.z * 3.1415) * 0.4;
  pos.x = pos.x * thickness + waveX;
  pos.y = pos.y * thickness + waveY;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
