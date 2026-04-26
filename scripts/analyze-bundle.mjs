/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bundle analysis script for H7 — Bundle audit.
 *
 * Usage:
 *   npm run bundle:analyze
 *   npm run bundle:analyze -- --top 20
 *   npm run bundle:analyze -- --verbose
 *
 * Reads bundle/esbuild.json (always emitted by esbuild.config.js) and prints:
 *   1. Top-N output files by size.
 *   2. Top-N input files (npm packages) by size across all outputs.
 *   3. Human-readable esbuild --analyze summary.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

let esbuild;
try {
  esbuild = (await import('esbuild')).default;
} catch {
  console.error('esbuild not available; run: npm install');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const metafilePath = resolve(root, 'bundle', 'esbuild.json');

let metafile;
try {
  metafile = JSON.parse(readFileSync(metafilePath, 'utf8'));
} catch (err) {
  console.error(
    `Could not read ${metafilePath}.\n` +
      `Run "npm run bundle" first to generate the metafile.\n` +
      `Error: ${err.message}`,
  );
  process.exit(1);
}

// Parse --top and --verbose flags from argv
const args = process.argv.slice(2);
const topIdx = args.indexOf('--top');
const TOP = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) || 10 : 10;
const VERBOSE = args.includes('--verbose');

// ── 1. Top output files by size ────────────────────────────────────────────

const outputs = Object.entries(metafile.outputs)
  .filter(([, v]) => v.bytes !== undefined)
  .map(([file, v]) => ({ file: basename(file), bytes: v.bytes }))
  .sort((a, b) => b.bytes - a.bytes);

const totalBytes = outputs.reduce((s, o) => s + o.bytes, 0);

console.log(
  `\n=== Bundle output files (top ${TOP} of ${outputs.length} total, ${fmtMB(totalBytes)} total) ===\n`,
);
outputs.slice(0, TOP).forEach(({ file, bytes }) => {
  console.log(`  ${fmtMB(bytes).padStart(8)}  ${file}`);
});

// ── 2. Top input packages by bytes (across all outputs) ────────────────────

const packageBytes = {};
for (const [, output] of Object.entries(metafile.outputs)) {
  for (const [inputPath, inputMeta] of Object.entries(output.inputs || {})) {
    const pkg = packageName(inputPath);
    packageBytes[pkg] = (packageBytes[pkg] || 0) + (inputMeta.bytesInOutput || 0);
  }
}

const sortedPackages = Object.entries(packageBytes)
  .sort(([, a], [, b]) => b - a)
  .slice(0, TOP);

console.log(`\n=== Top ${TOP} npm packages by bytes in output ===\n`);
sortedPackages.forEach(([pkg, bytes]) => {
  console.log(`  ${fmtMB(bytes).padStart(8)}  ${pkg}`);
});

// ── 3. esbuild --analyze text ──────────────────────────────────────────────

if (VERBOSE) {
  console.log('\n=== esbuild --analyze (verbose) ===\n');
  const text = await esbuild.analyzeMetafile(metafile, { verbose: true });
  console.log(text);
} else {
  console.log('\n=== esbuild --analyze (pass --verbose for full tree) ===\n');
  const text = await esbuild.analyzeMetafile(metafile, { verbose: false });
  console.log(text);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMB(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function packageName(inputPath) {
  // Normalise Windows backslashes
  const p = inputPath.replace(/\\/g, '/');
  const nmIdx = p.lastIndexOf('node_modules/');
  if (nmIdx === -1) return '(project source)';
  const after = p.slice(nmIdx + 'node_modules/'.length);
  // Scoped packages: @scope/name
  if (after.startsWith('@')) {
    const parts = after.split('/');
    return parts.slice(0, 2).join('/');
  }
  return after.split('/')[0];
}
