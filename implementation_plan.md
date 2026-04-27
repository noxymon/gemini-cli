# H7 — Bundle Audit Implementation Plan

## Issue Context

- **Path**: `bundle/`, `esbuild.config.js:130-134`
- **Problem**:
  - `splitting: true` is enabled but several chunks are near-identical in size,
    suggesting poor deduplication.
  - The esbuild metafile is only emitted when `DEV=true`, so there is no routine
    visibility into top contributors.
- **Impact**: HIGH — startup latency + install/clone size; likely 20–40 MB
  recoverable.
- **Effort**: S (visibility) → M (rebalance chunks).

---

## Step-by-Step Implementation Plan

### Step 1 — Always emit the esbuild metafile

**File**: `esbuild.config.js` lines 131–135

**Current code**:

```js
esbuild.build(cliConfig).then(({ metafile }) => {
  if (process.env.DEV === 'true') {
    writeFileSync('./bundle/esbuild.json', JSON.stringify(metafile, null, 2));
  }
}),
```

**Change**: Remove the `DEV` guard so the metafile is always written. Also add a
`--analyze`-compatible summary log.

**Rationale**: Without the metafile every build discards the data needed to
identify chunk bloat. Making it unconditional means any CI run can diff it.

---

### Step 2 — Add a bundle-analyze script

**File**: `scripts/analyze-bundle.mjs` (new script)

Add a thin Node.js script that:

1. Reads `bundle/esbuild.json`.
2. Calls `esbuild.analyzeMetafile(metafile, { verbose: false })` and prints the
   result.
3. Prints a sorted top-N list of output files by byte size.

Wire it as `"bundle:analyze": "node scripts/analyze-bundle.mjs"` in
`package.json`.

**Rationale**: Provides a quick CLI command to run after any `npm run bundle` to
see what changed.

---

### Step 3 — Inventory duplication (analysis)

Run `npm run bundle && npm run bundle:analyze` and record:

- Total bundle size (sum of all files in `bundle/`).
- Number of JS chunk files.
- Top-5 chunks by size.
- Which packages contribute most bytes (per esbuild analyze output).

---

### Step 4 — Concrete deduplication / chunk-rebalancing strategies

#### 4a. Explicit `manualChunks` for the heaviest shared deps

esbuild's `splitting: true` creates shared chunks automatically, but naming them
explicitly (via `chunkNames`) helps avoid hash-based filenames while a
`manualChunks`-style approach can be emulated with additional entry points.

**Candidate packages** (based on dependency list in
`packages/core/package.json`):

| Package            | Why it's large                                 |
| ------------------ | ---------------------------------------------- |
| `@opentelemetry/*` | 15+ sub-packages, many are grpc/http exporters |
| `@google/genai`    | Large SDK                                      |
| `@grpc/grpc-js`    | gRPC runtime                                   |
| `puppeteer-core`   | Browser automation SDK                         |
| `@google-cloud/*`  | Logging + monitoring exporters                 |

#### 4b. Externalize large optional/runtime-only deps

Packages that are only needed at runtime for optional features can be
`external`-ised so they are not bundled at all:

- `puppeteer-core` — only needed when the browser MCP server is launched; it is
  already bundled separately via `bundle:browser-mcp`.
- `@google-cloud/logging` /
  `@google-cloud/opentelemetry-cloud-monitoring-exporter` /
  `@google-cloud/opentelemetry-cloud-trace-exporter` — only needed when Cloud
  Logging/Monitoring telemetry is enabled.

**Risk**: If these are lazily imported via dynamic `import()`, externalizing
them requires them to be present in `node_modules` at runtime — fine for a
global npm install, risky for a standalone binary (SEA). Must verify the import
pattern before externalizing.

#### 4c. Chunk name stabilization

Add `chunkNames: 'chunks/[name]-[hash]'` to `cliConfig` so split chunks land in
a predictable sub-directory and are easy to audit.

#### 4d. OTel exporter splitting (H8 overlap)

The OTel SDK ships both gRPC and HTTP variants for logs, metrics, and traces.
Bundling all six exporters unconditionally is wasteful if only one transport is
used. A future H8 ticket can tree-shake to a single transport (e.g., HTTP only).
For now, flag the exporters as candidates.

---

### Step 5 — Safe change set for this PR

1. **Always emit metafile** (Step 1) — zero risk.
2. **Add `bundle:analyze` script** (Step 2) — zero risk.
3. **Add `chunkNames`** to `cliConfig` — cosmetic, zero risk.
4. **Externalize `puppeteer-core`** — only if confirmed it is loaded via dynamic
   import and not needed at bundle time. Check `packages/core/src/` for how it's
   imported before externalizing.

---

### Step 6 — Measurement methodology (before/after)

**Before**: run `npm run bundle` on the main branch, record:

```
Total bundle size: du -sh bundle/
Chunk count: ls bundle/*.js | wc -l
Top-5 chunks: ls -lS bundle/*.js | head -5
```

**After**: run `npm run bundle` on this branch, record the same metrics, diff.

---

### Step 7 — Critical files

| File                         | Role                                                |
| ---------------------------- | --------------------------------------------------- |
| `esbuild.config.js`          | Main bundler config — all changes land here         |
| `package.json`               | Add `bundle:analyze` script                         |
| `scripts/analyze-bundle.mjs` | New analysis helper                                 |
| `packages/core/src/`         | Source of truth for import patterns (lazy vs eager) |

