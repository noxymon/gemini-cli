/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/**',
      '**/fix-ui-hang/**',
      '**/evals/**',
      '**/integration-tests/**',
      '**/memory-tests/**',
      '**/perf-tests/**',
    ],
  },
});
