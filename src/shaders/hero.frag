precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uScroll;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rot * p * 2.02 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 st = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
  vec2 mouse = (uMouse - 0.5) * vec2(uResolution.x / min(uResolution.x, uResolution.y), 1.0);

  float dist = length(st - mouse * 0.65);
  float interaction = smoothstep(0.9, 0.0, dist);

  vec2 q = vec2(0.0);
  q.x = fbm(st + 0.08 * uTime);
  q.y = fbm(st + vec2(1.0));

  vec2 r = vec2(0.0);
  r.x = fbm(st + 1.2 * q + vec2(1.7, 9.2) + 0.14 * uTime + mouse * 0.25);
  r.y = fbm(st + 1.2 * q + vec2(8.3, 2.8) + 0.11 * uTime - uScroll * 0.4);

  float f = fbm(st + r + interaction * 0.25);

  vec3 baseDark = vec3(0.03, 0.035, 0.05);
  vec3 accentA = vec3(0.16, 0.22, 0.38);
  vec3 accentB = vec3(0.78, 0.82, 0.94);

  vec3 col = mix(baseDark, accentA, clamp((f * f) * 2.5, 0.0, 1.0));
  col = mix(col, accentB, clamp(length(q) * 0.45 * f, 0.0, 1.0));
  col += interaction * 0.07 * vec3(0.6, 0.72, 1.0);

  // Subtle film grain
  float grain = (hash(vUv * uResolution + fract(uTime)) - 0.5) * 0.025;
  col += grain;

  gl_FragColor = vec4(col, 1.0);
}
