import { defineConfig } from 'astro/config';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  devToolbar: {
    enabled: false
  },
  vite: {
    plugins: [
      glsl({
        include: [
          '**/*.glsl',
          '**/*.wgsl',
          '**/*.vert',
          '**/*.frag',
          '**/*.vs',
          '**/*.fs'
        ],
        compress: true
      })
    ],
    build: {
      target: 'esnext',
      rollupOptions: {
        output: {
          manualChunks: {
            webgl: ['ogl', 'three']
          }
        }
      }
    }
  }
});
