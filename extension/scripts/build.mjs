/**
 * Multi-build extension bundler (Vite programmatic API).
 *
 * MV3 content scripts load as plain scripts — no ESM imports, no code
 * splitting. Each content script gets its own single-entry IIFE build
 * (shared code inlined per entry); the popup gets a regular app build.
 * All output lands in dist/; manifest.json comes from public/.
 */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTENT_SCRIPTS = ['zhipin', 'zhipin-chat', 'zhipin-list', 'liepin'];
const watch = process.argv.includes('--watch') ? {} : null;

// 1) Popup (regular build; public/manifest.json copied to dist/)
await build({
  configFile: false,
  root,
  publicDir: resolve(root, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    watch,
    rollupOptions: {
      input: { popup: resolve(root, 'popup.html') },
      output: { entryFileNames: '[name].js' },
    },
  },
});

// 2) Content scripts — one self-contained IIFE bundle each
for (const name of CONTENT_SCRIPTS) {
  await build({
    configFile: false,
    root,
    publicDir: false, // manifest.json already copied by the popup build
    build: {
      outDir: 'dist/content',
      emptyOutDir: false,
      watch,
      lib: {
        entry: resolve(root, `src/content/${name}.ts`),
        formats: ['iife'],
        name: 'TomiHunt',
        fileName: () => `${name}.js`,
      },
    },
  });
}

console.log(watch ? 'extension watching for changes…' : 'extension build complete: dist/');
