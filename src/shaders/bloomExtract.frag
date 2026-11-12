precision highp float;

uniform sampler2D tMap;
uniform float uThreshold;
uniform float uKnee;

varying vec2 vUv;

void main() {
  vec3 col = texture2D(tMap, vUv).rgb;
  float brightness = max(col.r, max(col.g, col.b));

  // Soft-knee threshold curve for silky HDR bloom
  float knee = uThreshold * uKnee + 0.0001;
  float soft = brightness - uThreshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = (soft * soft) / (4.0 * knee);

  float contribution = max(soft, brightness - uThreshold) / max(brightness, 0.0001);
  gl_FragColor = vec4(col * contribution, 1.0);
}
