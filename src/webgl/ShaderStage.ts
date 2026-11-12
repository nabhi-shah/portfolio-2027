import { Renderer, Program, Mesh, Triangle, Vec2, RenderTarget } from 'ogl';
import vertex from '@/shaders/hero.vert';
import weatherFrag from '@/shaders/weather.frag';
import bloomExtractFrag from '@/shaders/bloomExtract.frag';
import bloomBlurFrag from '@/shaders/bloomBlur.frag';
import compositeFrag from '@/shaders/composite.frag';
import type { WeatherState } from '@/config/weather';

export interface ShaderWeatherTarget {
  sunElevation: number;
  cloudCover: number;
  rain: number;
  storm: number;
  snow: number;
  windSpeed: number;
}

export class ShaderStage {
  private container: HTMLElement;
  private renderer: Renderer;
  private geometry: Triangle;

  private sceneProgram: Program;
  private extractProgram: Program;
  private blurProgram: Program;
  private compositeProgram: Program;

  private sceneMesh: Mesh;
  private postMesh: Mesh;

  private sceneTarget!: RenderTarget;
  private bloomTightA!: RenderTarget;
  private bloomTightB!: RenderTarget;
  private bloomWideA!: RenderTarget;
  private bloomWideB!: RenderTarget;

  private rafId = 0;
  private isVisible = true;
  private mouseTarget = new Vec2(0.5, 0.5);
  private mouseCurrent = new Vec2(0.5, 0.5);

  // Smoothly interpolated weather state (defaults to bright clear day like the Paris 29° reference)
  private currentParams: ShaderWeatherTarget = {
    sunElevation: 0.78,
    cloudCover: 0.22,
    rain: 0.0,
    storm: 0.0,
    snow: 0.0,
    windSpeed: 1.0
  };

