precision highp float;

uniform sampler2D tScene;
uniform sampler2D tBloomWide;
uniform sampler2D tBloomTight;
uniform float uBloomStrength;
uniform vec2 uResolution;
uniform float uTime;

varying vec2 vUv;

// ACES Filmic Tone Mapping Curve
vec3 acesToneMap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 scene = texture2D(tScene, vUv).rgb;

  // Subtle chromatic dispersion on the wide bloom halo for optical lens realism
  vec2 caOffset = (vUv - vec2(0.15, 0.82)) * 0.0035;
  vec3 bloomWide;
  bloomWide.r = texture2D(tBloomWide, vUv + caOffset).r;
  bloomWide.g = texture2D(tBloomWide, vUv).g;
  bloomWide.b = texture2D(tBloomWide, vUv - caOffset).b;

  vec3 bloomTight = texture2D(tBloomTight, vUv).rgb;
  vec3 totalBloom = bloomTight * 0.55 + bloomWide * 0.85;

  vec3 hdr = scene + totalBloom * uBloomStrength;

  // Tone-map & subtle saturation lift
  vec3 ldr = acesToneMap(hdr * 0.94);
  float luma = dot(ldr, vec3(0.2126, 0.7152, 0.0722));
  ldr = mix(vec3(luma), ldr, 1.12);

  // Subtle dithering to prevent 8-bit sky gradient banding
  float dither = (hash12(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  ldr += dither;

  gl_FragColor = vec4(ldr, 1.0);
}
