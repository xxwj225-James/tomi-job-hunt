import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * HR screening web app — a standalone static page (no browser extension, no
 * server). base:'./' keeps asset URLs relative so the built dist/ can even be
 * opened from file:// (PDF parsing then degrades to main-thread, see parser.ts).
 */
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
