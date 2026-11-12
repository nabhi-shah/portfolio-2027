precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uSunElevation;   // -1.0 (midnight) to +1.0 (high noon)
uniform float uCloudCover;     // 0.0 to 1.0
uniform float uRain;           // 0.0 to 1.0
uniform float uStorm;          // 0.0 to 1.0
uniform float uSnow;           // 0.0 to 1.0
uniform float uWindSpeed;      // normalized 0.2 to 2.5

varying vec2 vUv;

// ---------------------------------------------------------
// Fast, high-quality 2D & 3D procedural noise
// ---------------------------------------------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise3D(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
      mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x),
      f.y
    ),
    mix(
      mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
      mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x),
      f.y
    ),
    f.z
  );
}

const mat3 m3 = mat3(
   0.00,  0.80,  0.60,
  -0.80,  0.36, -0.48,
  -0.60, -0.48,  0.64
);

// Billowy cumulus 3D FBM (mixes smooth + puffy billow octaves)
float cloudFBM(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 5; i++) {
    float n = noise3D(p);
    // Blend standard noise with billowy ridge for fluffy cumulus edges
    float billow = 1.0 - abs(n * 2.0 - 1.0);
    v += a * mix(n, billow * billow, 0.38);
    p = m3 * p * 2.07 + vec3(0.0, 0.0, uTime * 0.04);
    a *= 0.5;
  }
  return v;
}

// Henyey-Greenstein phase function for forward-scattered silver linings
float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

// ---------------------------------------------------------
// 3D Cloud Density Field
// ---------------------------------------------------------
float sampleCloudDensity(vec3 pos, vec2 screenUv) {
  float wind = uTime * (0.09 * uWindSpeed);
  vec3 p = pos * vec3(1.15, 1.55, 1.15) + vec3(-wind, 0.0, wind * 0.45);

  float baseNoise = cloudFBM(p);

  // In clear/fair weather (like the One UI Paris reference), concentrate a
  // sculptural cumulus cloud bank in the upper-right sky & soft wisps elsewhere.
  vec2 rightClusterCenter = vec2(0.76, 0.80);
  float rightClusterDist = length((screenUv - rightClusterCenter) * vec2(1.0, 1.35));
  float heroClusterMask = smoothstep(0.62, 0.06, rightClusterDist);

  // Secondary drifting cloud bank mask
  float skyBandMask = smoothstep(0.18, 0.68, screenUv.y);
  float coverageMask = mix(
    heroClusterMask * 0.88 + skyBandMask * 0.35,
    skyBandMask * 0.95 + 0.25,
    smoothstep(0.2, 0.85, uCloudCover)
  );

  // Height profile within the 3D slab (rounded tops, flatter bottoms)
  float h = clamp((pos.y + 0.6) / 1.2, 0.0, 1.0);
  float heightProfile = smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.45, h);

  float threshold = mix(0.60, 0.32, clamp(uCloudCover * 0.85 + heroClusterMask * 0.42, 0.0, 1.0));
  float d = smoothstep(threshold, threshold + 0.28, baseNoise * coverageMask) * heightProfile;
  return d;
}

// ---------------------------------------------------------
// Starfield for Night Sky
// ---------------------------------------------------------
float starField(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0) * 65.0;
  vec2 id = floor(p);
  vec2 gv = fract(p) - 0.5;
  float rnd = hash12(id);
  if (rnd < 0.93) return 0.0;
  vec2 offset = (vec2(fract(rnd * 34.1), fract(rnd * 71.7)) - 0.5) * 0.6;
  float d = length(gv - offset);
  float twinkle = 0.65 + 0.35 * sin(uTime * 2.8 + rnd * 60.0);
  float star = smoothstep(0.08, 0.0, d) * twinkle * smoothstep(0.25, 0.85, uv.y);
  return star * (rnd - 0.93) * 14.0;
}

