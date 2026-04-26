/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../semantic-colors.js';
import { colorizeCode } from './CodeColorizer.js';
import { TableRenderer } from './TableRenderer.js';
import { RenderInline } from './InlineMarkdownRenderer.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';

interface MarkdownDisplayProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  renderMarkdown?: boolean;
}

// Constants for Markdown parsing and rendering

const EMPTY_LINE_HEIGHT = 1;
const CODE_BLOCK_PREFIX_PADDING = 1;
const LIST_ITEM_PREFIX_PADDING = 1;
const LIST_ITEM_TEXT_FLEX_GROW = 1;

// Regex constants hoisted to module scope — created once, not per-render.
const HEADER_REGEX = /^ *(#{1,4}) +(.*)/;
const CODE_FENCE_REGEX = /^ *(`{3,}|~{3,}) *(\w*?) *$/;
const UL_ITEM_REGEX = /^([ \t]*)([-*+]) +(.*)/;
const OL_ITEM_REGEX = /^([ \t]*)(\d+)\. +(.*)/;
const HR_REGEX = /^ *([-*_] *){3,} *$/;
const TABLE_ROW_REGEX = /^\s*\|(.+)\|\s*$/;
const TABLE_SEPARATOR_REGEX =
  /^\s*\|?\s*(:?-+:?)\s*(\|\s*(:?-+:?)\s*)+\|?\s*$/;

// ---------------------------------------------------------------------------
// Markdown AST types
// ---------------------------------------------------------------------------

interface CodeFenceBlock {
  type: 'code';
  content: string[];
  lang: string | null;
  /** True when the fence was not closed before end-of-input (streaming). */
  open: boolean;
}

interface HeaderBlock {
  type: 'header';
  level: number;
  text: string;
}

interface UlItemBlock {
  type: 'ul';
  itemText: string;
  marker: string;
  leadingWhitespace: string;
}

interface OlItemBlock {
  type: 'ol';
  itemText: string;
  marker: string;
  leadingWhitespace: string;
}

interface HrBlock {
  type: 'hr';
}

interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface SpacerBlock {
  type: 'spacer';
}

type MarkdownBlock =
  | CodeFenceBlock
  | HeaderBlock
  | UlItemBlock
  | OlItemBlock
  | HrBlock
  | TableBlock
  | TextBlock
  | SpacerBlock;

// ---------------------------------------------------------------------------
// Pure parse function — depends only on `text`; safe to memoize by text value.
// ---------------------------------------------------------------------------

export function parseMarkdownLines(text: string): MarkdownBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let lastBlockEmpty = true;

  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang: string | null = null;
  let codeBlockFence = '';

  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  function pushBlock(block: MarkdownBlock) {
    blocks.push(block);
    lastBlockEmpty = false;
  }

  function flushTable() {
    if (inTable && tableHeaders.length > 0 && tableRows.length > 0) {
      pushBlock({ type: 'table', headers: tableHeaders, rows: tableRows });
    }
    inTable = false;
    tableHeaders = [];
    tableRows = [];
  }

  lines.forEach((line, index) => {
    if (inCodeBlock) {
      const fenceMatch = line.match(CODE_FENCE_REGEX);
      if (
        fenceMatch &&
        fenceMatch[1].startsWith(codeBlockFence[0]) &&
        fenceMatch[1].length >= codeBlockFence.length
      ) {
        // Closing fence
        pushBlock({
          type: 'code',
          content: codeBlockContent,
          lang: codeBlockLang,
          open: false,
        });
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = null;
        codeBlockFence = '';
      } else {
        codeBlockContent.push(line);
      }
      return;
    }

    const codeFenceMatch = line.match(CODE_FENCE_REGEX);
    const headerMatch = line.match(HEADER_REGEX);
    const ulMatch = line.match(UL_ITEM_REGEX);
    const olMatch = line.match(OL_ITEM_REGEX);
    const hrMatch = line.match(HR_REGEX);
    const tableRowMatch = line.match(TABLE_ROW_REGEX);
    const tableSeparatorMatch = line.match(TABLE_SEPARATOR_REGEX);

    if (codeFenceMatch) {
      // End any open table before starting a code block
      flushTable();
      inCodeBlock = true;
      codeBlockFence = codeFenceMatch[1];
      codeBlockLang = codeFenceMatch[2] || null;
    } else if (tableRowMatch && !inTable) {
      // Potential table start — check if next line is separator
      if (
        index + 1 < lines.length &&
        lines[index + 1].match(TABLE_SEPARATOR_REGEX)
      ) {
        inTable = true;
        tableHeaders = tableRowMatch[1].split('|').map((cell) => cell.trim());
        tableRows = [];
      } else {
        // Not a table — treat as regular text
        pushBlock({ type: 'text', text: line });
      }
    } else if (inTable && tableSeparatorMatch) {
      // Skip separator line — already handled
    } else if (inTable && tableRowMatch) {
      // Add table row
      const cells = tableRowMatch[1].split('|').map((cell) => cell.trim());
      // Ensure row has same column count as headers
      while (cells.length < tableHeaders.length) {
        cells.push('');
      }
      if (cells.length > tableHeaders.length) {
        cells.length = tableHeaders.length;
      }
      tableRows.push(cells);
    } else if (inTable && !tableRowMatch) {
      // End of table
      flushTable();

      // Process current line as normal text
      if (line.trim().length > 0) {
        pushBlock({ type: 'text', text: line });
      }
    } else if (hrMatch) {
      pushBlock({ type: 'hr' });
    } else if (headerMatch) {
      pushBlock({
        type: 'header',
        level: headerMatch[1].length,
        text: headerMatch[2],
      });
    } else if (ulMatch) {
      pushBlock({
        type: 'ul',
        leadingWhitespace: ulMatch[1],
        marker: ulMatch[2],
        itemText: ulMatch[3],
      });
    } else if (olMatch) {
      pushBlock({
        type: 'ol',
        leadingWhitespace: olMatch[1],
        marker: olMatch[2],
        itemText: olMatch[3],
      });
    } else {
      // Plain text or empty line
      if (line.trim().length === 0) {
        if (!lastBlockEmpty) {
          blocks.push({ type: 'spacer' });
          lastBlockEmpty = true;
        }
      } else {
        pushBlock({ type: 'text', text: line });
      }
    }
  });

  // Flush any open code block (streaming: fence not yet closed)
  if (inCodeBlock) {
    pushBlock({
      type: 'code',
      content: codeBlockContent,
      lang: codeBlockLang,
      open: true,
    });
  }

  // Flush any open table (table at end of input)
  flushTable();

  return blocks;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MarkdownDisplayInternal: React.FC<MarkdownDisplayProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
  renderMarkdown = true,
}) => {
  // All hooks must be called unconditionally, before any early returns.
  const settings = useSettings();
  const isAlternateBuffer = useAlternateBuffer();
  const responseColor = theme.text.response ?? theme.text.primary;

  // Memoize the pure parse step — re-runs only when `text` changes.
  const parsedBlocks = useMemo(
    () => (text && renderMarkdown ? parseMarkdownLines(text) : []),
    [text, renderMarkdown],
  );

  // Memoize the JSX construction — re-runs when parse result or display
  // parameters change, but NOT on every parent re-render.
  const contentBlocks = useMemo(() => {
    const nodes: React.ReactNode[] = [];

    parsedBlocks.forEach((block, index) => {
      const key = `block-${index}`;

      switch (block.type) {
        case 'code':
          nodes.push(
            <RenderCodeBlock
              key={key}
              content={block.content}
              lang={block.lang}
              isPending={isPending}
              availableTerminalHeight={
                isAlternateBuffer ? undefined : availableTerminalHeight
              }
              terminalWidth={terminalWidth}
            />,
          );
          break;

        case 'header': {
          let headerNode: React.ReactNode = null;
          switch (block.level) {
            case 1:
            case 2:
              headerNode = (
                <Text bold color={theme.text.link}>
                  <RenderInline
                    text={block.text}
                    defaultColor={theme.text.link}
                  />
                </Text>
              );
              break;
            case 3:
              headerNode = (
                <Text bold color={responseColor}>
                  <RenderInline text={block.text} defaultColor={responseColor} />
                </Text>
              );
              break;
            case 4:
              headerNode = (
                <Text italic color={theme.text.secondary}>
                  <RenderInline
                    text={block.text}
                    defaultColor={theme.text.secondary}
                  />
                </Text>
              );
              break;
            default:
              headerNode = (
                <Text color={responseColor}>
                  <RenderInline text={block.text} defaultColor={responseColor} />
                </Text>
              );
              break;
          }
          if (headerNode) nodes.push(<Box key={key}>{headerNode}</Box>);
          break;
        }

        case 'ul':
          nodes.push(
            <RenderListItem
              key={key}
              itemText={block.itemText}
              type="ul"
              marker={block.marker}
              leadingWhitespace={block.leadingWhitespace}
            />,
          );
          break;

        case 'ol':
          nodes.push(
            <RenderListItem
              key={key}
              itemText={block.itemText}
              type="ol"
              marker={block.marker}
              leadingWhitespace={block.leadingWhitespace}
            />,
          );
          break;

        case 'hr':
          nodes.push(
            <Box key={key}>
              <Text dimColor>---</Text>
            </Box>,
          );
          break;

        case 'table':
          nodes.push(
            <RenderTable
              key={key}
              headers={block.headers}
              rows={block.rows}
              terminalWidth={terminalWidth}
            />,
          );
          break;

        case 'text':
          nodes.push(
            <Box key={key}>
              <Text wrap="wrap" color={responseColor}>
                <RenderInline text={block.text} defaultColor={responseColor} />
              </Text>
            </Box>,
          );
          break;

        case 'spacer':
          nodes.push(<Box key={key} height={EMPTY_LINE_HEIGHT} />);
          break;

        default:
          break;
      }
    });

    return nodes;
  }, [
    parsedBlocks,
    isPending,
    availableTerminalHeight,
    terminalWidth,
    responseColor,
    isAlternateBuffer,
  ]);

  if (!text) return <></>;

  // Raw markdown mode - display syntax-highlighted markdown without rendering
  if (!renderMarkdown) {
    // Hide line numbers in raw markdown mode as they are confusing due to chunked output
    const colorizedMarkdown = colorizeCode({
      code: text,
      language: 'markdown',
      availableHeight: isAlternateBuffer ? undefined : availableTerminalHeight,
      maxWidth: terminalWidth - CODE_BLOCK_PREFIX_PADDING,
      settings,
      hideLineNumbers: true,
    });
    return (
      <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
        {colorizedMarkdown}
      </Box>
    );
  }

  return <>{contentBlocks}</>;
};

// Helper functions (adapted from static methods of MarkdownRenderer)

interface RenderCodeBlockProps {
  content: string[];
  lang: string | null;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const RenderCodeBlockInternal: React.FC<RenderCodeBlockProps> = ({
  content,
  lang,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const settings = useSettings();
  const isAlternateBuffer = useAlternateBuffer();
  const MIN_LINES_FOR_MESSAGE = 1; // Minimum lines to show before the "generating more" message
  const RESERVED_LINES = 2; // Lines reserved for the message itself and potential padding

  // When not in alternate buffer mode we need to be careful that we don't
  // trigger flicker when the pending code is too long to fit in the terminal
  if (
    !isAlternateBuffer &&
    isPending &&
    availableTerminalHeight !== undefined
  ) {
    const MAX_CODE_LINES_WHEN_PENDING = Math.max(
      0,
      availableTerminalHeight - RESERVED_LINES,
    );

    if (content.length > MAX_CODE_LINES_WHEN_PENDING) {
      if (MAX_CODE_LINES_WHEN_PENDING < MIN_LINES_FOR_MESSAGE) {
        // Not enough space to even show the message meaningfully
        return (
          <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING}>
            <Text color={theme.text.secondary}>
              ... code is being written ...
            </Text>
          </Box>
        );
      }
      const truncatedContent = content.slice(0, MAX_CODE_LINES_WHEN_PENDING);
      const colorizedTruncatedCode = colorizeCode({
        code: truncatedContent.join('\n'),
        language: lang,
        availableHeight: availableTerminalHeight,
        maxWidth: terminalWidth - CODE_BLOCK_PREFIX_PADDING,
        settings,
      });
      return (
        <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
          {colorizedTruncatedCode}
          <Text color={theme.text.secondary}>... generating more ...</Text>
        </Box>
      );
    }
  }

  const fullContent = content.join('\n');
  const colorizedCode = colorizeCode({
    code: fullContent,
    language: lang,
    availableHeight: isAlternateBuffer ? undefined : availableTerminalHeight,
    maxWidth: terminalWidth - CODE_BLOCK_PREFIX_PADDING,
    settings,
  });

  return (
    <Box
      paddingLeft={CODE_BLOCK_PREFIX_PADDING}
      flexDirection="column"
      width={terminalWidth}
      flexShrink={0}
    >
      {colorizedCode}
    </Box>
  );
};

const RenderCodeBlock = React.memo(RenderCodeBlockInternal);

interface RenderListItemProps {
  itemText: string;
  type: 'ul' | 'ol';
  marker: string;
  leadingWhitespace?: string;
}

const RenderListItemInternal: React.FC<RenderListItemProps> = ({
  itemText,
  type,
  marker,
  leadingWhitespace = '',
}) => {
  const prefix = type === 'ol' ? `${marker}. ` : `${marker} `;
  const prefixWidth = prefix.length;
  // Account for leading whitespace (indentation level) plus the standard prefix padding
  const indentation = leadingWhitespace.length;
  const listResponseColor = theme.text.response ?? theme.text.primary;

  return (
    <Box
      paddingLeft={indentation + LIST_ITEM_PREFIX_PADDING}
      flexDirection="row"
    >
      <Box width={prefixWidth} flexShrink={0}>
        <Text color={listResponseColor}>{prefix}</Text>
      </Box>
      <Box flexGrow={LIST_ITEM_TEXT_FLEX_GROW}>
        <Text wrap="wrap" color={listResponseColor}>
          <RenderInline text={itemText} defaultColor={listResponseColor} />
        </Text>
      </Box>
    </Box>
  );
};

const RenderListItem = React.memo(RenderListItemInternal);

interface RenderTableProps {
  headers: string[];
  rows: string[][];
  terminalWidth: number;
}

const RenderTableInternal: React.FC<RenderTableProps> = ({
  headers,
  rows,
  terminalWidth,
}) => (
  <TableRenderer headers={headers} rows={rows} terminalWidth={terminalWidth} />
);

const RenderTable = React.memo(RenderTableInternal);

export const MarkdownDisplay = React.memo(MarkdownDisplayInternal);
