/**
 * electron-vite — three build targets in one config:
 *   main     → out/main/index.js   (Electron main process, CJS)
 *   preload  → out/preload/index.js (contextBridge API, CJS)
 *   renderer → out/renderer/        (React Agent UI, file://-safe base './')
 */
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
  },
});
