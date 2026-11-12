precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;

// Solar & Sky Time parameters
uniform float uSunElevation;   // -1.0 (midnight) to +1.0 (high noon)
uniform float uSunAzimuth;     // 0.0 (left) to 1.0 (right), default ~0.12

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

varying vec2 vUv;

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

// High-frequency billowy Cumulus FBM for crisp cauliflower cloud domes & wispy fringes
float fbmCumulus(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 6; i++) {
    float n = noise3D(p);
    // Billow transform creates rounded puffy cumulus lobes with crisp creases
    float billow = 1.0 - abs(n * 2.0 - 1.0);
    billow = billow * billow;
    v += a * mix(n, billow, 0.48);
    p = m3 * p * 2.12 + vec3(0.17, -0.11, 0.03 * uTime);
    a *= 0.5;
  }
  return v;
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.04, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

// ---------------------------------------------------------
// Sculpted 3D Volumetric Cumulus Cloud Field
// ---------------------------------------------------------
float mapCloudDensity(vec3 pos, vec2 uv, float aspect) {
  if (uCloudCover <= 0.005 || uCloudDensity <= 0.005) return 0.0;

  float wind = uTime * 0.08 * uWindSpeed;
  // Higher spatial frequency (x5.2) produces detailed, realistic cumulus puffs & scalloped edges
  vec3 q = pos * vec3(5.2, 6.4, 4.5) + vec3(-wind, 0.0, wind * 0.35);

  // Domain warp for organic turbulent wisps around cloud edges
  vec3 warp = vec3(
    noise3D(q * 0.55 + vec3(0.0, 1.7, 0.0)),
    noise3D(q * 0.55 + vec3(3.1, 0.0, 2.2)),
    0.0
  ) * 0.55;

  float n = fbmCumulus(q + warp);

  // Sculpted cloud clusters (matching the One UI upper-right cumulus puff + drifting islands)
  vec2 c1 = vec2(0.80, 0.82); // Hero upper-right cumulus cluster (like Paris screenshot)
  vec2 c2 = vec2(0.52, 0.87); // Upper-center drifting puff
  vec2 c3 = vec2(0.88, 0.56); // Mid-right secondary puff
  vec2 c4 = vec2(0.24, 0.64); // Left-mid wisp

  float d1 = smoothstep(0.42, 0.04, length((uv - c1) * vec2(aspect * 0.78, 1.15)));
  float d2 = smoothstep(0.32, 0.04, length((uv - c2) * vec2(aspect * 0.85, 1.35))) * 0.82;
  float d3 = smoothstep(0.30, 0.04, length((uv - c3) * vec2(aspect * 0.90, 1.30))) * 0.75;
  float d4 = smoothstep(0.28, 0.04, length((uv - c4) * vec2(aspect * 0.95, 1.45))) * 0.65;

  float clusterMask = clamp(max(max(d1, d2), max(d3, d4)), 0.0, 1.0);

  // Broader cloud deck as uCloudCover increases toward Partly Cloudy / Overcast
  float deckMask = smoothstep(0.18, 0.55, uv.y) * smoothstep(0.22, 0.92, uCloudCover);
  float coverage = max(clusterMask * smoothstep(0.0, 0.18, uCloudCover), deckMask);

  // 3D slab vertical profile (rounded cumulus domes, defined base)
  float h = clamp((pos.y + 0.32) / 0.64, 0.0, 1.0);
  float verticalProfile = smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.30, h);

  // Carve crisp cauliflower edges with noise erosion
  float baseShape = coverage * verticalProfile;
  float eroded = smoothstep(0.48 - 0.22 * uCloudCover, 0.72 - 0.12 * uCloudCover, n * (0.45 + 0.75 * baseShape));

  return eroded * uCloudDensity;
}

