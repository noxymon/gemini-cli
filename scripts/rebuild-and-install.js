/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Clean build artifacts, reinstall deps, bundle, and install globally.
 *
 * Deliberately skips node_modules removal because Windows holds a file lock
 * on native .node binaries (e.g. rollup) making rmSync fail with EPERM.
 * --ignore-scripts avoids the chicken-and-egg where the `prepare` lifecycle
 * tries to bundle before dependencies are available.
 */

import { rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const RMRF = { recursive: true, force: true };

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(label, fn) {
  console.log(`\n▶ ${label}`);
  fn();
  console.log(`  ✓ done`);
}

// --- 1. Clean build artifacts (not node_modules) ---
step('Cleaning build artifacts', () => {
  rmSync(join(root, 'bundle'), RMRF);
  rmSync(join(root, 'packages/cli/src/generated'), RMRF);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  for (const pattern of pkg.workspaces) {
    const workspaceDir = join(root, dirname(pattern));
    let entries;
    try {
      entries = readdirSync(workspaceDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const pkgDir = join(workspaceDir, entry);
      try {
        if (statSync(pkgDir).isDirectory()) {
          rmSync(join(pkgDir, 'dist'), RMRF);
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
});

// --- 2. Restore dependencies without running lifecycle hooks ---
step('Installing dependencies (--ignore-scripts)', () => {
  execSync(`${npmCmd} install --ignore-scripts`, {
    stdio: 'inherit',
    cwd: root,
  });
});

// --- 3. Bundle ---
step('Bundling', () => {
  execSync(`${npmCmd} run bundle`, { stdio: 'inherit', cwd: root });
});

// --- 4. Install globally ---
step('Installing globally', () => {
  execSync(`${npmCmd} install -g .`, { stdio: 'inherit', cwd: root });
});

console.log('\n✅ rebuild-and-install complete\n');