// ---------------------------------------------------------
// Refractive Rain & Snow Layers
// ---------------------------------------------------------
float rainStreaks(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0);
  // Slanted wind angle
  float angle = -0.22;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  p = rot * p;

  float acc = 0.0;
  for (int i = 0; i < 2; i++) {
    float scale = (i == 0) ? 28.0 : 46.0;
    float speed = (i == 0) ? 3.4 : 2.3;
    vec2 st = p * vec2(scale, scale * 0.09);
    st.y += uTime * speed;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    float h = hash12(id + float(i) * 19.3);
    if (h > 0.72) {
      float xOff = (fract(h * 13.7) - 0.5) * 0.5;
      float drop = smoothstep(0.045, 0.0, abs(f.x - xOff)) *
                   smoothstep(0.45, -0.2, abs(f.y));
      acc += drop * (h - 0.72) * 3.2;
    }
  }
  return acc;
}

float snowFlakes(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 12.0 + fi * 9.0;
    vec2 st = p * scale;
    st.y += uTime * (0.45 - fi * 0.08);
    st.x += sin(uTime * 0.6 + fi * 2.0 + p.y * 3.0) * 0.35;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    float h = hash12(id + fi * 41.0);
    if (h > 0.76) {
      vec2 center = (vec2(fract(h * 17.3), fract(h * 29.1)) - 0.5) * 0.5;
      float r = length(f - center);
      acc += smoothstep(0.12, 0.01, r) * (0.85 - fi * 0.2);
    }
  }
  return acc;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // Subtle interactive parallax from cursor
  vec2 mouseOffset = (uMouse - 0.5) * 0.055;

  // Day/Night & Golden-Hour weights derived from uSunElevation (-1..1)
  float dayWeight = smoothstep(-0.08, 0.28, uSunElevation);
  float goldenWeight = exp(-pow((uSunElevation - 0.12) * 3.6, 2.0));
  float nightWeight = 1.0 - smoothstep(-0.25, 0.06, uSunElevation);
  float overcastWeight = smoothstep(0.35, 0.92, max(uCloudCover, uStorm * 0.9));

  // ---------------------------------------------------------
  // 1. One UI Inspired Multi-Stop Atmospheric Sky Gradient
  // ---------------------------------------------------------
  // Clear Day Palette (Paris 29° reference: cobalt zenith -> cerulean mid -> warm mint-gold horizon)
  vec3 dayZenith  = vec3(0.11, 0.39, 0.79);
  vec3 dayMid     = vec3(0.39, 0.69, 0.95);
  vec3 dayHorizon = vec3(0.83, 0.93, 0.87);
  vec3 dayGround  = vec3(0.24, 0.44, 0.28);

  // Golden Hour Palette
  vec3 goldZenith  = vec3(0.14, 0.20, 0.48);
  vec3 goldMid     = vec3(0.68, 0.41, 0.54);
  vec3 goldHorizon = vec3(0.99, 0.67, 0.38);
  vec3 goldGround  = vec3(0.26, 0.22, 0.20);

  // Night Palette
  vec3 nightZenith  = vec3(0.02, 0.04, 0.11);
  vec3 nightMid     = vec3(0.05, 0.11, 0.25);
  vec3 nightHorizon = vec3(0.11, 0.21, 0.38);
  vec3 nightGround  = vec3(0.04, 0.08, 0.14);

  // Storm / Overcast Palette
  vec3 stormZenith  = vec3(0.12, 0.17, 0.26);
  vec3 stormMid     = vec3(0.24, 0.32, 0.42);
  vec3 stormHorizon = vec3(0.42, 0.50, 0.56);
  vec3 stormGround  = vec3(0.14, 0.20, 0.19);

  // Blend palettes smoothly
  vec3 zenithCol  = mix(nightZenith, dayZenith, dayWeight);
  vec3 midCol     = mix(nightMid, dayMid, dayWeight);
  vec3 horizonCol = mix(nightHorizon, dayHorizon, dayWeight);
  vec3 groundCol  = mix(nightGround, dayGround, dayWeight);

  zenithCol  = mix(zenithCol, goldZenith, goldenWeight * 0.85);
  midCol     = mix(midCol, goldMid, goldenWeight * 0.85);
  horizonCol = mix(horizonCol, goldHorizon, goldenWeight * 0.92);
  groundCol  = mix(groundCol, goldGround, goldenWeight * 0.65);

  zenithCol  = mix(zenithCol, stormZenith, overcastWeight * 0.78);
  midCol     = mix(midCol, stormMid, overcastWeight * 0.78);
  horizonCol = mix(horizonCol, stormHorizon, overcastWeight * 0.78);
  groundCol  = mix(groundCol, stormGround, overcastWeight * 0.78);

  // Vertical gradient curve matching the One UI atmospheric horizon glow
  float y = clamp(uv.y + mouseOffset.y * 0.4, 0.0, 1.0);
  vec3 sky = mix(groundCol, horizonCol, smoothstep(0.0, 0.34, y));
  sky = mix(sky, midCol, smoothstep(0.30, 0.68, y));
  sky = mix(sky, zenithCol, smoothstep(0.62, 1.0, y));

  // Stars at night
  if (nightWeight > 0.02) {
    float stars = starField(uv + mouseOffset * 0.2, aspect) * nightWeight * (1.0 - overcastWeight * 0.9);
    sky += vec3(0.85, 0.92, 1.0) * stars;
  }

  // ---------------------------------------------------------
  // 2. Sun / Moon Position & Atmospheric Mie Scattering
  // ---------------------------------------------------------
  // Positioned in the upper-left like the One UI Paris reference, shifting slightly with elevation
  vec2 sunUv = vec2(
    0.13 + mouseOffset.x * 0.6,
    mix(0.72, 0.84, clamp(uSunElevation, 0.0, 1.0)) + mouseOffset.y * 0.6
  );
  vec2 toSun = (uv - sunUv) * vec2(aspect, 1.0);
  float sunDist = length(toSun);

  vec3 sunTint = mix(
    vec3(0.72, 0.84, 1.0), // Moonlight tint
    mix(vec3(1.0, 0.96, 0.86), vec3(1.0, 0.70, 0.38), goldenWeight),
    dayWeight
  );

  float sunVisibility = mix(1.0, 0.22, overcastWeight);

  // Intense HDR sun core + soft atmospheric Mie scattering halo
  float sunCore = exp(-sunDist * 14.0) * 2.6 + exp(-sunDist * 42.0) * 3.8;
  float sunHalo = exp(-sunDist * 2.6) * 0.65 + exp(-sunDist * 0.95) * 0.28;
  sky += sunTint * (sunCore + sunHalo) * sunVisibility * mix(0.35, 1.0, dayWeight);

  // ---------------------------------------------------------
  // 3. 3D Volumetric Raymarched Clouds with Silver Lining
  // ---------------------------------------------------------
  vec3 ro = vec3(p.x, p.y, -1.2);
  vec3 rd = normalize(vec3(p.x * 0.35, p.y * 0.35 + 0.08, 1.0));
  vec3 sunDir3D = normalize(vec3((sunUv - 0.5) * vec2(aspect, 1.0), 0.35));

  float cosAngle = dot(rd, sunDir3D);
  // Forward scattering (silver-lining around sun) + back scattering
  float phase = mix(hgPhase(cosAngle, 0.58), hgPhase(cosAngle, -0.25), 0.25);

  vec4 cloudAccum = vec4(0.0);
  const int STEPS = 18;
  float t = 0.0;
  float stepSize = 0.095;

  // Blue-noise jitter to eliminate slice banding
  float jitter = hash12(gl_FragCoord.xy + fract(uTime));
  t += jitter * stepSize;

  for (int i = 0; i < STEPS; i++) {
    if (cloudAccum.a > 0.97) break;
    vec3 pos = ro + rd * t;
    vec2 sampleUv = uv + mouseOffset * (0.4 + float(i) * 0.04);
    float dens = sampleCloudDensity(pos, sampleUv);

    if (dens > 0.004) {
      // Sample density towards the sun for volumetric self-shadowing
      float shadowDens = sampleCloudDensity(pos + sunDir3D * 0.16, sampleUv + normalize(sunUv - uv) * 0.035);
      float transmittance = exp(-shadowDens * 3.4);
      // Powder effect makes puffed cloud edges catch extra light
      float powder = 1.0 - exp(-dens * 3.2);

      // Cloud base ambient vs. sunlit top
      vec3 cloudAmbient = mix(zenithCol * 0.85 + vec3(0.18, 0.24, 0.34), horizonCol * 0.95, clamp(pos.y + 0.5, 0.0, 1.0));
      cloudAmbient = mix(cloudAmbient, vec3(0.22, 0.27, 0.35), overcastWeight * 0.7);

      vec3 cloudSunLight = sunTint * (1.35 + phase * 1.45) * mix(0.25, 1.0, dayWeight);

      // Sheet lightning internal flash during storms
      float lightningFlash = 0.0;
      if (uStorm > 0.25) {
        float flashWave = pow(max(0.0, sin(uTime * 3.7) * sin(uTime * 11.3 + pos.x * 2.0)), 14.0);
        lightningFlash = flashWave * uStorm * 3.5;
      }

      vec3 cCol = mix(cloudAmbient * 0.72, vec3(0.98, 0.99, 1.0) * cloudSunLight, transmittance * (0.55 + 0.45 * powder));
      cCol += vec3(0.75, 0.85, 1.0) * lightningFlash * (1.0 - transmittance);

      float alpha = (1.0 - exp(-dens * 1.65)) * (1.0 - cloudAccum.a);
      cloudAccum.rgb += cCol * alpha;
      cloudAccum.a += alpha;
    }
    t += stepSize;
  }

  // Composite volumetric 3D clouds over sky
  sky = mix(sky, cloudAccum.rgb / max(cloudAccum.a, 0.0001), cloudAccum.a);

  // ---------------------------------------------------------
  // 4. Diagonal Volumetric Crepuscular God Rays & Lens Flare
  //    (Matching the One UI Paris reference diagonal sunbeams)
  // ---------------------------------------------------------
  vec2 deltaToSun = (sunUv - uv);
  float radialDist = length(deltaToSun * vec2(aspect, 1.0));
  float angleToSun = atan(deltaToSun.y, deltaToSun.x * aspect);

  // Animated angular light shafts
  float beamNoise =
    sin(angleToSun * 11.0 + uTime * 0.18) * 0.45 +
    sin(angleToSun * 23.0 - uTime * 0.12) * 0.30 +
    sin(angleToSun * 5.0 + 1.2) * 0.25;
  beamNoise = smoothstep(-0.35, 0.85, beamNoise);

  // Radial occlusion march toward the sun so clouds cast real shadow shafts!
  float shaftOcclusion = 0.0;
  vec2 marchUv = uv;
  vec2 stepUv = deltaToSun / 10.0;
  for (int s = 0; s < 10; s++) {
    marchUv += stepUv;
    vec3 checkPos = vec3((marchUv - 0.5) * vec2(aspect, 1.0), -0.7);
    float cDens = sampleCloudDensity(checkPos, marchUv);
    shaftOcclusion += (1.0 - clamp(cDens * 1.6, 0.0, 1.0));
  }
  shaftOcclusion /= 10.0;

  // Focus the god-rays diagonally across the sky (top-left toward center/right)
  float radialFalloff = exp(-radialDist * 1.15) * smoothstep(1.85, 0.05, radialDist);
  float godRays = (0.42 + 0.58 * beamNoise) * shaftOcclusion * radialFalloff;

  // Subtle diagonal bokeh flare discs along the sun axis (like the One UI sunbeams)
  vec2 sunAxis = normalize(vec2(0.75 * aspect, -0.52));
  vec2 relSun = (uv - sunUv) * vec2(aspect, 1.0);
  float proj = dot(relSun, sunAxis);
  float perp = length(relSun - sunAxis * proj);
  float diagonalShaft = exp(-perp * 4.2) * smoothstep(-0.1, 1.35, proj) * exp(-proj * 1.1);

  float totalRayIntensity = (godRays * 0.55 + diagonalShaft * 0.45) * sunVisibility * mix(0.18, 1.0, dayWeight);
  sky += sunTint * totalRayIntensity * 0.85;

  // ---------------------------------------------------------
  // 5. Weather Precipitation (Rain / Snow)
  // ---------------------------------------------------------
  if (uRain > 0.01) {
    float r = rainStreaks(uv, aspect) * uRain;
    sky += mix(vec3(0.65, 0.78, 0.95), sunTint, 0.3) * r * 0.55;
  }

  if (uSnow > 0.01) {
    float s = snowFlakes(uv, aspect) * uSnow;
    sky += vec3(0.95, 0.98, 1.0) * s * 0.75;
  }

  // Subtle lower-screen atmospheric mist cushion so One UI glass cards pop with depth
  float bottomGlow = smoothstep(0.42, 0.0, uv.y);
  sky = mix(sky, horizonCol * 0.68 + groundCol * 0.32, bottomGlow * 0.28);

  gl_FragColor = vec4(sky, 1.0);
}
