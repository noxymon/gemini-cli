# Implementation Plan: H10 — Memoize markdown parsing in the render path

## Issue Context

- **File**: `packages/cli/src/ui/utils/MarkdownDisplay.tsx`
- **Problem**: Every render re-runs `text.split(/\r?\n/)` plus per-line regex matching against 7 regex patterns. During streaming, a 10 KB response chunked every 100 ms re-parses the entire accumulated text 50+ times.
- **Impact**: HIGH — synchronous CPU on the render thread; blocks keystrokes 5–10 ms per update.

## Current State Analysis

### Parse Function Shape

`MarkdownDisplayInternal` (lines 31–315) is a React functional component that:
1. Receives `text: string` as a prop
2. Splits text on `\r?\n` (line 62)
3. Defines 7 regex patterns **inline inside the component body** (lines 63–69) — recreated on every render
4. Iterates lines and produces `contentBlocks: React.ReactNode[]`
5. Returns `<>{contentBlocks}</>`

### Props and State Dependencies

The parse logic depends on:
- `text` — the markdown string (primary key)
- `isPending` — affects `RenderCodeBlock` display but NOT the parse structure
- `availableTerminalHeight` — passed to `RenderCodeBlock`, NOT parse structure
- `terminalWidth` — passed to `RenderCodeBlock` and `RenderTable`, NOT parse structure
- `responseColor` — derived from `theme`, used when creating JSX nodes (interleaved with parse)
- `settings` and `isAlternateBuffer` — consumed by child components via hooks/context

### Child Components

- `RenderCodeBlock` (already `React.memo`) — receives `content`, `lang`, `isPending`, `availableTerminalHeight`, `terminalWidth`
- `RenderListItem` (already `React.memo`) — receives `itemText`, `type`, `marker`, `leadingWhitespace`
- `RenderTable` (already `React.memo`) — receives `headers`, `rows`, `terminalWidth`
- `RenderInline` (already `React.memo`) — receives `text`, `defaultColor`

### The Problem: Parse and Render Are Entangled

The current code mixes parsing and JSX construction in a single loop. The JSX nodes reference `isPending`, `availableTerminalHeight`, `terminalWidth`, and `responseColor` — so a naive `useMemo` on just the parse would still need to separate the parse data from the rendering.

## Memoization Strategy

### Chosen Approach: Two-Phase — Parse to AST, then `useMemo` for JSX

**Phase 1**: Extract a pure parse function `parseMarkdownLines(text: string)` that returns a typed AST (array of `MarkdownBlock` union types). This is pure: depends only on `text`.

**Phase 2**: Memoize the JSX construction with `useMemo` keyed on `[parsedBlocks, isPending, availableTerminalHeight, terminalWidth, responseColor, isAlternateBuffer, settings]`. But since `parsedBlocks` is stable-by-reference when `text` hasn't changed (due to its own `useMemo`), the JSX memo will correctly skip re-renders.

### Why Not LRU/WeakMap?

- **LRU**: Overkill here; there's typically one active streaming response at a time. LRU helps cross-component scenarios; `useMemo` is sufficient for single-instance streaming.
- **WeakMap**: Strings are primitives — not WeakMap keys. Would need to box strings.
- **Module-level Map**: Would persist across component unmount/remount cycles and could leak memory. Not needed for this use case.
- **Incremental parse**: Possible but complex. Mid-stream, text grows by appending. However, code fences can span chunks, so incremental parsing would need to carry forward "fence open" state. The `useMemo` approach already avoids re-parse when `text` is unchanged — the chunk-by-chunk nature means `text` only changes when a new chunk arrives, at which point we do need to re-parse. Incremental is a follow-up optimization.

### Regex Hoisting

All 7 regex patterns are defined inside the component body and recreated on every render. They will be hoisted to module scope as `const`.

## Concrete Code Changes

### File: `packages/cli/src/ui/utils/MarkdownDisplay.tsx`

#### Change 1: Hoist regex constants to module scope

Move lines 63–69 (the 7 regex definitions) above the component definition, alongside the existing module-level constants.

#### Change 2: Define a typed AST for parsed blocks

Add a `MarkdownBlock` union type and a `parseMarkdownLines(text: string): MarkdownBlock[]` pure function.

Block types needed:
- `CodeFenceBlock` — `{ type: 'code', content: string[], lang: string | null }`
- `HeaderBlock` — `{ type: 'header', level: number, text: string }`
- `UlItemBlock` — `{ type: 'ul', itemText: string, marker: string, leadingWhitespace: string }`
- `OlItemBlock` — `{ type: 'ol', itemText: string, marker: string, leadingWhitespace: string }`
- `HrBlock` — `{ type: 'hr' }`
- `TableBlock` — `{ type: 'table', headers: string[], rows: string[][] }`
- `TextBlock` — `{ type: 'text', text: string }`
- `SpacerBlock` — `{ type: 'spacer' }`

#### Change 3: Memoize the parse

```tsx
const parsedBlocks = useMemo(() => parseMarkdownLines(text), [text]);
```

#### Change 4: Render JSX from parsed blocks

Replace the current inline parse+render loop with a separate rendering pass over `parsedBlocks`. The JSX construction can also be wrapped in `useMemo` or left as a direct map (it will be fast since no regex is re-run).

## Edge Cases

- **Mid-stream code fence**: When stream is mid-fence, `parseMarkdownLines` will emit an open `CodeFenceBlock` (marked pending). The `RenderCodeBlock` already handles pending display.
- **Table at end of input**: Handle in the parse function — flush open table at end.
- **Windows `\r\n` line endings**: Already handled by `split(/\r?\n/)`, preserved.
- **Multiple empty lines**: Collapse to single spacer block, matching current behavior.

## Unit Test Strategy

Add tests to `MarkdownDisplay.test.tsx`:

1. **Streaming simulation test**: Build text incrementally (simulate chunks), verify the final rendered output equals a single-shot parse of the complete text.
2. **Code fence spanning chunks**: Stream `\`\`\`js\n` in one chunk, `const x = 1;\n` in another, `\`\`\`` in a third — verify closed code block renders correctly.
3. **Memoization proof**: Spy on `parseMarkdownLines` (once extracted) to verify it is not called when `text` prop is unchanged but other props change.

## Verification

```bash
cd /c/Users/USER/Documents/Code/gemini-cli/.claude/worktrees/agent-a6074d3f14958cc21
npm run typecheck --workspace=@google/gemini-cli
npm run lint --workspace=@google/gemini-cli
npm test --workspace=@google/gemini-cli
```