// ---------------------------------------------------------
// Starfield & Aurora for Evening / Night Sky
// ---------------------------------------------------------
float starField(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0) * 75.0;
  vec2 id = floor(p);
  vec2 gv = fract(p) - 0.5;
  float rnd = hash12(id);
  if (rnd < 0.935) return 0.0;
  vec2 offset = (vec2(fract(rnd * 34.1), fract(rnd * 71.7)) - 0.5) * 0.6;
  float d = length(gv - offset);
  float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + rnd * 60.0);
  float star = smoothstep(0.075, 0.0, d) * twinkle * smoothstep(0.18, 0.9, uv.y);
  return star * (rnd - 0.935) * 16.0;
}

vec3 renderAurora(vec2 uv, float aspect) {
  if (uAurora <= 0.005) return vec3(0.0);
  vec2 p = (uv - vec2(0.5, 0.45)) * vec2(aspect, 1.0);
  float wave1 = sin(p.x * 3.2 + uTime * 0.35 + sin(p.x * 7.0 - uTime * 0.2) * 0.6);
  float wave2 = sin(p.x * 5.1 - uTime * 0.28 + cos(p.x * 4.0 + uTime * 0.15) * 0.8);
  float curtain1 = exp(-abs(uv.y - (0.68 + wave1 * 0.08)) * 9.5);
  float curtain2 = exp(-abs(uv.y - (0.74 + wave2 * 0.07)) * 8.0);
  float rays = 0.55 + 0.45 * sin(p.x * 28.0 + wave1 * 4.0 + uTime * 0.8);
  vec3 col1 = vec3(0.10, 0.95, 0.58) * curtain1 * rays;
  vec3 col2 = vec3(0.52, 0.22, 0.95) * curtain2 * (1.2 - rays * 0.5);
  return (col1 + col2) * smoothstep(0.25, 0.6, uv.y) * uAurora;
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
// Rain & Snow Layers
// ---------------------------------------------------------
float rainStreaks(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0);
  float slant = -0.08 - 0.13 * clamp(uWindSpeed, 0.0, 2.5);
  mat2 rot = mat2(cos(slant), -sin(slant), sin(slant), cos(slant));
  p = rot * p;

  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 24.0 + fi * 16.0;
    float speed = (3.8 - fi * 0.65) * (0.75 + 0.25 * uWindSpeed);
    vec2 st = p * vec2(scale, scale * 0.08);
    st.y += uTime * speed;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    float h = hash12(id + fi * 19.3);
    float densityCutoff = mix(0.89, 0.56, uRain);
    if (h > densityCutoff) {
      float xOff = (fract(h * 13.7) - 0.5) * 0.5;
      float drop = smoothstep(0.042, 0.0, abs(f.x - xOff)) *
                   smoothstep(0.46, -0.2, abs(f.y));
      acc += drop * ((h - densityCutoff) / (1.0 - densityCutoff)) * (1.1 - fi * 0.25);
    }
  }
  return acc;
}

