import { defineConfig } from 'vite';

// `base: './'` para que los recursos funcionen dentro del WebView de Android.
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist', assetsInlineLimit: 0 },
  test: { environment: 'node' },
} as Parameters<typeof defineConfig>[0]);
