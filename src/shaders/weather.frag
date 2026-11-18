precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;

// Solar & Sky Time parameters
uniform float uSunElevation;   // -1.0 (midnight) to +1.0 (high noon)
uniform float uSunAzimuth;     // 0.0 (left) to 1.0 (right), default ~0.11

// Cloud & Atmospheric parameters
uniform float uCloudCover;     // 0.0 to 1.0
uniform float uCloudDensity;   // 0.0 to 2.0 (wispy to dense cumulus)
uniform float uGodRays;        // 0.0 to 2.0 (crepuscular ray intensity)
uniform float uFog;            // 0.0 to 1.0 (mist / fog thickness)
uniform float uDust;           // 0.0 to 1.0 (dust / sand haze)

// Precipitation & Phenomena parameters
uniform float uRain;           // 0.0 to 1.0 (slight rain to heavy downpour)
uniform float uSnow;           // 0.0 to 1.0 (flurries to blizzard)
uniform float uStorm;          // 0.0 to 1.0 (darkening + lightning)
uniform float uWindSpeed;      // 0.0 to 3.0
uniform float uRainbow;        // 0.0 to 1.0 (optical rainbow arc)
uniform float uAurora;         // 0.0 to 1.0 (nighttime aurora borealis)
uniform float uLoaderClouds;   // 0.0 (normal) to 1.0 (full-screen loader cloud canopy)

varying vec2 vUv;

// Effective cloud amount used for cloud geometry. Scaled down so every weather state shows
// noticeably fewer clouds than the raw cover value (sky tint / stars still use uCloudCover).
#define CLOUD_AMOUNT (uCloudCover * 0.6)