float snowFlakes(vec2 uv, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float scale = 10.0 + fi * 8.0;
    vec2 st = p * scale;
    st.y += uTime * (0.42 - fi * 0.06) * (0.7 + 0.4 * uWindSpeed);
    st.x += uTime * 0.22 * uWindSpeed + sin(uTime * 0.7 + fi * 2.0 + p.y * 3.0) * 0.35;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    float h = hash12(id + fi * 41.0);
    float cutoff = mix(0.86, 0.54, uSnow);
    if (h > cutoff) {
      vec2 center = (vec2(fract(h * 17.3), fract(h * 29.1)) - 0.5) * 0.5;
      float r = length(f - center);
      acc += smoothstep(0.12, 0.01, r) * (0.9 - fi * 0.18);
    }
  }
  return acc;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  vec2 mouseOffset = (uMouse - 0.5) * 0.04;

  // Time-of-day blending weights from uSunElevation (-1..1)
  float dayWeight = smoothstep(-0.08, 0.32, uSunElevation);
  float goldenWeight = exp(-pow((uSunElevation - 0.08) * 3.6, 2.0));
  float blueHourWeight = exp(-pow((uSunElevation + 0.18) * 4.5, 2.0));
  float nightWeight = 1.0 - smoothstep(-0.32, 0.04, uSunElevation);
  float stormWeight = clamp(max(uStorm, (uCloudCover - 0.58) * 1.4 + uRain * 0.35), 0.0, 1.0);

  // ---------------------------------------------------------
  // 1. Multi-Stop Atmospheric Sky Gradient
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

  vec3 nightZenith  = vec3(0.015, 0.03, 0.09);
  vec3 nightUpper   = vec3(0.03, 0.07, 0.18);
  vec3 nightMid     = vec3(0.06, 0.13, 0.28);
  vec3 nightHorizon = vec3(0.10, 0.20, 0.36);
  vec3 nightLower   = vec3(0.03, 0.07, 0.13);

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

  if (nightWeight > 0.01) {
    float stars = starField(uv + mouseOffset * 0.12, aspect) * nightWeight * (1.0 - stormWeight * 0.9) * (1.0 - uFog * 0.8);
    sky += vec3(0.86, 0.93, 1.0) * stars;
  }
  sky += renderAurora(uv, aspect);

  // ---------------------------------------------------------
  // 2. Sun / Moon Position + Diagonal God Rays + Bokeh + Rainbow
  // ---------------------------------------------------------
  float sunY = mix(0.32, 0.88, clamp(abs(uSunElevation), 0.0, 1.0));
  if (uSunElevation < 0.0 && uSunElevation > -0.25) {
    sunY = mix(0.26, 0.45, (uSunElevation + 0.25) / 0.25);
  }
  vec2 sunUv = vec2(
    clamp(uSunAzimuth + mouseOffset.x * 0.4, 0.05, 0.95),
    clamp(sunY + mouseOffset.y * 0.4, 0.18, 0.94)
  );

  sky += renderRainbow(uv, sunUv, aspect);

  vec2 toSun = (uv - sunUv) * vec2(aspect, 1.0);
  float sunDist = length(toSun);

  vec3 sunTint = mix(
    vec3(0.76, 0.86, 1.0),
    mix(vec3(1.0, 0.97, 0.86), vec3(1.0, 0.68, 0.34), goldenWeight),
    dayWeight
  );

  float sunVis = mix(1.0, 0.15, clamp(stormWeight * 0.85 + uFog * 0.55, 0.0, 1.0));

  float sunDisc = smoothstep(0.105, 0.014, sunDist) * 2.25;
  float sunCorona = exp(-sunDist * 6.5) * 0.85 + exp(-sunDist * 2.2) * 0.24;

  float rayAngle = atan(toSun.y, toSun.x);
  float shafts =
    pow(0.5 + 0.5 * sin(rayAngle * 14.0 + uTime * 0.12), 2.0) * 0.45 +
    pow(0.5 + 0.5 * sin(rayAngle * 27.0 - uTime * 0.08 + 1.4), 3.0) * 0.35 +
    pow(0.5 + 0.5 * sin(rayAngle * 7.0 + 0.5), 2.0) * 0.20;

  float downwardCone = smoothstep(0.35, -0.25, toSun.y);
  float rayFalloff = exp(-sunDist * 1.1) * smoothstep(0.02, 0.18, sunDist);
  float diagonalRays = shafts * downwardCone * rayFalloff * 0.78 * uGodRays;

  float bokeh =
    (sunBokehGhost(uv, sunUv, 0.42, 0.055, aspect) * 0.16 +
     sunBokehGhost(uv, sunUv, 0.68, 0.085, aspect) * 0.12 +
     sunBokehGhost(uv, sunUv, 0.95, 0.042, aspect) * 0.14) * clamp(uGodRays, 0.0, 1.5);

  sky += sunTint * (sunDisc + sunCorona + diagonalRays + bokeh) * sunVis * mix(0.35, 1.0, dayWeight);

  // ---------------------------------------------------------
  // 3. 3D Volumetric Raymarched Clouds with Self-Shadowing
  // ---------------------------------------------------------
  vec3 ro = vec3(p.x, p.y, -1.0);
  vec3 rd = normalize(vec3(p.x * 0.28, p.y * 0.28, 1.0));
  vec3 sunDir3D = normalize(vec3((sunUv - uv) * vec2(aspect, 1.0), 0.45));

  float cosTheta = dot(rd, sunDir3D);
  float silverLiningPhase = hgPhase(cosTheta, 0.65);

  vec4 cloudAcc = vec4(0.0);
  const int STEPS = 20;
  float stepLen = 0.048;
  float t = -0.35 + hash12(gl_FragCoord.xy + fract(uTime)) * stepLen;

  for (int i = 0; i < STEPS; i++) {
    if (cloudAcc.a > 0.96) break;
    vec3 pos = ro + rd * t;
    vec2 sampleUv = uv + mouseOffset * (0.22 + float(i) * 0.018);
    float d = mapCloudDensity(pos, sampleUv, aspect);

    if (d > 0.005) {
      vec2 sunStepUv = normalize(sunUv - uv + vec2(0.0001)) * 0.024;
      float dShadow1 = mapCloudDensity(pos + sunDir3D * 0.08, sampleUv + sunStepUv, aspect);
      float dShadow2 = mapCloudDensity(pos + sunDir3D * 0.18, sampleUv + sunStepUv * 2.2, aspect);
      float opticalDepth = (dShadow1 * 1.9 + dShadow2 * 1.5);
      float lightTransmittance = exp(-opticalDepth * 2.8);

      // Powder-sugar scattering for glowing white cumulus rims & sculpted internal folds
      float powder = 1.0 - exp(-d * 5.2);

      // Cool sky-blue ambient shadow inside cloud folds (matching One UI cloud shading)
      vec3 shadowColor = mix(
        vec3(0.42, 0.63, 0.86),
        vec3(0.20, 0.26, 0.36),
        stormWeight
      );
      shadowColor = mix(vec3(0.09, 0.14, 0.25), shadowColor, dayWeight);

      // Brilliant sunlit white crown + forward-scattered silver lining
      vec3 litColor = mix(vec3(0.99, 0.995, 1.0), sunTint, 0.32) * (1.12 + silverLiningPhase * 0.65);

      if (uStorm > 0.15) {
        float flash = pow(max(0.0, sin(uTime * 4.2) * sin(uTime * 12.3 + pos.x * 2.8)), 12.0);
        litColor += vec3(0.75, 0.88, 1.0) * flash * uStorm * 4.2;
      }

      float lightFactor = clamp(lightTransmittance * (0.50 + 0.50 * powder), 0.0, 1.0);
      vec3 voxelColor = mix(shadowColor, litColor, lightFactor);

      float baseAO = smoothstep(-0.32, 0.18, pos.y);
      voxelColor *= (0.80 + 0.20 * baseAO);

      float alpha = (1.0 - exp(-d * 2.6)) * (1.0 - cloudAcc.a);
      cloudAcc.rgb += voxelColor * alpha;
      cloudAcc.a += alpha;
    }
    t += stepLen;
  }

  sky = mix(sky, cloudAcc.rgb / max(cloudAcc.a, 0.0001), cloudAcc.a);

  // ---------------------------------------------------------
  // 4. Volumetric Mist / Fog / Sand Haze Layer
  // ---------------------------------------------------------
  if (uFog > 0.005 || uDust > 0.005) {
    vec3 fogNoisePos = vec3(p.x * 2.2 - uTime * 0.06 * uWindSpeed, p.y * 2.8, uTime * 0.03);
    float fn = fbmCumulus(fogNoisePos);
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
  // 5. Precipitation (Slight Rain -> Heavy Rain, Snow Flurries -> Blizzard)
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
