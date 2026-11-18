import { Renderer, Program, Mesh, Triangle, Vec2, RenderTarget } from 'ogl';
import vertex from '@/shaders/hero.vert';
import weatherFrag from '@/shaders/weather.frag';
import bloomExtractFrag from '@/shaders/bloomExtract.frag';
import bloomBlurFrag from '@/shaders/bloomBlur.frag';
import compositeFrag from '@/shaders/composite.frag';
import type { WeatherState } from '@/config/weather';

export interface ShaderWeatherTarget {
  sunElevation: number;
  sunAzimuth: number;
  cloudCover: number;
  cloudDensity: number;
  godRays: number;
  fog: number;
  dust: number;
  rain: number;
  snow: number;
  storm: number;
  windSpeed: number;
  rainbow: number;
  aurora: number;
  bloomStrength: number;
}

export const DEFAULT_SHADER_TARGET: ShaderWeatherTarget = {
  sunElevation: 0.85,
  sunAzimuth: 0.11,
  cloudCover: 0.0,
  cloudDensity: 1.0,
  godRays: 1.0,
  fog: 0.0,
  dust: 0.0,
  rain: 0.0,
  snow: 0.0,
  storm: 0.0,
  windSpeed: 1.0,
  rainbow: 0.0,
  aurora: 0.0,
  bloomStrength: 0.92
};

const SHADER_PARAM_KEYS = Object.keys(DEFAULT_SHADER_TARGET) as Array<keyof ShaderWeatherTarget>;

export class ShaderStage {
  private container: HTMLElement;
  private renderer!: Renderer;
  private geometry!: Triangle;

  private sceneProgram!: Program;
  private extractProgram!: Program;
  private blurProgram!: Program;
  private compositeProgram!: Program;

  private sceneMesh!: Mesh;
  private postMesh!: Mesh;

  private sceneTarget!: RenderTarget;
  private bloomTightA!: RenderTarget;
  private bloomTightB!: RenderTarget;
  private bloomWideA!: RenderTarget;
  private bloomWideB!: RenderTarget;

  private rafId = 0;
  private isVisible = true;
  private isContextLost = false;
  private lastShaderTime = 0;
  private fboResizeTimer = 0;
  private lastViewportW = 0;
  private lastViewportH = 0;

  private mouseTarget = new Vec2(0.5, 0.5);
  private mouseCurrent = new Vec2(0.5, 0.5);

  private currentParams: ShaderWeatherTarget = { ...DEFAULT_SHADER_TARGET };
  private targetParams: ShaderWeatherTarget = { ...DEFAULT_SHADER_TARGET };

  private loaderActive = true;
  private loaderClouds = 1.0;
  private loaderCloudsTarget = 1.0;
  private lastFrameTimeMs = 0;

