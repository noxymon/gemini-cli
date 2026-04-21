/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { Diagnostic, DocumentSymbol, SymbolInformation } from './types.js';
import { DiagnosticSeverity, SymbolKind } from './types.js';
import type { LspManager } from './manager.js';

const MAX_DIAGNOSTICS = 20;
const MAX_SYMBOLS = 50;

const SEVERITY_LABELS: Record<number, string> = {
  [DiagnosticSeverity.Error]: 'ERROR',
  [DiagnosticSeverity.Warning]: 'WARN',
  [DiagnosticSeverity.Information]: 'INFO',
  [DiagnosticSeverity.Hint]: 'HINT',
};

/**
 * Result from collecting diagnostics, including whether we timed out.
 */
export interface CollectedDiagnostics {
  /** Formatted XML string for llmContent (empty if no diagnostics). */
  llmOutput: string;
  /** Whether the server timed out before responding. */
  timedOut: boolean;
  /** Whether LSP was applicable for this file type at all. */
  applicable: boolean;
  /** The raw diagnostics returned by the server. */
  diagnostics: Diagnostic[];
}

/**
 * Collect LSP diagnostics for a file and format them for inclusion in tool
 * output. All severity levels are included — the agent benefits from seeing
 * warnings and hints, not just errors.
 */
export async function collectDiagnosticsForOutput(
  lspManager: LspManager,
  filePath: string,
  content: string,
  signal?: AbortSignal,
): Promise<CollectedDiagnostics> {
  if (!lspManager.hasServerFor(filePath)) {
    return {
      llmOutput: '',
      timedOut: false,
      applicable: false,
      diagnostics: [],
    };
  }

  const result = await lspManager.getDiagnostics(filePath, content, signal);

  if (result.diagnostics.length === 0) {
    return {
      llmOutput: '',
      timedOut: result.timedOut,
      applicable: true,
      diagnostics: [],
    };
  }

  return {
    llmOutput: formatDiagnostics(result.diagnostics, filePath),
    timedOut: false,
    applicable: true,
    diagnostics: result.diagnostics,
  };
}

/**
 * Format a list of diagnostics into the XML-tagged output format.
 * All severity levels are included.
 */
export function formatDiagnostics(
  diagnostics: Diagnostic[],
  filePath: string,
): string {
  if (diagnostics.length === 0) return '';

  // Sort by severity (errors first), then by line number.
  const sorted = [...diagnostics].sort((a, b) => {
    const sevDiff =
      (a.severity ?? DiagnosticSeverity.Error) -
      (b.severity ?? DiagnosticSeverity.Error);
    if (sevDiff !== 0) return sevDiff;
    return a.range.start.line - b.range.start.line;
  });

  const truncated = sorted.length > MAX_DIAGNOSTICS;
  const shown = truncated ? sorted.slice(0, MAX_DIAGNOSTICS) : sorted;

  const fileName = path.basename(filePath);
  const lines = shown.map((d) => {
    const sev =
      SEVERITY_LABELS[d.severity ?? DiagnosticSeverity.Error] ?? 'ERROR';
    // LSP lines are 0-based; display as 1-based.
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    return `${sev.padEnd(5)} line ${line}:${col}: ${d.message}`;
  });

  let body = `Compiler feedback for ${fileName}:\n\n${lines.join('\n')}`;
  if (truncated) {
    body += `\n\n(${sorted.length - MAX_DIAGNOSTICS} more diagnostics omitted)`;
  }

  return `\n\n<lsp_diagnostics file="${filePath}">\n${body}\n</lsp_diagnostics>`;
}

/**
 * Append LSP diagnostic output to existing llmContent.
 */
export function appendLspDiagnostics(
  llmContent: string,
  lspOutput: string,
): string {
  if (!lspOutput) return llmContent;
  return `${llmContent}${lspOutput}`;
}

// -----------------------------------------------------------------------
// Symbol formatting
// -----------------------------------------------------------------------

const SYMBOL_KIND_LABELS: Partial<Record<SymbolKind, string>> = {
  [SymbolKind.Class]: 'class',
  [SymbolKind.Interface]: 'interface',
  [SymbolKind.Function]: 'function',
  [SymbolKind.Method]: 'method',
  [SymbolKind.Property]: 'property',
  [SymbolKind.Field]: 'field',
  [SymbolKind.Variable]: 'variable',
  [SymbolKind.Constant]: 'constant',
  [SymbolKind.Enum]: 'enum',
  [SymbolKind.EnumMember]: 'member',
  [SymbolKind.Constructor]: 'constructor',
  [SymbolKind.Module]: 'module',
  [SymbolKind.Namespace]: 'namespace',
  [SymbolKind.TypeParameter]: 'type param',
  [SymbolKind.Struct]: 'struct',
};

/**
 * Check if a symbol array contains hierarchical DocumentSymbol objects
 * (with children) vs flat SymbolInformation objects.
 */
function isDocumentSymbols(
  symbols: DocumentSymbol[] | SymbolInformation[],
): symbols is DocumentSymbol[] {
  return (
    symbols.length > 0 &&
    'range' in symbols[0] &&
    'selectionRange' in symbols[0]
  );
}

/**
 * Format document symbols into a condensed text summary for llmContent.
 * Shows top-level symbols + one nesting level (e.g., class methods).
 */
export function formatSymbolSummary(
  symbols: DocumentSymbol[] | SymbolInformation[],
  filePath: string,
): string {
  if (symbols.length === 0) return '';

  const fileName = path.basename(filePath);
  const lines: string[] = [];
  let count = 0;

  if (isDocumentSymbols(symbols)) {
    for (const sym of symbols) {
      if (count >= MAX_SYMBOLS) break;
      const kind = SYMBOL_KIND_LABELS[sym.kind] ?? 'symbol';
      const detail = sym.detail ? ` ${sym.detail}` : '';
      const line = sym.range.start.line + 1;
      lines.push(`${kind.padEnd(12)} ${sym.name}${detail} (line ${line})`);
      count++;

      // One nesting level: show children (methods, properties, etc.)
      if (sym.children) {
        for (const child of sym.children) {
          if (count >= MAX_SYMBOLS) break;
          const childKind = SYMBOL_KIND_LABELS[child.kind] ?? 'symbol';
          const childDetail = child.detail ? ` ${child.detail}` : '';
          lines.push(`  ${childKind.padEnd(12)} ${child.name}${childDetail}`);
          count++;
        }
      }
    }
  } else {
    // Flat SymbolInformation — no hierarchy
    for (const sym of symbols) {
      if (count >= MAX_SYMBOLS) break;
      const kind = SYMBOL_KIND_LABELS[sym.kind] ?? 'symbol';
      const line = sym.location.range.start.line + 1;
      const container = sym.containerName ? ` (in ${sym.containerName})` : '';
      lines.push(`${kind.padEnd(12)} ${sym.name}${container} (line ${line})`);
      count++;
    }
  }

  const truncated =
    count >= MAX_SYMBOLS
      ? `\n(${symbols.length - MAX_SYMBOLS} more symbols omitted)`
      : '';

  return `\n\n<lsp_symbols file="${filePath}">\nSymbol index for ${fileName}:\n\n${lines.join('\n')}${truncated}\n</lsp_symbols>`;
}
