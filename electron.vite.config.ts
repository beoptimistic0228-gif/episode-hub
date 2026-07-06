import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared }, build: { outDir: 'out/main' } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared }, build: { outDir: 'out/preload' } },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: { alias: shared },
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve('index.html') } },
  },
});