// ---------------------------------------------------------
// Fast, Cross-Platform Hash & 3D Value Noise
// Guaranteed IEEE 754 float safe on Windows ANGLE / DirectX and macOS Metal
// ---------------------------------------------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Optimized 3D hash that avoids multiple vector allocations
float hash3D(vec3 p) {
  vec3 p3 = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth cubic Hermite interpolation 3D value noise
float noise3D(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash3D(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash3D(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash3D(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash3D(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash3D(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash3D(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash3D(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash3D(i + vec3(1.0, 1.0, 1.0));

  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);

  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);

  return mix(y0, y1, u.z);
}

const mat3 m3 = mat3(
   0.00,  0.80,  0.60,
  -0.80,  0.36, -0.48,
  -0.60, -0.48,  0.64
);

// High-speed 4-octave Billow Cumulus FBM (optimally tuned for 60-120fps)
float fbmCumulusFast(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  // 4 octaves capture full macro cauliflower lobes + micro-wisps with 35% less ALU than 6
  for (int i = 0; i < 4; i++) {
    float n = noise3D(p);
    float billow = 1.0 - abs(n * 2.0 - 1.0);
    v += a * mix(n, billow * billow, 0.48);
    p = m3 * p * 2.15 + vec3(0.17, -0.11, 0.03 * uTime);
    a *= 0.5;
  }
  return v;
}

// 1-octave coarse density lookup for volumetric self-shadow rays
// Light absorption is diffuse, so 1 octave delivers identical visual shadows with 75% less math
float fbmCoarseShadow(vec3 p) {
  float n = noise3D(p);
  float billow = 1.0 - abs(n * 2.0 - 1.0);
  return mix(n, billow * billow, 0.45);
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.04, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

// ---------------------------------------------------------
// Screen-Space 2D Cloud Coverage (Evaluated ONCE per pixel!)
// ---------------------------------------------------------
float computeScreenCoverage(vec2 uv, float aspect) {
  if ((uCloudCover <= 0.005 || uCloudDensity <= 0.005) && uLoaderClouds <= 0.005) return 0.0;

  float normalCov = 0.0;
  if (CLOUD_AMOUNT > 0.005 && uCloudDensity > 0.005) {
    float heavyMix = smoothstep(0.36, 0.58, CLOUD_AMOUNT);
    float drift = uTime * 0.012 * uWindSpeed;
    // Organic undulating base prevents a straight horizontal shelf while keeping clouds in top sky
    float edgeWave =
      (noise3D(vec3(uv.x * 3.6 - drift * 0.4, 1.7, 3.3)) - 0.5) * 0.11 +
      (noise3D(vec3(uv.x * 8.4 + drift * 0.2, 4.1, 7.2)) - 0.5) * 0.04;
    float lowerEdge = mix(0.68, 0.56, heavyMix) + edgeWave * (1.0 - 0.35 * heavyMix);
    float skyBand = smoothstep(lowerEdge, lowerEdge + 0.17, uv.y);

    if (skyBand > 0.005) {
      vec2 sp = (uv - vec2(0.5, 0.88)) * vec2(aspect * 1.65, 2.60) + vec2(3.7 - drift, -0.6);
      // Rotated domain warp + 4-octave breakup creates asymmetrical, irregular scattered cumulus shapes
      vec3 warpSample = m3 * vec3(sp * 2.2 + vec2(3.1, -1.7), 1.9);
      vec2 domainWarp = vec2(
        noise3D(warpSample) - 0.5,
        noise3D(warpSample + vec3(5.2, 1.3, 2.8)) - 0.5
      ) * mix(0.46, 0.18, heavyMix);
      vec3 wp = m3 * vec3((sp + domainWarp) * 1.85, 2.4);
      float clusterField =
        0.50 * noise3D(wp) +
        0.28 * noise3D(m3 * wp * 2.15 + vec3(2.7, -1.9, 1.1)) +
        0.14 * noise3D(wp * 4.4 + vec3(-3.3, 2.1, 0.7)) +
        0.08 * noise3D(m3 * wp * 8.6 + vec3(1.4, 4.2, -2.1));

      float cutoff = mix(0.66, 0.34, clamp(uCloudCover, 0.0, 1.0));
      float scattered = smoothstep(cutoff - 0.08, cutoff + 0.11, clusterField) * smoothstep(0.0, 0.20, uCloudCover);
      float deckMask = smoothstep(0.54, 0.72, uv.y) * smoothstep(0.76, 0.92, uCloudCover);
      normalCov = clamp(max(scattered, deckMask) * skyBand, 0.0, 1.0);
    }
  }

  float loaderOpen = 0.0;
  if (uLoaderClouds > 0.005) {
    vec2 lp = (uv - 0.5) * vec2(aspect, 1.0);
    // Multi-scale fractal cumulus breakup so clouds open and vanish in irregular scattered patches across the sky
    vec3 lq1 = m3 * vec3(lp * 2.1 + vec2(1.4, -0.7), 2.3);
    vec3 lq2 = m3 * vec3(lp * 3.7 + vec2(-2.1, 1.6), 4.1);
    float patchNoise = 0.65 * fbmCumulusFast(lq1) + 0.35 * fbmCumulusFast(lq2);
    float clearT = smoothstep(0.0, 0.94, 1.0 - uLoaderClouds);
    float field = mix(patchNoise, 1.0, smoothstep(0.86, 1.0, uLoaderClouds));
    float threshold = mix(0.14, 0.76, clearT);
    loaderOpen = smoothstep(threshold - 0.13, threshold + 0.13, field);
  }
  return clamp(max(normalCov, loaderOpen), 0.0, 1.0);
}

// Vertical profile of the cloud layer: keeps clouds in the top portion of the sky
// and lowers slightly for thicker overcast decks.
float cloudVerticalProfile(float y) {
  float normalBase = mix(0.22, 0.10, clamp(CLOUD_AMOUNT, 0.0, 1.0));
  float base = mix(normalBase, -0.95, smoothstep(0.0, 0.08, uLoaderClouds));
  return smoothstep(base, base + 0.22, y);
}

// ---------------------------------------------------------
// 3D Density Field Samples
// ---------------------------------------------------------
vec3 getCloudNoiseCoord(vec3 pos) {
  float wind = uTime * 0.08 * uWindSpeed;
  vec3 q = pos * vec3(5.2, 6.4, 1.6) + vec3(-wind, 0.0, wind * 0.35);
  if (uLoaderClouds > 0.005) {
    vec3 qLoader = m3 * (pos * vec3(2.8, 2.6, 1.8) + vec3(-wind * 0.65, 0.12, wind * 0.25));
    q = mix(q, qLoader, smoothstep(0.0, 0.35, uLoaderClouds));
  }
  return q;
}

float sampleCloudDensity(vec3 pos, float coverage) {
  float verticalProfile = cloudVerticalProfile(pos.y);
  if (verticalProfile <= 0.001) return 0.0;

  vec3 q = getCloudNoiseCoord(pos);
  float n = fbmCumulusFast(q);
  float baseShape = coverage * verticalProfile;
  float lowEdge = mix(0.48 - 0.22 * CLOUD_AMOUNT, 0.31, uLoaderClouds);
  float highEdge = mix(0.72 - 0.12 * CLOUD_AMOUNT, 0.74, uLoaderClouds);
  float eroded = smoothstep(lowEdge, highEdge, n * (0.45 + 0.75 * baseShape));

  float densityScale = mix(uCloudDensity, 0.48, uLoaderClouds);
  return eroded * densityScale;
}

float sampleCloudShadowCoarse(vec3 pos, float coverage) {
  float verticalProfile = cloudVerticalProfile(pos.y);
  if (verticalProfile <= 0.001) return 0.0;

  vec3 q = getCloudNoiseCoord(pos);
  float n = fbmCoarseShadow(q);
  if (uLoaderClouds > 0.005) {
    n = mix(n, 0.58 * n + 0.42 * fbmCoarseShadow(m3 * q * 1.9 + vec3(0.17, -0.11, 0.03 * uTime)), uLoaderClouds);
  }
  float baseShape = coverage * verticalProfile;
  float lowEdge = mix(0.50 - 0.20 * CLOUD_AMOUNT, 0.31, uLoaderClouds);
  float highEdge = mix(0.70 - 0.10 * CLOUD_AMOUNT, 0.74, uLoaderClouds);
  float densityScale = mix(uCloudDensity, 0.48, uLoaderClouds);
  return smoothstep(lowEdge, highEdge, n * (0.45 + 0.75 * baseShape)) * densityScale;
}

// ---------------------------------------------------------
// Starfield & Aurora for Evening / Night Sky
// ---------------------------------------------------------
vec3 starLayer(
  vec2 uv,
  float aspect,
  float scale,
  float threshold,
  float size,
  float brightness,
  float sparkleStrength,
  float seed
) {
  vec2 p = uv * vec2(aspect, 1.0) * scale + seed;
  vec2 id = floor(p);
  vec2 gv = fract(p) - 0.5;
  float rnd = hash12(id + seed);
  if (rnd < threshold) return vec3(0.0);

  float mag = (rnd - threshold) / (1.0 - threshold);
  vec2 offset = (vec2(fract(rnd * 34.17), fract(rnd * 71.73)) - 0.5) * 0.40;
  vec2 delta = gv - offset;
  float d = length(delta);

  float twinkle = 0.68 + 0.32 * sin(uTime * (1.8 + fract(rnd * 19.1) * 2.6) + rnd * 62.83);
  float tintRnd = fract(rnd * 113.7);
  vec3 starCol = mix(vec3(0.72, 0.85, 1.0), vec3(1.0, 0.96, 0.88), smoothstep(0.15, 0.75, tintRnd));
  starCol = mix(starCol, vec3(1.0, 0.82, 0.62), smoothstep(0.82, 1.0, tintRnd));

  float edgeMask = smoothstep(0.29, 0.04, d);
  float core = smoothstep(size, 0.0, d);
  float halo = exp(-d / max(size * 1.15, 0.01)) * 0.32 * edgeMask;
  float flare = 0.0;
  if (sparkleStrength > 0.0) {
    float ax = exp(-abs(delta.x) * 52.0) * exp(-abs(delta.y) * 16.0);
    float ay = exp(-abs(delta.y) * 52.0) * exp(-abs(delta.x) * 16.0);
    flare = (ax + ay) * sparkleStrength * edgeMask;
  }

  return starCol * (core + halo + flare) * twinkle * brightness * (0.35 + 0.65 * mag);
}

vec3 renderStars(vec2 uv, float aspect) {
  float horizonMask = smoothstep(0.08, 0.48, uv.y);
  if (horizonMask <= 0.001) return vec3(0.0);

  // Subtle diagonal cosmic dust band
  float bandAxis = (uv.y - 0.24) - (uv.x - 0.5) * 0.45;
  float milkyBand = exp(-bandAxis * bandAxis * 12.0);
  float dustNoise = noise3D(vec3(uv * vec2(aspect, 1.0) * 4.2, 1.7));
  float milkyGlow = milkyBand * smoothstep(0.35, 0.85, dustNoise);
  vec3 cosmicBand = vec3(0.012, 0.022, 0.052) * milkyGlow;

  vec3 l1 = starLayer(uv, aspect, 96.0, 0.915, 0.105, 0.68, 0.0, 11.3);
  vec3 l2 = starLayer(uv, aspect, 56.0, 0.938, 0.098, 1.05, 0.0, 37.9);
  vec3 l3 = starLayer(uv, aspect, 28.0, 0.958, 0.090, 1.55, 0.42, 73.1);

  return (cosmicBand + l1 + l2 + l3) * horizonMask;
}

// Single aurora curtain: a meandering, folding lower edge with a sharp bright-green base,
// vertical ray striations, and a long fade upward through teal into violet/magenta.
vec3 auroraCurtain(vec2 uv, float aspect, float baseY, float height, float seed, float strength) {
  // Fast vertical envelope bailout before trig/noise evaluation
  if (uv.y < baseY - 0.29 || uv.y > baseY + height * 1.8 + 0.19) return vec3(0.0);

  float x = (uv.x - 0.5) * aspect;
  float t = uTime;

  float edge = baseY
    + 0.090 * sin(x * 1.3 + seed + t * 0.06)
    + 0.050 * sin(x * 3.1 - seed * 1.7 - t * 0.11)
    + 0.022 * sin(x * 7.4 + seed * 2.3 + t * 0.23);

  // Ragged lower edge: individual bands end at slightly different heights
  edge -= 0.024 * noise3D(vec3(x * 10.0 + edge * 8.0, seed, t * 0.18));

  float h = uv.y - edge; // height above the lower edge
  if (h < -0.10 || h > height * 1.8) return vec3(0.0);

  // Single smooth vertical envelope: wide, seamless fade below the edge + long fade upward
  float lower = smoothstep(-0.10, 0.06, h);
  float vertical = lower * exp(-max(h, 0.0) / (height * 0.48));

  // Wider vertical bands / rays following the curtain folds
  float rx = x * 14.0 + edge * 8.0;
  float rays = 0.32 + 0.68 * noise3D(vec3(rx, h * 1.6, t * 0.20 + seed));
  rays *= 0.72 + 0.50 * noise3D(vec3(rx * 1.8, h * 2.4, t * 0.34 + seed * 3.0));

  // Large patches along the curtain slowly brighten and dim
  float patches = smoothstep(0.20, 0.80, noise3D(vec3(x * 1.1 + seed, seed, t * 0.05)));

  float intensity = vertical * rays * (0.12 + 0.88 * patches) * strength;

  // Altitude colouring: green (557.7nm oxygen) at the base -> teal -> violet/red at the top
  float a = clamp(h / height, 0.0, 1.0);
  vec3 col = mix(vec3(0.12, 1.0, 0.46), vec3(0.10, 0.78, 0.62), smoothstep(0.15, 0.55, a));
  col = mix(col, vec3(0.55, 0.18, 0.80), smoothstep(0.45, 1.0, a));
  // Faint pink nitrogen fringe hugging the lower edge
  col = mix(col, vec3(0.95, 0.35, 0.65), exp(-max(h, 0.0) * 90.0) * 0.30 * lower);

  return col * intensity;
}

vec3 renderAurora(vec2 uv, float aspect) {
  if (uAurora <= 0.005) return vec3(0.0);
  vec3 c = auroraCurtain(uv, aspect, 0.08, 0.58, 0.0, 1.15);   // main curtain starting from the bottom
  c += auroraCurtain(uv, aspect, 0.28, 0.45, 4.7, 0.55);       // fainter, higher curtain
  return c * uAurora;
}

// ---------------------------------------------------------
// Optical Rainbow Arc
// ---------------------------------------------------------
vec3 renderRainbow(vec2 uv, vec2 sunUv, float aspect) {
  if (uRainbow <= 0.005) return vec3(0.0);
  vec2 center = vec2(1.0 - sunUv.x * 0.65, -0.18);
  float dist = length((uv - center) * vec2(aspect * 0.82, 1.0));
  float t = (dist - 0.68) / 0.065;
  if (t < 0.0 || t > 1.0) return vec3(0.0);
  float env = sin(t * 3.14159265);
  vec3 spectral = 0.5 + 0.5 * cos(6.28318 * (t * 0.82 - vec3(0.0, 0.33, 0.67)));
  return spectral * env * env * smoothstep(0.05, 0.45, uv.y) * 0.42 * uRainbow;
}

// ---------------------------------------------------------
// Lens Bokeh along the Sun Ray Vector
// ---------------------------------------------------------
float sunBokehGhost(vec2 uv, vec2 sunUv, float offsetScale, float radius, float aspect) {
  vec2 center = vec2(0.5, 0.45);
  vec2 axis = center - sunUv;
  vec2 ghostPos = sunUv + axis * offsetScale;
  float d = length((uv - ghostPos) * vec2(aspect, 1.0));
  float disc = smoothstep(radius, radius * 0.65, d);
  float ring = smoothstep(radius * 0.5, radius * 0.95, d) * disc;
  return mix(disc * 0.35, ring, 0.55);
}

// ---------------------------------------------------------
// Optimized Rain & Snow Layers
// ---------------------------------------------------------
float rainStreaks(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0);
  float slant = -0.08 - 0.13 * clamp(uWindSpeed, 0.0, 2.5);
  mat2 rot = mat2(cos(slant), -sin(slant), sin(slant), cos(slant));
  p = rot * p;

  float acc = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float scale = 26.0 + fi * 18.0;
    float speed = (3.8 - fi * 0.75) * (0.75 + 0.25 * uWindSpeed);
    vec2 st = p * vec2(scale, scale * 0.08);
    st.y += uTime * speed;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    float h = hash12(id + fi * 19.3);
    float densityCutoff = mix(0.90, 0.58, uRain);
    if (h > densityCutoff) {
      float xOff = (fract(h * 13.7) - 0.5) * 0.5;
      float drop = smoothstep(0.042, 0.0, abs(f.x - xOff)) *
                   smoothstep(0.46, -0.2, abs(f.y));
      acc += drop * ((h - densityCutoff) / (1.0 - densityCutoff)) * (1.1 - fi * 0.25);
    }
  }
  return acc;
}

// Soft, out-of-focus snowflakes with depth-of-field: 4 parallax layers from small,
// slightly soft distant flakes to large, heavily blurred bokeh flakes close to the lens.
float snowFlakes(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float depth = fi / 3.0;                         // 0 = far, 1 = near
    float scale = mix(24.0, 5.0, depth);            // near flakes are bigger / sparser
    float fall = mix(0.045, 0.16, depth) * (0.7 + 0.4 * uWindSpeed); // screen units / sec (parallax)
    float drift = 0.035 * uWindSpeed * (0.6 + depth);

    vec2 st = p * scale;
    st.y += uTime * fall * scale;
    st.x += uTime * drift * scale;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    float h = hash12(id + fi * 41.0);
    float cutoff = mix(0.90, 0.55, uSnow) + depth * 0.04;

    if (h > cutoff) {
      // Flake center (kept well inside the cell so the soft falloff never gets clipped)
      vec2 c = (vec2(fract(h * 17.3), fract(h * 29.1)) - 0.5) * 0.22;
      c.x += sin(uTime * (0.6 + fract(h * 7.1)) + h * 6.2832) * 0.09; // gentle side-to-side flutter
      vec2 d = f - c;

      float size = mix(0.030, 0.085, depth) * (0.7 + 0.6 * fract(h * 51.3));
      float r2 = dot(d, d) / (size * size);

      // Faint 6-arm crystal structure, washed out by blur (skip trig on extreme near/far layers)
      float crystal = 1.0;
      if (i == 1 || i == 2) {
        float ang = atan(d.y, d.x + 0.00001) + h * 6.2832 + uTime * 0.4 * (fract(h * 3.7) - 0.5);
        float arms = 0.5 + 0.5 * cos(ang * 6.0);
        float armStrength = 0.35 * (1.0 - abs(depth - 0.4) * 1.6);
        crystal += armStrength * (arms - 0.5) * smoothstep(0.1, 0.9, r2);
      }

      // Gaussian blur: near flakes have a wider, dimmer falloff (bokeh)
      float blur = mix(1.6, 0.75, depth);
      float flake = exp(-r2 * blur) * crystal;

      float brightness = mix(0.75, 0.42, depth) * (0.6 + 0.4 * fract(h * 91.7));
      acc += flake * brightness;
    }
  }
  return acc;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  vec2 mouseOffset = (uMouse - 0.5) * 0.04;

  // Time-of-day blending weights derived smoothly from uSunElevation (-1..1)
  float dayWeight = smoothstep(-0.08, 0.32, uSunElevation);
  float goldenWeight = exp(-pow((uSunElevation - 0.08) * 3.6, 2.0));
  float blueHourWeight = exp(-pow((uSunElevation + 0.18) * 4.5, 2.0));
  float nightWeight = 1.0 - smoothstep(-0.32, 0.04, uSunElevation);
  float stormWeight = clamp(max(uStorm, max(uLoaderClouds * 0.65, (uCloudCover - 0.58) * 1.4 + uRain * 0.35)), 0.0, 1.0);

  // ---------------------------------------------------------
  // 1. Multi-Stop Atmospheric Sky Gradient (One UI Paris reference)
  // ---------------------------------------------------------
  vec3 dayZenith  = vec3(0.08, 0.33, 0.75);
  vec3 dayUpper   = vec3(0.19, 0.50, 0.87);
  vec3 dayMid     = vec3(0.40, 0.71, 0.94);
  vec3 dayHorizon = vec3(0.76, 0.90, 0.86);
  vec3 dayLower   = vec3(0.22, 0.42, 0.29);

  vec3 goldZenith  = vec3(0.11, 0.17, 0.44);
  vec3 goldUpper   = vec3(0.36, 0.27, 0.56);
  vec3 goldMid     = vec3(0.78, 0.42, 0.46);
  vec3 goldHorizon = vec3(0.99, 0.65, 0.32);
  vec3 goldLower   = vec3(0.24, 0.19, 0.18);

  vec3 blueZenith  = vec3(0.04, 0.08, 0.24);
  vec3 blueUpper   = vec3(0.08, 0.16, 0.38);
  vec3 blueMid     = vec3(0.16, 0.26, 0.50);
  vec3 blueHorizon = vec3(0.46, 0.36, 0.48);
  vec3 blueLower   = vec3(0.08, 0.12, 0.20);

  vec3 nightZenith  = vec3(0.004, 0.008, 0.026);
  vec3 nightUpper   = vec3(0.009, 0.018, 0.052);
  vec3 nightMid     = vec3(0.018, 0.036, 0.092);
  vec3 nightHorizon = vec3(0.034, 0.064, 0.140);
  vec3 nightLower   = vec3(0.010, 0.020, 0.048);

  vec3 stormZenith  = vec3(0.09, 0.13, 0.21);
  vec3 stormUpper   = vec3(0.14, 0.20, 0.29);
  vec3 stormMid     = vec3(0.21, 0.28, 0.37);
  vec3 stormHorizon = vec3(0.32, 0.39, 0.45);
  vec3 stormLower   = vec3(0.10, 0.15, 0.16);

  vec3 cZenith  = mix(nightZenith, dayZenith, dayWeight);
  vec3 cUpper   = mix(nightUpper, dayUpper, dayWeight);
  vec3 cMid     = mix(nightMid, dayMid, dayWeight);
  vec3 cHorizon = mix(nightHorizon, dayHorizon, dayWeight);
  vec3 cLower   = mix(nightLower, dayLower, dayWeight);

  cZenith  = mix(cZenith, blueZenith, blueHourWeight * 0.85);
  cUpper   = mix(cUpper, blueUpper, blueHourWeight * 0.85);
  cMid     = mix(cMid, blueMid, blueHourWeight * 0.85);
  cHorizon = mix(cHorizon, blueHorizon, blueHourWeight * 0.85);
  cLower   = mix(cLower, blueLower, blueHourWeight * 0.85);

  cZenith  = mix(cZenith, goldZenith, goldenWeight * 0.88);
  cUpper   = mix(cUpper, goldUpper, goldenWeight * 0.88);
  cMid     = mix(cMid, goldMid, goldenWeight * 0.88);
  cHorizon = mix(cHorizon, goldHorizon, goldenWeight * 0.92);
  cLower   = mix(cLower, goldLower, goldenWeight * 0.75);

  cZenith  = mix(cZenith, stormZenith, stormWeight * 0.85);
  cUpper   = mix(cUpper, stormUpper, stormWeight * 0.85);
  cMid     = mix(cMid, stormMid, stormWeight * 0.85);
  cHorizon = mix(cHorizon, stormHorizon, stormWeight * 0.85);
  cLower   = mix(cLower, stormLower, stormWeight * 0.85);

  if (uDust > 0.01) {
    cZenith  = mix(cZenith, vec3(0.52, 0.38, 0.22), uDust * 0.75);
    cUpper   = mix(cUpper, vec3(0.68, 0.49, 0.28), uDust * 0.82);
    cMid     = mix(cMid, vec3(0.80, 0.60, 0.36), uDust * 0.88);
    cHorizon = mix(cHorizon, vec3(0.88, 0.70, 0.46), uDust * 0.92);
  }

  float y = clamp(uv.y + mouseOffset.y * 0.25, 0.0, 1.0);
  vec3 sky = mix(cLower, cHorizon, smoothstep(0.0, 0.28, y));
  sky = mix(sky, cMid, smoothstep(0.24, 0.52, y));
  sky = mix(sky, cUpper, smoothstep(0.48, 0.78, y));
  sky = mix(sky, cZenith, smoothstep(0.72, 1.0, y));
  if (uLoaderClouds > 0.005) {
    sky = mix(sky, mix(stormUpper, stormZenith, 0.45), uLoaderClouds * 0.85);
  }

  // Cloud-layer footprint (screen-space, cheap). Computed up front so stars are hidden behind clouds.
  float coverage = computeScreenCoverage(uv + mouseOffset * 0.25, aspect);

  if (nightWeight > 0.01) {
    // Stars vanish wherever the cloud layer is, and fade out globally as the sky clouds over
    float starCloudMask = (1.0 - smoothstep(0.0, 0.25, coverage)) * (1.0 - smoothstep(0.45, 0.85, uCloudCover));
    vec3 stars = renderStars(uv + mouseOffset * 0.12, aspect) * nightWeight * starCloudMask * (1.0 - stormWeight * 0.92) * (1.0 - uFog * 0.85);
    sky += stars;
  }
  sky += renderAurora(uv, aspect);

  // ---------------------------------------------------------
  // 2. Sun Position + Diagonal God Rays + Bokeh + Rainbow (Daytime / Twilight Only)
  // ---------------------------------------------------------
  float sunY = mix(0.26, 0.88, clamp(uSunElevation, 0.0, 1.0));
  float sunAboveHorizon = smoothstep(-0.06, 0.04, uSunElevation);
  vec2 sunUv = vec2(
    clamp(uSunAzimuth + mouseOffset.x * 0.4, 0.05, 0.95),
    clamp(sunY + mouseOffset.y * 0.4, 0.18, 0.94)
  );

  sky += renderRainbow(uv, sunUv, aspect) * sunAboveHorizon;

  vec2 toSun = (uv - sunUv) * vec2(aspect, 1.0);
  float sunDist = max(0.0001, length(toSun));

  vec3 sunTint = mix(
    vec3(0.76, 0.86, 1.0),
    mix(vec3(1.0, 0.86, 0.56), vec3(1.0, 0.54, 0.18), goldenWeight),
    dayWeight
  );

  float sunVis = mix(1.0, 0.15, clamp(stormWeight * 0.85 + uFog * 0.55, 0.0, 1.0)) * (1.0 - uLoaderClouds * 0.94);

  if (sunVis * sunAboveHorizon > 0.002) {
    vec2 toSun = (uv - sunUv) * vec2(aspect, 1.0);
    float sunDist = max(0.0001, length(toSun));

    // Forward Mie scatter around the sun softly replaces cool blue sky with warm golden-hour amber
    float mieGlow = exp(-sunDist * 4.5) * 0.58 + exp(-sunDist * 1.8) * 0.24;
    vec3 goldenMie = mix(vec3(1.0, 0.58, 0.16), vec3(1.0, 0.38, 0.08), goldenWeight);
    sky = mix(
      sky,
      sky * vec3(0.78, 0.64, 0.40) + goldenMie * 0.62,
      clamp(mieGlow * dayWeight * sunVis * sunAboveHorizon * 1.15, 0.0, 0.85)
    );

    float sunCore = smoothstep(0.044, 0.009, sunDist) * 0.95;
    float sunInnerRing = exp(-sunDist * 11.0) * 0.52;
    float sunCorona = exp(-sunDist * 3.4) * 0.24;

    // Safe angle computation guarded against 0/0 division on Windows ANGLE / DirectX
    float rayAngle = atan(toSun.y, toSun.x + 0.00001);
    float shafts =
      pow(max(0.0, 0.5 + 0.5 * sin(rayAngle * 14.0 + uTime * 0.12)), 2.0) * 0.45 +
      pow(max(0.0, 0.5 + 0.5 * sin(rayAngle * 27.0 - uTime * 0.08 + 1.4)), 3.0) * 0.35 +
      pow(max(0.0, 0.5 + 0.5 * sin(rayAngle * 7.0 + 0.5)), 2.0) * 0.20;

    float downwardCone = smoothstep(0.35, -0.25, toSun.y);
    float rayFalloff = exp(-sunDist * 2.2) * smoothstep(0.025, 0.16, sunDist);
    float diagonalRays = shafts * downwardCone * rayFalloff * 0.44 * uGodRays;

    float bokeh = 0.0;
    if (uGodRays > 0.01) {
      bokeh =
        (sunBokehGhost(uv, sunUv, 0.42, 0.055, aspect) * 0.16 +
         sunBokehGhost(uv, sunUv, 0.68, 0.085, aspect) * 0.12 +
         sunBokehGhost(uv, sunUv, 0.95, 0.042, aspect) * 0.14) * clamp(uGodRays, 0.0, 1.5);
    }

    vec3 coreTint = mix(vec3(0.86, 0.92, 1.0), mix(vec3(1.0, 0.95, 0.80), vec3(1.0, 0.78, 0.42), goldenWeight), dayWeight);
    vec3 ringTint = mix(vec3(0.74, 0.85, 1.0), goldenMie, dayWeight);
    vec3 rayTint = mix(sunTint, goldenMie, 0.45 * dayWeight);
    vec3 solarLight =
      coreTint * sunCore +
      ringTint * (sunInnerRing + sunCorona) +
      rayTint * (diagonalRays + bokeh);

    sky += solarLight * sunVis * sunAboveHorizon;
  }

  // ---------------------------------------------------------
  // 3. Optimized 3D Volumetric Raymarched Clouds with Screen-Space Early Culling
  // ---------------------------------------------------------
  // FAST PATH: If this pixel is in clear sky or below the cloud layer, skip the raymarching loop completely!
  if (coverage > 0.005) {
    vec3 skyBehind = sky; // sky colour at this pixel, used for aerial-perspective blending
    vec3 ro = vec3(p.x, p.y, -1.0);
    vec3 rd = normalize(vec3(p.x * 0.28, p.y * 0.28, 1.0));
    vec3 sunDir3D = normalize(vec3((sunUv - uv) * vec2(aspect, 1.0), 0.45));
    if (uLoaderClouds > 0.005) {
      sunDir3D = normalize(mix(sunDir3D, vec3(-0.35, 0.72, 0.58), uLoaderClouds));
    }

    float cosTheta = dot(rd, sunDir3D);
    float silverLiningPhase = hgPhase(cosTheta, 0.65) * (1.0 - smoothstep(0.0, 0.55, uLoaderClouds) * 0.8);

    vec4 cloudAcc = vec4(0.0);
    // Fixed (non-jittered) start: a per-pixel random offset caused visible flickering grain.
    // Slightly more, shorter steps keep the result free of slicing/banding without the noise.
    const int STEPS = 18;
    float stepLen = 0.048;
    float t = -0.35;

    for (int i = 0; i < STEPS; i++) {
      if (cloudAcc.a > 0.95) break; // Early opacity saturation exit
      vec3 pos = ro + rd * t;
      float d = sampleCloudDensity(pos, coverage);

      if (d > 0.005) {
        // Fast coarse shadow sample (1 octave, 75% cheaper ALU)
        float dShadow1 = sampleCloudShadowCoarse(pos + sunDir3D * 0.10, coverage);
        float dShadow2 = sampleCloudShadowCoarse(pos + sunDir3D * 0.22, coverage);
        float opticalDepth = (dShadow1 * 1.9 + dShadow2 * 1.5);
        float lightTransmittance = exp(-opticalDepth * mix(2.0, 0.85, uLoaderClouds));

        float powder = 1.0 - exp(-d * 5.2);

        // Daytime cloud palette
        vec3 dayShadow = mix(
          vec3(0.64, 0.73, 0.85),
          vec3(0.20, 0.26, 0.36),
          stormWeight
        );
        vec3 dayLitColor = mix(vec3(0.99, 0.995, 1.0), sunTint, 0.32) * (0.94 + silverLiningPhase * 0.56 * sunAboveHorizon);

        // Twilight / night palette derived from the current sky gradient so clouds sit *in* the sky:
        // shadowed sides pick up the mauve/indigo upper sky, lit sides pick up the warm horizon + sun.
        vec3 twShadow = mix(cMid, cUpper, 0.55) * 0.80 + cZenith * 0.08;
        vec3 twLit = mix(cHorizon, sunTint * 1.1, 0.45 * goldenWeight * sunAboveHorizon) *
                     (1.02 + silverLiningPhase * 0.45 * sunAboveHorizon);
        twLit = mix(twLit, mix(cMid, cHorizon, 0.6) * 1.25, nightWeight);

        float dayMix = smoothstep(0.35, 0.95, dayWeight) * (1.0 - goldenWeight * 0.7);
        vec3 shadowColor = mix(twShadow, dayShadow, dayMix);
        vec3 litColor = mix(twLit, dayLitColor, dayMix);
        if (uLoaderClouds > 0.005) {
          shadowColor = mix(shadowColor, vec3(0.08, 0.13, 0.22), uLoaderClouds * 0.88);
          litColor = mix(litColor, vec3(0.32, 0.42, 0.56), uLoaderClouds * 0.88);
        }

        if (uStorm > 0.15) {
          float flash = pow(max(0.0, sin(uTime * 4.2) * sin(uTime * 12.3 + pos.x * 2.8)), 12.0);
          litColor += vec3(0.75, 0.88, 1.0) * flash * uStorm * 4.2;
        }

        float lightFactor = clamp(lightTransmittance * (0.50 + 0.50 * powder), 0.0, 1.0);
        vec3 voxelColor = mix(shadowColor, litColor, lightFactor);
        // Aerial perspective: at twilight/night pull clouds toward the sky behind them so they
        // blend into the gradient instead of looking pasted on (stronger on thin, wispy parts).
        float aerial = (1.0 - dayMix) * mix(0.55, 0.30, powder);
        voxelColor = mix(voxelColor, skyBehind, aerial);

        float normalBaseAO = mix(0.22, 0.10, clamp(CLOUD_AMOUNT, 0.0, 1.0));
        float cloudBase = mix(normalBaseAO, -0.95, smoothstep(0.0, 0.08, uLoaderClouds));
        float baseAO = smoothstep(cloudBase, cloudBase + 0.5, pos.y);
        voxelColor *= (0.80 + 0.20 * baseAO);

        float alpha = (1.0 - exp(-d * 2.6)) * (1.0 - cloudAcc.a);
        cloudAcc.rgb += voxelColor * alpha;
        cloudAcc.a += alpha;
      }
      t += stepLen;
    }

    if (cloudAcc.a > 0.001) {
      sky = mix(sky, cloudAcc.rgb / max(cloudAcc.a, 0.0001), cloudAcc.a);
    }
  }

  // ---------------------------------------------------------
  // 4. Volumetric Mist / Fog / Sand Haze Layer
  // ---------------------------------------------------------
  if (uFog > 0.005 || uDust > 0.005) {
    vec3 fogNoisePos = vec3(p.x * 2.0 - uTime * 0.06 * uWindSpeed, p.y * 2.5, uTime * 0.03);
    float fn = fbmCoarseShadow(fogNoisePos);
    float fogHeight = smoothstep(0.95, 0.05, uv.y - uFog * 0.35);
    float fogMask = clamp((0.55 + 0.45 * fn) * fogHeight * max(uFog, uDust), 0.0, 0.92);
    vec3 fogTint = mix(
      mix(vec3(0.18, 0.24, 0.34), vec3(0.84, 0.89, 0.93), dayWeight),
      vec3(0.84, 0.66, 0.44),
      uDust
    );
    sky = mix(sky, fogTint, fogMask);
  }

  // ---------------------------------------------------------
  // 5. Precipitation (Rain & Snow)
  // ---------------------------------------------------------
  if (uRain > 0.005) {
    float r = rainStreaks(uv, aspect) * uRain;
    sky += mix(vec3(0.68, 0.82, 0.98), sunTint, 0.25) * r * (0.45 + 0.35 * uRain);
  }

  if (uSnow > 0.005) {
    float s = snowFlakes(uv, aspect) * uSnow;
    sky += vec3(0.95, 0.98, 1.0) * s * (0.55 + 0.35 * uSnow);
  }

  gl_FragColor = vec4(sky, 1.0);
}
