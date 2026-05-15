/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import lintStaged from 'lint-staged';

try {
  // Get repository root
  const root = execSync('git rev-parse --show-toplevel').toString().trim();

  // Run lint-staged with API directly
  const passed = await lintStaged({ cwd: root });

  if (!passed) {
    process.exit(1);
  }

  // Run dead code and dependency audits
  console.log('Running dead code and dependency audits...');
  try {
    execSync('npm run dead-code:exports', { stdio: 'inherit', cwd: root });
    execSync('npm run dead-code:deps', { stdio: 'inherit', cwd: root });
  } catch {
    console.error('Dead code or dependency audit failed.');
    process.exit(1);
  }

  // Exit with appropriate code
  process.exit(0);
} catch {
  // Exit with error code
  process.exit(1);
}
