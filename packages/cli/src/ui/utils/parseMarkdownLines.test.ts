/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for parseMarkdownLines — the pure parse function extracted from
 * MarkdownDisplay to enable useMemo keyed on text.
 *
 * Goals:
 *  1. Prove output equality for representative inputs (parsing is correct).
 *  2. Prove streaming correctness: incrementally-accumulated text parses
 *     identically to a single-shot parse of the final text.
 *  3. Cover edge cases: mid-stream code fences, tables at EOF, Windows \r\n.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdownLines } from './MarkdownDisplay.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate streaming: join partial chunks cumulatively and parse each step. */
function simulateStream(
  chunks: string[],
): Array<ReturnType<typeof parseMarkdownLines>> {
  const results: Array<ReturnType<typeof parseMarkdownLines>> = [];
  let accumulated = '';
  for (const chunk of chunks) {
    accumulated += chunk;
    results.push(parseMarkdownLines(accumulated));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Basic element parsing
// ---------------------------------------------------------------------------

describe('parseMarkdownLines', () => {
  it('returns empty array for empty string', () => {
    expect(parseMarkdownLines('')).toEqual([]);
  });

  it('parses a plain text paragraph', () => {
    const blocks = parseMarkdownLines('Hello, world.');
    expect(blocks).toEqual([{ type: 'text', text: 'Hello, world.' }]);
  });

  it('parses headers at all levels', () => {
    const text = '# H1\n## H2\n### H3\n#### H4';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      { type: 'header', level: 1, text: 'H1' },
      { type: 'header', level: 2, text: 'H2' },
      { type: 'header', level: 3, text: 'H3' },
      { type: 'header', level: 4, text: 'H4' },
    ]);
  });

  it('parses a closed code fence', () => {
    const text = '```js\nconst x = 1;\n```';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      {
        type: 'code',
        content: ['const x = 1;'],
        lang: 'js',
        open: false,
      },
    ]);
  });

  it('parses a code fence without language', () => {
    const text = '```\nplain\n```';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      { type: 'code', content: ['plain'], lang: null, open: false },
    ]);
  });

  it('marks an unclosed code fence as open (streaming case)', () => {
    const text = '```typescript\nlet y = 2;';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'code',
      lang: 'typescript',
      open: true,
    });
    expect((blocks[0] as { content: string[] }).content).toEqual(['let y = 2;']);
  });

  it('parses unordered list items', () => {
    const text = '- item A\n* item B\n+ item C';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      { type: 'ul', itemText: 'item A', marker: '-', leadingWhitespace: '' },
      { type: 'ul', itemText: 'item B', marker: '*', leadingWhitespace: '' },
      { type: 'ul', itemText: 'item C', marker: '+', leadingWhitespace: '' },
    ]);
  });

  it('parses ordered list items', () => {
    const text = '1. First\n2. Second';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      { type: 'ol', itemText: 'First', marker: '1', leadingWhitespace: '' },
      { type: 'ol', itemText: 'Second', marker: '2', leadingWhitespace: '' },
    ]);
  });

  it('parses a horizontal rule', () => {
    const blocks = parseMarkdownLines('---');
    expect(blocks).toEqual([{ type: 'hr' }]);
  });

  it('inserts a spacer block for blank lines between paragraphs', () => {
    const text = 'Para 1.\n\nPara 2.';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      { type: 'text', text: 'Para 1.' },
      { type: 'spacer' },
      { type: 'text', text: 'Para 2.' },
    ]);
  });

  it('does not insert consecutive spacer blocks for multiple blank lines', () => {
    const text = 'Para 1.\n\n\n\nPara 2.';
    const blocks = parseMarkdownLines(text);
    const spacers = blocks.filter((b) => b.type === 'spacer');
    expect(spacers).toHaveLength(1);
  });

  it('parses a table correctly', () => {
    const text =
      '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      {
        type: 'table',
        headers: ['A', 'B'],
        rows: [
          ['1', '2'],
          ['3', '4'],
        ],
      },
    ]);
  });

  it('parses a table at end of input (no trailing newline)', () => {
    const text = '| A | B |\n|---|---|\n| 1 | 2 |';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('table');
  });

  // ---------------------------------------------------------------------------
  // Windows \r\n line endings
  // ---------------------------------------------------------------------------

  it('handles Windows \\r\\n line endings for headers', () => {
    const text = '# Title\r\nsome text';
    const blocks = parseMarkdownLines(text);
    expect(blocks[0]).toEqual({ type: 'header', level: 1, text: 'Title' });
    expect(blocks[1]).toEqual({ type: 'text', text: 'some text' });
  });

  it('handles Windows \\r\\n line endings for code fences', () => {
    const text = '```js\r\nconst x = 1;\r\n```';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toEqual([
      { type: 'code', content: ['const x = 1;'], lang: 'js', open: false },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Streaming simulation: incremental accumulation must produce the same final
  // result as a single-shot parse of the complete text.
  // ---------------------------------------------------------------------------

  it('streaming accumulation: plain text produces same final result', () => {
    const fullText = 'Hello, world. This is a paragraph.';
    const chunks = ['Hello', ', world', '. This is', ' a paragraph.'];
    const streamResults = simulateStream(chunks);
    const finalStreamResult = streamResults[streamResults.length - 1];
    expect(finalStreamResult).toEqual(parseMarkdownLines(fullText));
  });

  it('streaming accumulation: code fence spanning chunks', () => {
    // The fence opener, body, and closer arrive in separate chunks
    const chunks = ['```js\n', 'const x = 1;\n', '```'];
    const streamResults = simulateStream(chunks);

    // After chunk 1: fence is open; the trailing \n produces an empty line in content
    expect(streamResults[0]).toEqual([
      { type: 'code', content: [''], lang: 'js', open: true },
    ]);

    // After chunk 2: fence is still open; trailing \n produces an empty line
    expect(streamResults[1]).toEqual([
      {
        type: 'code',
        content: ['const x = 1;', ''],
        lang: 'js',
        open: true,
      },
    ]);

    // After chunk 3: fence is closed
    const finalStreamResult = streamResults[2];
    expect(finalStreamResult).toEqual(
      parseMarkdownLines('```js\nconst x = 1;\n```'),
    );
    expect(finalStreamResult[0]).toMatchObject({ type: 'code', open: false });
  });

  it('streaming accumulation: mixed markdown final state matches single parse', () => {
    const fullText = [
      '# Title',
      '',
      'Some paragraph text.',
      '',
      '- item one',
      '- item two',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
      'End.',
    ].join('\n');

    // Simulate streaming character by character (worst case)
    const charChunks = fullText.split('');
    const streamResults = simulateStream(charChunks);
    const finalStreamResult = streamResults[streamResults.length - 1];
    const singleShotResult = parseMarkdownLines(fullText);

    expect(finalStreamResult).toEqual(singleShotResult);
  });

  it('streaming accumulation: table at end produces same result', () => {
    const fullText = '| H1 | H2 |\n|----|----|  \n| r1 | r2 |';
    const chunks = ['| H1 | H2 |\n', '|----|----|\n', '| r1 | r2 |'];
    const streamResults = simulateStream(chunks);
    const finalStreamResult = streamResults[streamResults.length - 1];
    expect(finalStreamResult).toEqual(parseMarkdownLines(fullText));
  });

  // ---------------------------------------------------------------------------
  // Nested list indentation
  // ---------------------------------------------------------------------------

  it('preserves leading whitespace for indented list items', () => {
    const text = '* Level 1\n  * Level 2\n    * Level 3';
    const blocks = parseMarkdownLines(text);
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as { leadingWhitespace: string }).leadingWhitespace).toBe('');
    expect((blocks[1] as { leadingWhitespace: string }).leadingWhitespace).toBe('  ');
    expect((blocks[2] as { leadingWhitespace: string }).leadingWhitespace).toBe('    ');
  });

  // ---------------------------------------------------------------------------
  // Mixed content
  // ---------------------------------------------------------------------------

  it('parses a realistic mixed-content markdown document', () => {
    const text = [
      '# Main Title',
      '',
      'Here is a paragraph.',
      '',
      '- List item 1',
      '- List item 2',
      '',
      '```',
      'some code',
      '```',
      '',
      'Another paragraph.',
    ].join('\n');

    const blocks = parseMarkdownLines(text);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      'header',
      'spacer',
      'text',
      'spacer',
      'ul',
      'ul',
      'spacer',
      'code',
      'spacer',
      'text',
    ]);
  });
});
