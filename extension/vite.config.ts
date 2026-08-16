import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// MV3 multi-entry build: one IIFE bundle per content script, one for the popup.
// manifest.json lives in public/ and is copied to dist/ as-is.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        'content/zhipin': resolve(__dirname, 'src/content/zhipin.ts'),
        'content/zhipin-chat': resolve(__dirname, 'src/content/zhipin-chat.ts'),
        'content/zhipin-list': resolve(__dirname, 'src/content/zhipin-list.ts'),
        'content/liepin': resolve(__dirname, 'src/content/liepin.ts'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
