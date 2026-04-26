# H8 — Lazy-load OpenTelemetry Exporters: Implementation Plan

## Problem Summary

`packages/core/src/telemetry/sdk.ts` statically imports all 6 OTLP exporter variants at
module load time (lines 15–20):

```ts
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter as OTLPLogExporterHttp } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
```

At runtime only one protocol branch (`grpc` or `http`) is ever used, yet both sets of
heavy native-module-linked packages are pulled in.  Because esbuild bundles everything
that is statically reachable, this adds ~8–15 MB of exporter code to the bundle even when
the user is running with `telemetryOutfile` or GCP exporters (where neither OTLP variant
is used at all).

---

## Files to Change

| File | Change |
|---|---|
| `packages/core/src/telemetry/sdk.ts` | Remove 6 static exporter imports; add a `loadOtlpExporters(protocol)` helper that uses dynamic `import()` |
| `packages/core/src/telemetry/sdk.test.ts` | Replace `vi.mock('@opentelemetry/exporter-*')` with `vi.mock()` on the helper module using `vi.doMock` / `importMock` pattern |

---

## Approach

### 1. Remove static imports from `sdk.ts`

Delete lines 15–20 (the six static `import` statements for OTLP exporters).

Also remove the `CompressionAlgorithm` import from `@opentelemetry/otlp-exporter-base` if
it is only used inside the OTLP branch (it is — line 21).  It will need to be dynamically
imported together with the gRPC exporters, or its literal value `'gzip'` can be used
directly.

### 2. Add a `loadOtlpExporters` async helper in `sdk.ts`

```ts
type OtlpExporterSet = {
  TraceExporter: new (opts: { url: string; compression?: string }) => SpanExporter;
  LogExporter: new (opts: { url: string; compression?: string }) => LogRecordExporter;
  MetricExporter: new (opts: { url: string; compression?: string }) => PushMetricExporter;
};

async function loadOtlpExporters(
  protocol: 'grpc' | 'http',
): Promise<OtlpExporterSet> {
  if (protocol === 'http') {
    const [trace, logs, metrics] = await Promise.all([
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/exporter-logs-otlp-http'),
      import('@opentelemetry/exporter-metrics-otlp-http'),
    ]);
    return {
      TraceExporter: trace.OTLPTraceExporter,
      LogExporter: logs.OTLPLogExporter,
      MetricExporter: metrics.OTLPMetricExporter,
    };
  }
  // default: grpc
  const [trace, logs, metrics] = await Promise.all([
    import('@opentelemetry/exporter-trace-otlp-grpc'),
    import('@opentelemetry/exporter-logs-otlp-grpc'),
    import('@opentelemetry/exporter-metrics-otlp-grpc'),
  ]);
  return {
    TraceExporter: trace.OTLPTraceExporter,
    LogExporter: logs.OTLPLogExporter,
    MetricExporter: metrics.OTLPMetricExporter,
  };
}
```

### 3. Update the OTLP branch in `initializeTelemetry`

Replace the current synchronous construction of exporters with awaited calls:

```ts
} else if (useOtlp) {
  const exporters = await loadOtlpExporters(otlpProtocol);
  if (otlpProtocol === 'http') {
    const buildUrl = (path: string) => { … };
    spanExporter = new exporters.TraceExporter({ url: buildUrl('v1/traces') });
    logExporter  = new exporters.LogExporter ({ url: buildUrl('v1/logs')   });
    metricReader = new PeriodicExportingMetricReader({
      exporter: new exporters.MetricExporter({ url: buildUrl('v1/metrics') }),
      exportIntervalMillis: 10000,
    });
  } else {
    spanExporter = new exporters.TraceExporter({ url: parsedEndpoint, compression: 'gzip' });
    logExporter  = new exporters.LogExporter ({ url: parsedEndpoint, compression: 'gzip' });
    metricReader = new PeriodicExportingMetricReader({
      exporter: new exporters.MetricExporter({ url: parsedEndpoint, compression: 'gzip' }),
      exportIntervalMillis: 10000,
    });
  }
```