---

### Architectural Trade-offs and Risks

| Trade-off                  | Details                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metafile size              | `bundle/esbuild.json` will be ~2–5 MB. It is already in `.gitignore` (verify) — if not, add it.                                                                       |
| Externalizing deps         | Safe for npm-global installs; breaks SEA (single-executable app) builds. Only externalize deps that are already excluded from the SEA build or confirmed lazy-loaded. |
| `chunkNames`               | Purely cosmetic; esbuild ignores manual chunk grouping — actual splitting is still driven by the import graph.                                                        |
| Metafile emission overhead | Writing a 2–5 MB JSON file adds ~50 ms to the build. Acceptable.                                                                                                      |

---

## Before/After Metrics

Build was run from the main repo's node_modules against the worktree's
esbuild.config.js. The `bundle/` directory is gitignored and only the JS output
files are counted here.

### Before (original esbuild.config.js — no metafile, no chunkNames)

| Metric                      | Value                             |
| --------------------------- | --------------------------------- |
| Total JS output size        | 24.13 MB (35 files)               |
| JS chunk count (this build) | 35                                |
| Metafile emitted            | No (DEV guard blocked it)         |
| Chunk location              | `bundle/*.js` (flat, all at root) |
| Top-1 chunk                 | `chunk-6AMKQWK5.js` — 14.59 MB    |
| Top-2 chunk                 | `chunk-TG7TF57E.js` — 2.73 MB     |
| Top-3 chunk                 | `chunk-N76ZEDPA.js` — 1.97 MB     |
| Top-4 chunk                 | `tree-sitter-bash-*.js` — 1.84 MB |
| Top-5 chunk                 | `interactiveCli-*.js` — 1.31 MB   |

### After (updated esbuild.config.js — unconditional metafile, chunkNames)

| Metric               | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| Total JS output size | 25.30 MB reported by analyze (36 files incl. `gemini.js`) |
| JS chunk count       | 35 in `bundle/chunks/` + 1 entry point `bundle/gemini.js` |
| Metafile emitted     | Yes — `bundle/esbuild.json` always written                |
| Chunk location       | `bundle/chunks/*.js` (organized subdirectory)             |
| Top-1 chunk          | `chunk-J4NPTY7I.js` — 14.59 MB                            |
| Top-2 chunk          | `chunk-NWU2IVJZ.js` — 2.73 MB                             |
| Top-3 chunk          | `chunk-K5MLY7SA.js` — 1.97 MB                             |
| Top-4 chunk          | `tree-sitter-bash-YTAZU6AY.js` — 1.84 MB                  |
| Top-5 chunk          | `interactiveCli-UP4C6PPB.js` — 1.31 MB                    |

**Key finding**: The 14.59 MB monolithic chunk contains the entire OTel + gRPC +
GCP Cloud Logging stack bundled together. Top contributors to that chunk:

- `@google-cloud/logging` protos: 1.3 MB (9.2%)
- `@opentelemetry/otlp-transformer` generated root: 432 kB (3.0%)
- `google-gax` protos: 625 kB (4.5% combined)
- `@xterm/headless`: 206 kB
- All 30 OTel sub-packages bundled via static imports in
  `packages/core/src/telemetry/sdk.ts`

**Top npm packages by bytes across all outputs**:

1. `(project source)` — 5.14 MB
2. `@google-cloud/logging` — 2.01 MB
3. `tree-sitter-bash` — 1.84 MB
4. `@grpc/grpc-js` — 1.08 MB
5. `undici` — 1.01 MB

---

## Deferred Items

- **H8 OTel exporter per-transport splitting**: The OTel stack accounts for a
  significant portion of the 14.59 MB monolithic chunk.
  `packages/core/src/telemetry/sdk.ts` statically imports all six exporters
  (grpc + http × logs/metrics/traces). Switching to dynamic imports and
  selecting only one transport at startup could save 5–10 MB but requires a
  non-trivial refactor tracked under H8.

- **`@google-cloud/logging` proto externalization**: The protos.js file alone is
  1.3 MB (9.2% of the largest chunk). These are statically required by the gRPC
  client stubs. Deferring to a follow-up that evaluates replacing
  `@google-cloud/logging` with a lighter REST-only client.

- **`puppeteer-core` externalization**: The browser-MCP bundle
  (`packages/core/dist/bundled/`) already externalizes `puppeteer-core`
  correctly. However, the main CLI bundle may still pull it in if any eager
  import path exists. Deferred pending audit.

- **`@google-cloud/*` externalization**: `gcp-exporters.ts` statically imports
  `@google-cloud/logging`, `@google-cloud/opentelemetry-cloud-trace-exporter`,
  and `@google-cloud/opentelemetry-cloud-monitoring-exporter`. Making these
  optional (lazy import + null-check) would allow externalizing them and
  removing ~2 MB from the bundle. Deferred because it needs a
  capability-negotiation refactor.

- **`google-gax` proto removal**: `google-gax` bundles several large proto files
  (iam_service, operations, locations) totalling ~625 kB. These are used only by
  `@google-cloud/logging`. Deferred with above.
