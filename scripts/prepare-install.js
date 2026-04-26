/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleEntry = join(repoRoot, 'bundle', 'gemini.js');

// `npm install -g .` re-runs the prepare lifecycle inside a temp pack dir
// where `npm run build --workspace=...` is rejected ("Workspaces not supported
// for global packages"). When a bundle already exists on disk, the `files`
// allowlist will pack it into the tarball and a rebuild is unnecessary.
if (existsSync(bundleEntry)) {
  console.log('[prepare] bundle/gemini.js found, skipping rebuild.');
  process.exit(0);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const husky = spawnSync(npxCmd, ['husky'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
});
if (husky.status !== 0) {
  console.warn('[prepare] husky setup skipped (non-fatal).');
}

const bundle = spawnSync(npmCmd, ['run', 'bundle'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
});
process.exit(bundle.status ?? 1);
