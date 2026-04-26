/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find the node_modules directory containing react by walking up from __dirname.
 * This handles git worktrees where node_modules may not be at a fixed relative
 * path (e.g. ../../node_modules) from the package directory.
 */
function findReactDir(startDir: string): string {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, 'node_modules', 'react');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Fallback to the conventional relative path
      return path.resolve(startDir, '../../node_modules/react');
    }
    dir = parent;
  }
}

const reactDir = findReactDir(__dirname);

export default defineConfig({
  resolve: {
    conditions: ['test'],
  },
  test: {
    include: ['**/*.{test,spec}.{js,ts,jsx,tsx}', 'config.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cypress/**'],
    environment: 'node',
    globals: true,
    reporters: ['default', 'junit'],

    outputFile: {
      junit: 'junit.xml',
    },
    alias: [
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: path.join(reactDir, 'jsx-dev-runtime.js'),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.join(reactDir, 'jsx-runtime.js'),
      },
      {
        find: /^react$/,
        replacement: reactDir,
      },
    ],
    setupFiles: ['./test-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      reporter: [
        ['text', { file: 'full-text-summary.txt' }],
        'html',
        'json',
        'lcov',
        'cobertura',
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 4,
      },
    },
    server: {
      deps: {
        inline: [/@google\/gemini-cli-core/],
      },
    },
  },
});
