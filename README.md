# Portfolio 2027

Personal portfolio built for instant First Contentful Paint and high-throughput GLSL / WebGL shaders.

## Stack

- **Framework**: [Astro 5](https://astro.build/) (zero-JS static HTML shell by default)
- **WebGL / Shaders**: [OGL](https://github.com/oframe/ogl) & [Three.js](https://threejs.org/) with `vite-plugin-glsl` for compressed `.glsl` / `.vert` / `.frag` shader imports
- **Smooth Scroll**: [Lenis](https://github.com/darkroomengineering/lenis)
- **Language**: TypeScript (strict)

## Architecture for Fast Load + Heavy Shaders

1. **Instant First Paint**: Astro renders static HTML & CSS immediately with zero blocking framework runtime.
2. **Deferred WebGL Hydration**: `ShaderCanvas.astro` mounts the WebGL context inside `requestIdleCallback` via dynamic `import()`, keeping the main thread completely unblocked during initial load.
3. **Full-Screen Triangle Pass**: `ShaderStage.ts` renders fragment shaders on a single full-screen triangle (`OGL.Triangle`) with adaptive DPR clamping (`<= 1.75`) and automatic `visibilitychange` loop pausing.

## Commands

```bash
bun install      # or npm install
bun run dev      # start local dev server
bun run build    # typecheck and build production bundle
bun run preview  # preview production build
```
