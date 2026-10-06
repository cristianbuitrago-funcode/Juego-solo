import { defineConfig } from 'vite';

// `base: './'` para que los recursos funcionen dentro del WebView de Android.
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist', assetsInlineLimit: 0 },
  // Las pruebas de escenario simulan mundos enteros durante cientos de días: en los
  // servidores de CI (más lentos) superan el límite de 5 s por defecto.
  test: { environment: 'node', testTimeout: 30000 },
} as Parameters<typeof defineConfig>[0]);
