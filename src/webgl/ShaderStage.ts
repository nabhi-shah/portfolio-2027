import { Renderer, Program, Mesh, Triangle, Vec2 } from 'ogl';
import vertex from '@/shaders/hero.vert';
import fragment from '@/shaders/hero.frag';

export class ShaderStage {
  private container: HTMLElement;
  private renderer: Renderer;
  private program: Program;
  private mesh: Mesh;
  private rafId = 0;
  private isVisible = true;
  private mouseTarget = new Vec2(0.5, 0.5);
  private mouseCurrent = new Vec2(0.5, 0.5);
  private scrollY = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio, 1.75),
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance'
    });

    const { gl } = this.renderer;
    this.container.appendChild(gl.canvas);

    // Full-screen triangle is faster than a 2-triangle quad (no diagonal seam / overshading)
    const geometry = new Triangle(gl);

    this.program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(gl.canvas.width, gl.canvas.height) },
        uMouse: { value: this.mouseCurrent },
        uScroll: { value: 0 }
      }
    });

    this.mesh = new Mesh(gl, { geometry, program: this.program });

    this.onResize();
    this.bindEvents();
    this.rafId = requestAnimationFrame(this.update);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.program.uniforms.uResolution.value.set(
      this.renderer.gl.canvas.width,
      this.renderer.gl.canvas.height
    );
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.mouseTarget.set(
      e.clientX / window.innerWidth,
      1.0 - e.clientY / window.innerHeight
    );
  };

  private onScroll = (): void => {
    this.scrollY = window.scrollY / Math.max(window.innerHeight, 1);
  };

  private onVisibilityChange = (): void => {
    this.isVisible = !document.hidden;
    if (this.isVisible && !this.rafId) {
      this.rafId = requestAnimationFrame(this.update);
    }
  };

  private update = (t: number): void => {
    if (!this.isVisible) {
      this.rafId = 0;
      return;
    }

    this.rafId = requestAnimationFrame(this.update);

    // Smoothly damp pointer coordinates
    this.mouseCurrent.x += (this.mouseTarget.x - this.mouseCurrent.x) * 0.06;
    this.mouseCurrent.y += (this.mouseTarget.y - this.mouseCurrent.y) * 0.06;

    this.program.uniforms.uTime.value = t * 0.001;
    this.program.uniforms.uScroll.value +=
      (this.scrollY - this.program.uniforms.uScroll.value) * 0.08;

    this.renderer.render({ scene: this.mesh });
  };

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.gl.canvas.remove();
  }
}
