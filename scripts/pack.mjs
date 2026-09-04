/**
 * TomiHunt Agent Windows installer pipeline (user-invoked: `npm run pack`).
 *
 *   1. build core          → core/dist            (tsc, ESM)
 *   2. build extension     → extension/dist       (MV3 bundle)
 *   3. build app           → app/out              (electron-vite)
 *   4. stage core payload  → .pack-stage/core/{dist,package.json,node_modules}
 *                           (prod deps only — the two optional @anthropic-ai
 *                            SDKs (~300MB) are intentionally excluded)
 *   5. electron-builder    → release/TomiHuntSetup-<version>.exe + latest.yml
 *
 * The staged core is resolved by extraResources in app/electron-builder.yml
 * into resources/core, which core-host.ts forks with ELECTRON_RUN_AS_NODE on a
 * clean machine (no system Node needed).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const STAGE = join(ROOT, '.pack-stage', 'core');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bin = (name) => join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

function run(name, args, cwd) {
  // Windows can't CreateProcess a .cmd batch directly — route it through the
  // shell (cmd.exe) or spawnSync dies with EINVAL.
  const useShell = process.platform === 'win32' && name.endsWith('.cmd');
  const res = spawnSync(name, args, { cwd, stdio: 'inherit', env: process.env, shell: useShell });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    console.error(`\n[pack] ${name} ${args.join(' ')} exited ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

function step(msg) {
  console.log(`\n[pack] ── ${msg}`);
}

step('1/5 build core (dist)');
run(npmCmd, ['run', 'build', '-w', 'core'], ROOT);

step('2/5 build extension (dist)');
run(npmCmd, ['run', 'build', '-w', 'extension'], ROOT);

step('3/5 build app (out)');
run(npmCmd, ['run', 'build', '-w', 'app'], ROOT);

step('4/5 stage core payload (prod deps only)');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const corePkg = JSON.parse(readFileSync(join(ROOT, 'core', 'package.json'), 'utf8'));
if (!existsSync(join(ROOT, 'core', 'dist', 'index.js'))) {
  console.error('[pack] core/dist/index.js missing after build — aborting');
  process.exit(1);
}
cpSync(join(ROOT, 'core', 'dist'), join(STAGE, 'dist'), { recursive: true });
// Minimal manifest so staged core resolves as ESM + its own prod deps.
writeFileSync(
  join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: '@tomi/core',
      version: corePkg.version,
      type: 'module',
      private: true,
      dependencies: corePkg.dependencies ?? {},
    },
    null,
    2,
  ),
  'utf8',
);
// Resolve prod deps in a STANDALONE temp project outside the repo. `--prefix`
// under the workspace root is ignored — npm walks up to ROOT/package.json and
// hoists deps there, leaving the stage payload without a node_modules. A temp
// dir outside the repo is its own npm root → self-contained closure that drops
// straight into resources/core for a clean-machine run.
const depsDir = mkdtempSync(join(tmpdir(), 'tomi-core-deps-'));
try {
  writeFileSync(
    join(depsDir, 'package.json'),
    JSON.stringify(
      {
        name: '@tomi/core-stage',
        version: corePkg.version,
        private: true,
        dependencies: corePkg.dependencies ?? {},
      },
      null,
      2,
    ),
    'utf8',
  );
  run(
    npmCmd,
    ['install', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund', '--no-package-lock'],
    depsDir,
  );
  cpSync(join(depsDir, 'node_modules'), join(STAGE, 'node_modules'), { recursive: true });
} finally {
  rmSync(depsDir, { recursive: true, force: true });
}

step('5/5 electron-builder (win nsis)');
try {
  // projectDir = app/ (config discovery + relative files/extraResources paths).
  run(bin('electron-builder'), ['--win', 'nsis'], join(ROOT, 'app'));
} finally {
  // Never leave a half-GiB staging tree behind after a successful build.
  rmSync(join(ROOT, '.pack-stage'), { recursive: true, force: true });
}

console.log('\n[pack] done — artifacts in release/ (TomiHuntSetup-<version>.exe + latest.yml + .blockmap)');
