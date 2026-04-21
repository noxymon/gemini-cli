/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildLspFooter,
  enrichReadManyWithLsp,
  DEFAULT_READ_MANY_FILES_LSP_BUDGET,
} from './enrichment.js';
import { DiagnosticSeverity, type Diagnostic } from './types.js';
import type { Config } from '../config/config.js';

const mkDiag = (
  severity: DiagnosticSeverity,
  opts: { line?: number; message?: string } = {},
): Diagnostic => ({
  range: {
    start: { line: opts.line ?? 0, character: 0 },
    end: { line: opts.line ?? 0, character: 1 },
  },
  severity,
  message: opts.message ?? 'test',
});

describe('buildLspFooter', () => {
  it('returns "LSP: clean" for an empty diagnostic array', () => {
    const footer = buildLspFooter([], false);
    expect(footer).toEqual({ text: 'LSP: clean', severity: 'success' });
  });

  it('returns "LSP: timed out" when timed out with no diagnostics', () => {
    const footer = buildLspFooter([], true);
    expect(footer).toEqual({ text: 'LSP: timed out', severity: 'warning' });
  });

  it('surfaces the first diagnostic message with line number', () => {
    const footer = buildLspFooter(
      [
        mkDiag(DiagnosticSeverity.Error, {
          line: 4,
          message: "Type 'string' is not assignable to 'number'",
        }),
      ],
      false,
    );
    expect(footer).toEqual({
      text: "LSP: Type 'string' is not assignable to 'number' (line 5)",
      severity: 'error',
    });
  });

  it('picks the highest-severity diagnostic first, tiebroken by line', () => {
    const footer = buildLspFooter(
      [
        mkDiag(DiagnosticSeverity.Warning, { line: 0, message: 'warn A' }),
        mkDiag(DiagnosticSeverity.Error, { line: 10, message: 'err later' }),
        mkDiag(DiagnosticSeverity.Error, { line: 2, message: 'err early' }),
      ],
      false,
    );
    // Two errors, one warning: error on line 3 is the earliest error.
    expect(footer.text).toBe('LSP: err early (line 3) (+2 more)');
    expect(footer.severity).toBe('error');
  });

  it('adds a "+N more" suffix when there are additional diagnostics', () => {
    const footer = buildLspFooter(
      [
        mkDiag(DiagnosticSeverity.Error, { line: 0, message: 'first' }),
        mkDiag(DiagnosticSeverity.Error, { line: 1, message: 'second' }),
        mkDiag(DiagnosticSeverity.Error, { line: 2, message: 'third' }),
      ],
      false,
    );
    expect(footer.text).toBe('LSP: first (line 1) (+2 more)');
  });

  it('uses warning severity when only warnings/infos are present', () => {
    const footer = buildLspFooter(
      [
        mkDiag(DiagnosticSeverity.Warning, { message: 'unused var' }),
        mkDiag(DiagnosticSeverity.Hint, { message: 'style hint' }),
      ],
      false,
    );
    expect(footer.severity).toBe('warning');
    expect(footer.text).toBe('LSP: unused var (line 1) (+1 more)');
  });

  it('prefers diagnostics over timed-out flag when both are set', () => {
    // If the server returned something before the timer fired, we still
    // want to surface the diagnostics, not the "timed out" message.
    const footer = buildLspFooter(
      [mkDiag(DiagnosticSeverity.Error, { message: 'boom' })],
      true,
    );
    expect(footer.severity).toBe('error');
    expect(footer.text).toBe('LSP: boom (line 1)');
  });

  it('takes only the first line of a multi-line diagnostic message', () => {
    const footer = buildLspFooter(
      [
        mkDiag(DiagnosticSeverity.Error, {
          message: "Type 'string' is not assignable\n  Details: ...",
        }),
      ],
      false,
    );
    expect(footer.text).toBe("LSP: Type 'string' is not assignable (line 1)");
  });
});

describe('enrichReadManyWithLsp', () => {
  const mkDisabledConfig = (): Config =>
    ({
      isLspEnabled: () => false,
    }) as unknown as Config;

  it('returns an empty appendix when LSP is disabled', async () => {
    const result = await enrichReadManyWithLsp(mkDisabledConfig(), [
      '/a.ts',
      '/b.ts',
    ]);
    expect(result.llmAppendix).toBe('');
    expect(result.displayFooter).toBeUndefined();
  });

  it('returns an empty appendix when getLspManager resolves undefined', async () => {
    const config = {
      isLspEnabled: () => true,
      getLspManager: async () => undefined,
    } as unknown as Config;
    const result = await enrichReadManyWithLsp(config, ['/a.ts']);
    expect(result.llmAppendix).toBe('');
    expect(result.displayFooter).toBeUndefined();
  });

  it('uses the documented default budget', () => {
    // Guard against an accidental change to the exported constant. Other
    // callers (docs, tests) depend on the value.
    expect(DEFAULT_READ_MANY_FILES_LSP_BUDGET).toBe(10);
  });
});
