/**
 * Multi-build extension bundler (Vite programmatic API).
 *
 * MV3 content scripts load as plain scripts — no ESM imports, no code
 * splitting. Each content script gets its own single-entry IIFE build
 * (shared code inlined per entry); the popup gets a regular app build.
 * All output lands in dist/; manifest.json comes from public/ — with its
 * `version` overwritten from package.json at build time (step 1b), so the
 * value committed in public/manifest.json is a placeholder, not the truth.
 */
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTENT_SCRIPTS = ['zhipin', 'zhipin-chat', 'zhipin-list', 'liepin', 'hr-zhipin', 'hr-liepin'];
const watch = process.argv.includes('--watch') ? {} : null;

// 1) Popup + options (regular build; public/manifest.json copied to dist/)
await build({
  configFile: false,
  root,
  publicDir: resolve(root, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    watch,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        options: resolve(root, 'options.html'),
        workspace: resolve(root, 'workspace.html'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
});

// 1b) Stamp the real version into dist/manifest.json. public/manifest.json is
// copied verbatim by the publicDir step above and its `version` had drifted
// (Chrome showed 0.2.0 on 0.4.0 builds, and the desktop App's install-guide
// logged that same stale string).
//
// The version stamped is the AGENT's (app/package.json) — the installer, the
// updater feed, the App's install-guide and chrome://extensions must all show
// ONE number, and a separate extension counter drifts the moment either side is
// bumped alone. extension/package.json is only a fallback for building the
// extension standalone, so its own version is no longer what Chrome reports.
function agentVersion() {
  const candidates = [resolve(root, '../app/package.json'), resolve(root, 'package.json')];
  for (const p of candidates) {
    try {
      const v = JSON.parse(readFileSync(p, 'utf8')).version;
      if (typeof v === 'string' && v) return { version: v, from: p };
    } catch {
      // missing / unreadable → try the next candidate
    }
  }
  return { version: '0.0.0', from: 'fallback' };
}

const { version, from } = agentVersion();
const manifestPath = resolve(root, 'dist/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest version → ${version} (agent: ${from})`);

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

// 3) Background service worker — single IIFE at dist/background.js
await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    watch,
    lib: {
      entry: resolve(root, 'src/background/index.ts'),
      formats: ['iife'],
      name: 'TomiHuntAgent',
      fileName: () => 'background.js',
    },
  },
});

console.log(watch ? 'extension watching for changes…' : 'extension build complete: dist/');
