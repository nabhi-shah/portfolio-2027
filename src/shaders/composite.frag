precision highp float;

uniform sampler2D tScene;
uniform sampler2D tBloomWide;
uniform sampler2D tBloomTight;
uniform float uBloomStrength;
uniform vec2 uResolution;
uniform vec2 uSunUv;
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
  vec3 hdr = scene;

  if (uBloomStrength > 0.005) {
    // Subtle chromatic dispersion on the wide bloom halo radiating from the sun
    vec2 caOffset = (vUv - uSunUv) * 0.0035;
    vec3 bloomWide = vec3(
      texture2D(tBloomWide, vUv + caOffset).r,
      texture2D(tBloomWide, vUv).g,
      texture2D(tBloomWide, vUv - caOffset).b
    );

    vec3 bloomTight = texture2D(tBloomTight, vUv).rgb;
    vec3 totalBloom = bloomTight * 0.58 + bloomWide * 0.90;
    hdr += totalBloom * uBloomStrength;
  }

  // Scope HDR core lift strictly around the solar disc so bright clouds never neon-clip
  float aspect = uResolution.x / max(1.0, uResolution.y);
  float sunDist = length((vUv - uSunUv) * vec2(aspect, 1.0));
  float sunScope = smoothstep(0.14, 0.025, sunDist);
  float solarPeak = smoothstep(0.88, 0.99, dot(scene, vec3(0.52, 0.36, 0.12))) * sunScope;
  vec3 warmPeakTint = mix(vec3(1.0), vec3(1.06, 0.94, 0.78), smoothstep(0.05, 0.35, scene.r - scene.b + 0.1));
  hdr += scene * warmPeakTint * (solarPeak * 1.45);

  // Tone-map & subtle saturation lift
  vec3 ldr = acesToneMap(hdr * 0.96);
  float luma = dot(ldr, vec3(0.2126, 0.7152, 0.0722));
  ldr = mix(vec3(luma), ldr, 1.12);

  // Subtle dithering to prevent 8-bit sky gradient banding
  float dither = (hash12(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  ldr += dither;

  gl_FragColor = vec4(ldr, 1.0);
}