  // Adaptive FPS & Dynamic Resolution Scaling
  private qualityScale = 1.0;
  private frameCount = 0;
  private lastTime = 0;
  private accumulatedTime = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.initWebGL();
    this.bindEvents();
    this.rafId = requestAnimationFrame(this.update);
  }

  private initWebGL(): void {
    // Clamped DPR (max 1.25): balances crisp output with fast compositing
    this.renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio || 1, 1.25),
      alpha: false,
      depth: false,
      antialias: false,
      autoClear: false,
      powerPreference: 'high-performance'
    });

    const { gl } = this.renderer;
    this.container.appendChild(gl.canvas);

    this.geometry = new Triangle(gl);
    this.initRenderTargets(window.innerWidth, window.innerHeight);

    this.sceneProgram = new Program(gl, {
      vertex,
      fragment: weatherFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(gl.canvas.width, gl.canvas.height) },
        uMouse: { value: this.mouseCurrent },
        uSunElevation: { value: this.currentParams.sunElevation },
        uSunAzimuth: { value: this.currentParams.sunAzimuth },
        uCloudCover: { value: this.currentParams.cloudCover },
        uCloudDensity: { value: this.currentParams.cloudDensity },
        uGodRays: { value: this.currentParams.godRays },
        uFog: { value: this.currentParams.fog },
        uDust: { value: this.currentParams.dust },
        uRain: { value: this.currentParams.rain },
        uSnow: { value: this.currentParams.snow },
        uStorm: { value: this.currentParams.storm },
        uWindSpeed: { value: this.currentParams.windSpeed },
        uRainbow: { value: this.currentParams.rainbow },
        uAurora: { value: this.currentParams.aurora },
        uLoaderClouds: { value: this.loaderClouds }
      }
    });

    this.extractProgram = new Program(gl, {
      vertex,
      fragment: bloomExtractFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      uniforms: {
        tMap: { value: this.sceneTarget.texture },
        uThreshold: { value: 0.92 },
        uKnee: { value: 0.45 }
      }
    });

    this.blurProgram = new Program(gl, {
      vertex,
      fragment: bloomBlurFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      uniforms: {
        tMap: { value: this.bloomTightA.texture },
        uDirection: { value: new Vec2(1, 0) },
        uTexelSize: { value: new Vec2(1 / 512, 1 / 512) }
      }
    });

    this.compositeProgram = new Program(gl, {
      vertex,
      fragment: compositeFrag,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tBloomTight: { value: this.bloomTightA.texture },
        tBloomWide: { value: this.bloomWideA.texture },
        uBloomStrength: { value: this.currentParams.bloomStrength },
        uResolution: { value: new Vec2(gl.canvas.width, gl.canvas.height) },
        uSunUv: { value: new Vec2(0.11, 0.787) },
        uTime: { value: 0 }
      }
    });

    this.sceneMesh = new Mesh(gl, { geometry: this.geometry, program: this.sceneProgram });
    this.postMesh = new Mesh(gl, { geometry: this.geometry, program: this.extractProgram });

    this.lastViewportW = 0;
    this.lastViewportH = 0;
    this.syncCanvasSize();
    this.renderPass(0);
  }

  private initRenderTargets(width: number, height: number): void {
    const { gl } = this.renderer;
    // Render volumetric passes at 1.0x CSS DPR max (1536px cap) so Retina/4K displays stay fast while composite upscales cleanly
    const sceneDpr = Math.min(window.devicePixelRatio || 1, 1.0) * this.qualityScale;

    let rawW = Math.max(1, Math.floor(width * sceneDpr));
    let rawH = Math.max(1, Math.floor(height * sceneDpr));
    const maxDim = 1536;
    if (rawW > maxDim || rawH > maxDim) {
      const scale = maxDim / Math.max(rawW, rawH);
      rawW = Math.floor(rawW * scale);
      rawH = Math.floor(rawH * scale);
    }

    const w = rawW;
    const h = rawH;

    const halfW = Math.max(1, Math.floor(w * 0.5));
    const halfH = Math.max(1, Math.floor(h * 0.5));
    const quarterW = Math.max(1, Math.floor(w * 0.25));
    const quarterH = Math.max(1, Math.floor(h * 0.25));

    if (!this.sceneTarget) {
      this.sceneTarget = new RenderTarget(gl, { width: w, height: h, depth: false });
      this.bloomTightA = new RenderTarget(gl, { width: halfW, height: halfH, depth: false });
      this.bloomTightB = new RenderTarget(gl, { width: halfW, height: halfH, depth: false });
      this.bloomWideA = new RenderTarget(gl, { width: quarterW, height: quarterH, depth: false });
      this.bloomWideB = new RenderTarget(gl, { width: quarterW, height: quarterH, depth: false });
    } else {
      this.sceneTarget.setSize(w, h);
      this.bloomTightA.setSize(halfW, halfH);
      this.bloomTightB.setSize(halfW, halfH);
      this.bloomWideA.setSize(quarterW, quarterH);
      this.bloomWideB.setSize(quarterW, quarterH);
    }
  }

  public setWeatherState(state: WeatherState): void {
    const isFog = state.weatherCode === 45 || state.weatherCode === 48;
    this.targetParams = {
      ...this.targetParams,
      sunElevation: state.sunElevation,
      sunAzimuth: Math.max(0.08, Math.min(0.92, state.sunAzimuth)),
      cloudCover: state.cloudCover,
      cloudDensity: 1.0,
      godRays: state.isDay ? 1.0 : 0.0,
      fog: isFog ? 0.65 : 0.0,
      dust: 0.0,
      rain: state.precipitation,
      snow: state.snowAmount,
      storm: state.storminess,
      windSpeed: Math.max(0.35, Math.min(2.4, state.windSpeed / 14)),
      rainbow: 0.0,
      aurora: 0.0
    };
    if (this.loaderActive) {
      this.currentParams = { ...this.targetParams };
    }
  }

  public setPreset(preset: Partial<ShaderWeatherTarget>): void {
    this.targetParams = {
      ...this.targetParams,
      ...preset
    };
    if (this.loaderActive) {
      this.currentParams = { ...this.targetParams };
    }
  }

  public getTargetParams(): ShaderWeatherTarget {
    return { ...this.targetParams };
  }

  public completeLoader(): void {
    this.loaderActive = false;
    this.loaderCloudsTarget = 0.0;
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleWindowResize, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Cross-Platform Context Loss / Restore Handling
    const canvas = this.renderer.gl.canvas;
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.isContextLost = true;
    window.clearTimeout(this.fboResizeTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
  };

  private onContextRestored = (): void => {
    this.isContextLost = false;
    this.initWebGL();
    this.rafId = requestAnimationFrame(this.update);
  };

  private syncCanvasSize = (): void => {
    if (this.isContextLost) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    if (width === this.lastViewportW && height === this.lastViewportH) return;

    this.lastViewportW = width;
    this.lastViewportH = height;
    this.renderer.setSize(width, height);

    const canvasW = this.renderer.gl.canvas.width;
    const canvasH = this.renderer.gl.canvas.height;
    if (this.sceneProgram) {
      this.sceneProgram.uniforms.uResolution.value.set(canvasW, canvasH);
    }
    if (this.compositeProgram) {
      this.compositeProgram.uniforms.uResolution.value.set(canvasW, canvasH);
    }
  };

  private handleWindowResize = (): void => {
    if (this.isContextLost) return;
    this.syncCanvasSize();
    // Redraw immediately after setSize() because resizing a WebGL canvas clears its drawing buffer.
    if (this.isVisible) {
      this.renderPass(this.lastShaderTime);
    }

    window.clearTimeout(this.fboResizeTimer);
    this.fboResizeTimer = window.setTimeout(() => {
      if (this.isContextLost) return;
      this.initRenderTargets(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
      if (this.isVisible) {
        this.renderPass(this.lastShaderTime);
      }
    }, 150);
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.mouseTarget.set(
      e.clientX / window.innerWidth,
      1.0 - e.clientY / window.innerHeight
    );
  };

  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible && !this.rafId && !this.isContextLost) {
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.update);
    }
  };

  private runBlurPass(
    source: RenderTarget,
    temp: RenderTarget,
    dest: RenderTarget,
    radiusScale = 1.0
  ): void {
    this.postMesh.program = this.blurProgram;
    this.blurProgram.uniforms.uTexelSize.value.set(
      radiusScale / source.width,
      radiusScale / source.height
    );

    this.blurProgram.uniforms.tMap.value = source.texture;
    this.blurProgram.uniforms.uDirection.value.set(1, 0);
    this.renderer.render({ scene: this.postMesh, target: temp, clear: false });

    this.blurProgram.uniforms.tMap.value = temp.texture;
    this.blurProgram.uniforms.uDirection.value.set(0, 1);
    this.renderer.render({ scene: this.postMesh, target: dest, clear: false });
  }

  private monitorFramePerformance(now: number): void {
    if (this.lastTime === 0) {
      this.lastTime = now;
      return;
    }
    const delta = now - this.lastTime;
    this.lastTime = now;
    this.accumulatedTime += delta;
    this.frameCount++;

    // Evaluate average FPS every 30 frames (~0.5 seconds)
    if (this.frameCount >= 30) {
      const avgFps = (this.frameCount * 1000) / this.accumulatedTime;
      this.frameCount = 0;
      this.accumulatedTime = 0;

      // Throttle internal volumetric resolution smoothly if frame rate dips below 48fps
      if (avgFps < 48 && this.qualityScale > 0.6) {
        this.qualityScale = Math.max(0.6, this.qualityScale - 0.1);
        this.initRenderTargets(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
      } else if (avgFps >= 57 && this.qualityScale < 1.0) {
        this.qualityScale = Math.min(1.0, this.qualityScale + 0.1);
        this.initRenderTargets(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
      }
    }
  }

  private renderPass(timeSec: number): void {
    this.sceneProgram.uniforms.uTime.value = timeSec;

    // 1. Render Volumetric Sky, 3D Clouds & God Rays to offscreen sceneTarget
    this.renderer.render({ scene: this.sceneMesh, target: this.sceneTarget, clear: false });

    if (this.currentParams.bloomStrength > 0.005) {
      // 2. Single HDR highlight extract pass into tight half-res bloom target
      this.postMesh.program = this.extractProgram;
      this.extractProgram.uniforms.tMap.value = this.sceneTarget.texture;
      this.renderer.render({ scene: this.postMesh, target: this.bloomTightA, clear: false });

      // 3. Tight half-res blur, then downsample + widen directly into quarter-res wide halo
      this.runBlurPass(this.bloomTightA, this.bloomTightB, this.bloomTightA, 1.15);
      this.runBlurPass(this.bloomTightA, this.bloomWideB, this.bloomWideA, 2.05);
    }

    // 4. Final ACES Tone-Mapped + Bloom Composite to screen
    this.postMesh.program = this.compositeProgram;
    this.compositeProgram.uniforms.tScene.value = this.sceneTarget.texture;
    this.compositeProgram.uniforms.tBloomTight.value = this.bloomTightA.texture;
    this.compositeProgram.uniforms.tBloomWide.value = this.bloomWideA.texture;
    this.compositeProgram.uniforms.uTime.value = timeSec;
    this.renderer.render({ scene: this.postMesh, clear: false });
  }

  private update = (t: number): void => {
    if (!this.isVisible || this.isContextLost) {
      this.rafId = 0;
      return;
    }

    this.rafId = requestAnimationFrame(this.update);

    const now = performance.now();
    this.monitorFramePerformance(now);
    const dt = this.lastFrameTimeMs > 0 ? Math.min(0.05, Math.max(0.001, (now - this.lastFrameTimeMs) * 0.001)) : 0.016;
    this.lastFrameTimeMs = now;

    const timeSec = t * 0.001;
    this.lastShaderTime = timeSec;

    // Responsive pointer damping
    this.mouseCurrent.x += (this.mouseTarget.x - this.mouseCurrent.x) * 0.05;
    this.mouseCurrent.y += (this.mouseTarget.y - this.mouseCurrent.y) * 0.05;

    // Smooth uniform state interpolation (zero per-frame key allocations)
    const isClearingLoader = !this.loaderActive && this.loaderClouds > 0.005;
    const loaderLerp = 1.0 - Math.exp(-1.85 * dt);
    const lerp = isClearingLoader ? loaderLerp : 0.06;
    for (let i = 0; i < SHADER_PARAM_KEYS.length; i++) {
      const k = SHADER_PARAM_KEYS[i];
      const diff = this.targetParams[k] - this.currentParams[k];
      if (Math.abs(diff) > 0.0002) {
        this.currentParams[k] += diff * lerp;
      } else {
        this.currentParams[k] = this.targetParams[k];
      }
    }

    if (!this.loaderActive) {
      this.loaderClouds += (this.loaderCloudsTarget - this.loaderClouds) * loaderLerp;
      if (this.loaderClouds < 0.001) this.loaderClouds = 0.0;
    }

    const u = this.sceneProgram.uniforms;
    u.uSunElevation.value = this.currentParams.sunElevation;
    u.uSunAzimuth.value = this.currentParams.sunAzimuth;
    u.uCloudCover.value = this.currentParams.cloudCover;
    u.uCloudDensity.value = this.currentParams.cloudDensity;
    u.uGodRays.value = this.currentParams.godRays;
    u.uFog.value = this.currentParams.fog;
    u.uDust.value = this.currentParams.dust;
    u.uRain.value = this.currentParams.rain;
    u.uSnow.value = this.currentParams.snow;
    u.uStorm.value = this.currentParams.storm;
    u.uWindSpeed.value = this.currentParams.windSpeed;
    u.uRainbow.value = this.currentParams.rainbow;
    u.uAurora.value = this.currentParams.aurora;
    u.uLoaderClouds.value = this.loaderClouds;

    this.compositeProgram.uniforms.uBloomStrength.value = this.currentParams.bloomStrength;
    const sunY = 0.26 + 0.62 * Math.max(0, Math.min(1, this.currentParams.sunElevation));
    const sunUx = Math.max(0.05, Math.min(0.95, this.currentParams.sunAzimuth + (this.mouseCurrent.x - 0.5) * 0.016));
    const sunUy = Math.max(0.18, Math.min(0.94, sunY + (this.mouseCurrent.y - 0.5) * 0.016));
    this.compositeProgram.uniforms.uSunUv.value.set(sunUx, sunUy);

    this.renderPass(timeSec);
  };

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.fboResizeTimer);
    window.removeEventListener('resize', this.handleWindowResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    const canvas = this.renderer.gl.canvas;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    canvas.remove();
  }
}
