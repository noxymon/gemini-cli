/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildLspFooter } from './enrichment.js';
import { DiagnosticSeverity, type Diagnostic } from './types.js';

const mkDiag = (severity: DiagnosticSeverity): Diagnostic => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  severity,
  message: 'test',
});

describe('buildLspFooter', () => {
  it('returns success "no issues found" for an empty diagnostic array', () => {
    const footer = buildLspFooter([], false);
    expect(footer).toEqual({
      text: 'LSP: no issues found',
      severity: 'success',
    });
  });

  it('returns warning when timed out with no diagnostics', () => {
    const footer = buildLspFooter([], true);
    expect(footer.severity).toBe('warning');
    expect(footer.text).toContain('timed out');
  });

  it('uses error severity when any errors are present', () => {
    const footer = buildLspFooter(
      [mkDiag(DiagnosticSeverity.Error), mkDiag(DiagnosticSeverity.Warning)],
      false,
    );
    expect(footer.severity).toBe('error');
    expect(footer.text).toBe('LSP: 1 error, 1 warning');
  });

  it('uses warning severity when only warnings/infos are present', () => {
    const footer = buildLspFooter(
      [mkDiag(DiagnosticSeverity.Warning), mkDiag(DiagnosticSeverity.Hint)],
      false,
    );
    expect(footer.severity).toBe('warning');
    expect(footer.text).toBe('LSP: 1 warning, 1 info');
  });

  it('pluralises error counts correctly', () => {
    const footer = buildLspFooter(
      [
        mkDiag(DiagnosticSeverity.Error),
        mkDiag(DiagnosticSeverity.Error),
        mkDiag(DiagnosticSeverity.Error),
      ],
      false,
    );
    expect(footer.text).toBe('LSP: 3 errors');
  });

  it('prefers diagnostics over timed-out flag when both are set', () => {
    // If the server returned something before the timer fired, we still
    // want to surface the diagnostics, not the "timed out" message.
    const footer = buildLspFooter([mkDiag(DiagnosticSeverity.Error)], true);
    expect(footer.severity).toBe('error');
    expect(footer.text).toBe('LSP: 1 error');
  });
});