  private targetParams: ShaderWeatherTarget = { ...this.currentParams };

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio, 1.5),
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance'
    });

    const { gl } = this.renderer;
    this.container.appendChild(gl.canvas);

    this.geometry = new Triangle(gl);
    this.initRenderTargets(window.innerWidth, window.innerHeight);

    this.sceneProgram = new Program(gl, {
      vertex,
      fragment: weatherFrag,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(gl.canvas.width, gl.canvas.height) },
        uMouse: { value: this.mouseCurrent },
        uSunElevation: { value: this.currentParams.sunElevation },
        uCloudCover: { value: this.currentParams.cloudCover },
        uRain: { value: this.currentParams.rain },
        uStorm: { value: this.currentParams.storm },
        uSnow: { value: this.currentParams.snow },
        uWindSpeed: { value: this.currentParams.windSpeed }
      }
    });

    this.extractProgram = new Program(gl, {
      vertex,
      fragment: bloomExtractFrag,
      uniforms: {
        tMap: { value: this.sceneTarget.texture },
        uThreshold: { value: 0.72 },
        uKnee: { value: 0.55 }
      }
    });

    this.blurProgram = new Program(gl, {
      vertex,
      fragment: bloomBlurFrag,
      uniforms: {
        tMap: { value: this.bloomTightA.texture },
        uDirection: { value: new Vec2(1, 0) },
        uTexelSize: { value: new Vec2(1 / 512, 1 / 512) }
      }
    });

    this.compositeProgram = new Program(gl, {
      vertex,
      fragment: compositeFrag,
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tBloomTight: { value: this.bloomTightA.texture },
        tBloomWide: { value: this.bloomWideA.texture },
        uBloomStrength: { value: 0.92 },
        uResolution: { value: new Vec2(gl.canvas.width, gl.canvas.height) },
        uTime: { value: 0 }
      }
    });

    this.sceneMesh = new Mesh(gl, { geometry: this.geometry, program: this.sceneProgram });
    this.postMesh = new Mesh(gl, { geometry: this.geometry, program: this.extractProgram });

    this.onResize();
    this.bindEvents();
    this.rafId = requestAnimationFrame(this.update);
  }

  private initRenderTargets(width: number, height: number): void {
    const { gl } = this.renderer;
    const dpr = this.renderer.dpr;
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));

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
    this.targetParams = {
      sunElevation: state.sunElevation,
      cloudCover: state.cloudCover,
      rain: state.precipitation,
      storm: state.storminess,
      snow: state.snowAmount,
      windSpeed: Math.max(0.35, Math.min(2.4, state.windSpeed / 14))
    };
  }

  public setPreset(preset: ShaderWeatherTarget): void {
    this.targetParams = { ...preset };
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.initRenderTargets(width, height);

    const canvasW = this.renderer.gl.canvas.width;
    const canvasH = this.renderer.gl.canvas.height;
    this.sceneProgram.uniforms.uResolution.value.set(canvasW, canvasH);
    this.compositeProgram.uniforms.uResolution.value.set(canvasW, canvasH);
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.mouseTarget.set(
      e.clientX / window.innerWidth,
      1.0 - e.clientY / window.innerHeight
    );
  };

  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible && !this.rafId) {
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

    // Horizontal pass
    this.blurProgram.uniforms.tMap.value = source.texture;
    this.blurProgram.uniforms.uDirection.value.set(1, 0);
    this.renderer.render({ scene: this.postMesh, target: temp });

    // Vertical pass
    this.blurProgram.uniforms.tMap.value = temp.texture;
    this.blurProgram.uniforms.uDirection.value.set(0, 1);
    this.renderer.render({ scene: this.postMesh, target: dest });
  }

  private update = (t: number): void => {
    if (!this.isVisible) {
      this.rafId = 0;
      return;
    }

    this.rafId = requestAnimationFrame(this.update);

    const timeSec = t * 0.001;

    // Smooth pointer damping
    this.mouseCurrent.x += (this.mouseTarget.x - this.mouseCurrent.x) * 0.05;
    this.mouseCurrent.y += (this.mouseTarget.y - this.mouseCurrent.y) * 0.05;

    // Smooth weather state transitions
    const lerpSpeed = 0.045;
    this.currentParams.sunElevation +=
      (this.targetParams.sunElevation - this.currentParams.sunElevation) * lerpSpeed;
    this.currentParams.cloudCover +=
      (this.targetParams.cloudCover - this.currentParams.cloudCover) * lerpSpeed;
    this.currentParams.rain += (this.targetParams.rain - this.currentParams.rain) * lerpSpeed;
    this.currentParams.storm += (this.targetParams.storm - this.currentParams.storm) * lerpSpeed;
    this.currentParams.snow += (this.targetParams.snow - this.currentParams.snow) * lerpSpeed;
    this.currentParams.windSpeed +=
      (this.targetParams.windSpeed - this.currentParams.windSpeed) * lerpSpeed;

    // Update scene uniforms
    const u = this.sceneProgram.uniforms;
    u.uTime.value = timeSec;
    u.uSunElevation.value = this.currentParams.sunElevation;
    u.uCloudCover.value = this.currentParams.cloudCover;
    u.uRain.value = this.currentParams.rain;
    u.uStorm.value = this.currentParams.storm;
    u.uSnow.value = this.currentParams.snow;
    u.uWindSpeed.value = this.currentParams.windSpeed;

    // 1. Render Volumetric Sky, 3D Clouds & God Rays to offscreen sceneTarget
    this.renderer.render({ scene: this.sceneMesh, target: this.sceneTarget });

    // 2. Extract HDR highlights into Tight & Wide bloom targets
    this.postMesh.program = this.extractProgram;
    this.extractProgram.uniforms.tMap.value = this.sceneTarget.texture;
    this.renderer.render({ scene: this.postMesh, target: this.bloomTightA });
    this.renderer.render({ scene: this.postMesh, target: this.bloomWideA });

    // 3. Separable Gaussian/Kawase Blur passes (Tight + Wide Optical Halo)
    this.runBlurPass(this.bloomTightA, this.bloomTightB, this.bloomTightA, 1.15);
    this.runBlurPass(this.bloomWideA, this.bloomWideB, this.bloomWideA, 1.85);
    this.runBlurPass(this.bloomWideA, this.bloomWideB, this.bloomWideA, 2.65);

    // 4. Final ACES Tone-Mapped + Bloom Composite to screen
    this.postMesh.program = this.compositeProgram;
    this.compositeProgram.uniforms.tScene.value = this.sceneTarget.texture;
    this.compositeProgram.uniforms.tBloomTight.value = this.bloomTightA.texture;
    this.compositeProgram.uniforms.tBloomWide.value = this.bloomWideA.texture;
    this.compositeProgram.uniforms.uTime.value = timeSec;
    this.renderer.render({ scene: this.postMesh });
  };

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.gl.canvas.remove();
  }
}