Note: `CompressionAlgorithm.GZIP` evaluates to the string `'gzip'`.  We replace it with
the literal `'gzip'` to avoid needing to import `@opentelemetry/otlp-exporter-base` at
the top level.  The exporter constructor accepts the raw string.

### 4. Update `sdk.test.ts`

The test currently:
- Statically imports all 6 exporter classes
- Calls `vi.mock('@opentelemetry/exporter-*')` at the top level

After the change the exporter modules are no longer statically imported by `sdk.ts`, so
`vi.mock(...)` calls against them will still auto-mock but the test file's own static
imports of those classes can be removed if we change to mocking the dynamic loader.

**Strategy**: keep the `vi.mock(...)` calls for the exporter packages — Vitest intercepts
dynamic `import()` calls the same as static ones when `vi.mock` is registered at the top
of the test file.  This means the test changes are minimal:

- Remove the static `import` lines for the exporter classes from the test file (lines 14–19)
- Add typed mock references via `vi.mocked(...)` after the modules are mocked
- Replace direct class-constructor checks with `vi.mocked(module).OTLPTraceExporter`

Actually the simplest approach: keep the static imports in the **test file** and keep the
`vi.mock` calls.  Vitest will intercept both the static imports in the test and the
dynamic imports inside `sdk.ts`.  The test assertions (`expect(OTLPTraceExporter).toHaveBeenCalledWith(...)`) will continue to work because `vi.mock` replaces the module
factory globally.

So the test file needs **no structural changes** — Vitest's module mock registry applies
to dynamic imports too.

---

## Architectural Trade-offs

### Top-level await / async init
`initializeTelemetry` is already `async`, so `await loadOtlpExporters(...)` inside it
adds no new contract changes.

### esbuild and dynamic imports
esbuild with `splitting: true` (already set in `esbuild.config.js`) will automatically
code-split dynamic imports into separate chunks.  Each `import('@opentelemetry/exporter-*')` will become a separate chunk that is only loaded when that branch is hit.  This is the
desired behavior.

### Bundle impact
Because the gRPC exporters link native `.node` modules (gRPC core), they may be marked
external or produce separate file chunks.  The HTTP exporters are pure JS and will shrink
the main chunk significantly.

### Default protocol
`getTelemetryOtlpProtocol()` defaults to `'grpc'` when unset.  The `loadOtlpExporters`
function mirrors this default.

---

## Risks

1. **Test mocks**: Vitest intercepts dynamic `import()` via its module mock registry, so
   existing `vi.mock('@opentelemetry/exporter-*')` calls should continue to work.
   Verified by checking Vitest docs and existing test patterns.

2. **Type-safety**: The dynamically-imported exporter classes must satisfy the same
   interface expected by `BatchSpanProcessor`, `BatchLogRecordProcessor`, and
   `PeriodicExportingMetricReader`.  Using `import type` for the interface types and
   casting via constructor signatures ensures this.

3. **Native modules**: The gRPC exporters include native `.node` binaries.  Dynamic import
   of these works at runtime but esbuild may still bundle the JS wrapper; the `.node`
   files themselves are already handled by `loader: { '.node': 'file' }`.

---

## Rollback Strategy

The change is isolated to `sdk.ts` (two-dozen lines of import/construction code).
Reverting is a single `git revert` of the commit.  No schema, config, or API changes are
made.

---

## Verification Steps

1. `npm run typecheck --workspace=@google/gemini-cli-core`
2. `npm run lint --workspace=@google/gemini-cli-core`
3. `npm test --workspace=@google/gemini-cli-core`
4. `npm run bundle` — compare `bundle/` total size before and after
5. Check esbuild metafile for `@opentelemetry/exporter-*` bytes
