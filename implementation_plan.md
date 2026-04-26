# H12 Implementation Plan — Move clipboard paste off the keystroke path

## 1. Summary of current paste flow

### Two paste code paths exist in `InputPrompt.tsx`

**Path A — Ctrl+V / right-click (`handleClipboardPaste`, lines 513–578)**

1. `handleClipboardPaste` is an `async` callback created with `useCallback`.
2. It is invoked at line 1302 (`handleClipboardPaste()`) via
   `// eslint-disable-next-line @typescript-eslint/no-floating-promises` — the
   promise is fire-and-forget, inside the synchronous `handleInput` keystroke
   handler.
3. Inside the callback:
   - `clipboardHasImage()` is awaited (may call
     `osascript`/`powershell`/`wl-paste` — slow).
   - If an image is found, `saveClipboardImage()` is awaited (spawns a child
     process + fs write).
   - `cleanupOldClipboardImages()` is also called (fire-and-forget internally).
   - If text, `clipboardy.read()` is awaited (IPC to native helper).
4. Because `handleClipboardPaste` is fire-and-forget within the synchronous
   handler, multiple rapid Ctrl+V presses launch multiple concurrent async
   operations. Each awaits independently; results land in the buffer in
   arbitrary order.
5. Right-click (line 657) similarly calls `handleClipboardPaste()`
   fire-and-forget.

**Path B — Bracketed paste / raw paste events (`key.name === 'paste'`, lines
795–838)**

1. When `key.name === 'paste'` is detected in `handleInput`, the paste content
   is already in `key.sequence` (provided by the H1 fix in `KeypressContext.tsx`
   in the sibling worktree).
2. The 40 ms timeout band-aid (`pasteTimeoutRef.current`) sets
   `recentUnsafePasteTime` to prevent accidental submit.
3. The buffer is updated synchronously via `buffer.handleInput(key)`.
4. This path is already fast. No async work. The H1 fix in `fix-ui-hang/`
   (batching printable characters) lives in `KeypressContext.tsx` and makes this
   path faster by coalescing characters into a single 'paste' event.

**Root problem for H12** is Path A only:

- `handleClipboardPaste()` blocks the next render because even though it is
  "async", its _first await_ (`clipboardHasImage()`) stalls the microtask queue
  while the OS IPC round-trip completes.
- If a user hits Ctrl+V twice quickly, two concurrent operations race. The
  second write to `buffer` from whichever finishes last will overwrite the
  first.
- The image save path is especially expensive: spawning
  `powershell`/`osascript` + file I/O.

## 2. Proposed changes

### (a) Burst debounce / coalesce for Ctrl+V

**Problem**: Two Ctrl+V presses within ~40 ms launch two independent async
flows.

**Solution**: Use a version token (monotonically incrementing integer in a
`useRef`) rather than a debounce timer. A debounce timer would delay the _first_
paste which hurts responsiveness. A version token lets the first paste start
immediately but discards the result if a newer request has been issued.

```
pasteVersionRef = useRef<number>(0)
```

At the start of `handleClipboardPaste`:

```ts
pasteVersionRef.current += 1;
const myVersion = pasteVersionRef.current;
```

Before any `buffer.insert` / `buffer.replaceRangeByOffset` call inside the async
flow:

```ts
if (pasteVersionRef.current !== myVersion) return; // superseded
```

This means:

- Paste 1 starts, increments token to 1, captures `myVersion = 1`.
- Paste 2 arrives, increments token to 2, captures `myVersion = 2`.
- Paste 1 finishes its async work, checks `pasteVersionRef.current === 2 !== 1`,
  discards its result. No double-insert.
- Paste 2 finishes, checks `pasteVersionRef.current === 2 === 2`, inserts its
  result.

This is simpler and lower-overhead than `AbortController` (no need to cancel the
OS IPC; it will finish in the background harmlessly — we just discard the stale
result).

### (b) Cancellation for superseded `clipboardy.read()` calls

The version-token approach from (a) handles this automatically. After
`await clipboardy.read()` resolves, we check the token. If a newer paste has
already been requested, we skip the buffer insert. The OS-level
`clipboardy.read()` still runs to completion in the background, but its result
is discarded. This is acceptable because:

1. `clipboardy.read()` is fast (< 10 ms typically).
2. The extra background IPC is harmless.
3. Introducing `AbortController` to cancel `clipboardy.read()` would require
   changes to `clipboardy` internals which is out of scope.

If true cancellation is needed in a future iteration, wrapping
`clipboardy.read()` in a `Promise.race` with an abort signal can be added later.

### (c) Move image save off the keystroke path

**Problem**: `saveClipboardImage()` spawns a child process and writes a file.
This can take 200–500 ms.

**Solution**: Insert a placeholder immediately, then update it asynchronously.

**Phase 1 (sync, immediate)**: If clipboard has image, insert a placeholder
string like `@<pasting-image…>` at the cursor position. This gives the user
immediate visual feedback.

**Phase 2 (async, off-path)**: After `saveClipboardImage()` resolves:

1. Check the version token — if superseded, remove the placeholder and return.
2. Replace the placeholder text with the actual `@relative/path/to/image`.

Implementation detail:

- Store the placeholder and its offset in a local variable within the async
  closure.
- Use `buffer.replaceRangeByOffset(placeholderStart, placeholderEnd, finalText)`
  to atomically swap placeholder → final path.

**The `clipboardHasImage()` check is still on the critical path** because we
can't insert a placeholder without knowing whether the clipboard has an image.
However, `clipboardHasImage()` is typically fast (< 50 ms on macOS, 100 ms on
Windows). We can move it fully async by always starting the async operation and
having no synchronous work beyond dismissing the shortcuts help panel. The
version token ensures correctness.

### (d) Keep the visible buffer responsive while background work is in-flight

For **text paste** (the common case):

- `clipboardy.read()` is fast. We await it and insert. No placeholder needed.
- After the version-token check passes,
  `buffer.insert(escapedText, { paste: true })` is called. The render loop will
  pick this up on the next tick.

For **image paste**:

- Insert `@<pasting-image…> ` immediately as a placeholder at the cursor
  position. The user sees feedback right away.
- When `saveClipboardImage()` resolves, replace the placeholder with the real
  path.
- If the paste is cancelled (version token changed), remove the placeholder.

## 3. Files to modify

| File                                                  | Change                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/cli/src/ui/components/InputPrompt.tsx`      | Add `pasteVersionRef`, modify `handleClipboardPaste` with version-token guard + placeholder strategy |
| `packages/cli/src/ui/components/InputPrompt.test.tsx` | Add tests for: rapid double Ctrl+V, image paste placeholder, superseded paste discard                |

No other files need to change. The `clipboardUtils.ts` functions
(`clipboardHasImage`, `saveClipboardImage`) remain unchanged — they are already
async helpers.

## 4. Edge-case handling table

| Edge case                                      | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paste mid-typing (cursor not at end)           | `buffer.getOffset()` is captured at the start of the async function, _before_ any await. The placeholder is inserted at that offset. After async completion, the placeholder is replaced at the stored offset range. If the user has moved the cursor between the paste and the async completion, the placeholder text is already in the buffer at the original position; the `replaceRangeByOffset` will find and replace it correctly. |
| Paste of 1+ MB of text                         | `clipboardy.read()` returns the full text; `buffer.insert(text, { paste: true })` is called once. The existing `isLargePaste` check then shows the expand hint. No special handling needed beyond the version-token guard.                                                                                                                                                                                                               |
| Paste of an image                              | Placeholder `@<pasting-image…> ` inserted synchronously. Image saved async, placeholder replaced. If image save fails, placeholder is removed.                                                                                                                                                                                                                                                                                           |
| Two pastes in < 40 ms                          | Version token increments to 2 on second paste. Paste 1's async work completes, finds `myVersion=1 !== currentVersion=2`, discards. Paste 2's result lands in buffer. Only the most recent clipboard content is inserted.                                                                                                                                                                                                                 |
| Race between burst end and next stream chunk   | The buffer mutation happens in `buffer.replaceRangeByOffset` / `buffer.insert`. These are already safe with the text buffer's existing synchronous state model. The async completion lands in the event loop after any pending synchronous work, which is correct.                                                                                                                                                                       |
| Right-click paste (useMouse handler, line 657) | Same `handleClipboardPaste` is called; same version-token guard applies.                                                                                                                                                                                                                                                                                                                                                                 |
| `useOSC52Paste` path                           | No change needed; this path just writes a terminal escape sequence synchronously (no `clipboardy.read()`). Version token guard is placed after this path to avoid interfering.                                                                                                                                                                                                                                                           |

## 5. Risk mitigation

| Risk                                                                            | Mitigation                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost paste content                                                              | Version token only discards the _older_ paste when two arrive in quick succession. The _latest_ paste (most recent clipboard content) always wins. This is the semantically correct behavior — the user's last Ctrl+V reflects what they most recently copied. |
| Race: placeholder left in buffer if image save fails                            | Wrap `saveClipboardImage()` in a try/catch; on failure, remove the placeholder via `buffer.replaceRangeByOffset(placeholderStart, placeholderEnd, '')`.                                                                                                        |
| Race: buffer positions shift between placeholder insert and placeholder replace | The placeholder is a fixed-width string. `buffer.replaceRangeByOffset(start, start + placeholderLen, finalText)` works even if the user has typed more text after the placeholder, because it targets the exact byte range, not a cursor position.             |
| Clipboard read completing after component unmount                               | Add a `mountedRef = useRef(true)` that is set to `false` in a cleanup effect. Check `mountedRef.current` before any `buffer` mutation in the async callback.                                                                                                   |

## 6. Code sketch

### New refs

```ts
// At the top of InputPrompt, alongside pasteTimeoutRef:
const pasteVersionRef = useRef<number>(0);
const mountedRef = useRef(true);

useEffect(() => {
  mountedRef.current = true;
  return () => {
    mountedRef.current = false;
  };
}, []);
```

### Modified `handleClipboardPaste`

```ts
const handleClipboardPaste = useCallback(async () => {
  if (shortcutsHelpVisible) {
    setShortcutsHelpVisible(false);
  }

  // Increment version token — any in-flight paste with an older token is superseded.
  pasteVersionRef.current += 1;
  const myVersion = pasteVersionRef.current;

  // Helper: check if this paste is still the most recent one and component is mounted.
  const isCurrentPaste = () =>
    mountedRef.current && pasteVersionRef.current === myVersion;

  try {
    if (await clipboardHasImage()) {
      // Guard after async clipboardHasImage check
      if (!isCurrentPaste()) return;

      // Phase 1: Insert placeholder immediately for visual feedback
      const PLACEHOLDER = '@<pasting-image…> ';
      const offset = buffer.getOffset();
      const currentText = buffer.text;

      let placeholderText = PLACEHOLDER;
      const charBefore = offset > 0 ? currentText[offset - 1] : '';
      if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
        placeholderText = ' ' + placeholderText;
      }
      buffer.replaceRangeByOffset(offset, offset, placeholderText);
      const placeholderStart = offset;
      const placeholderEnd = offset + placeholderText.length;

      // Phase 2: Save image asynchronously (off the critical render path)
      // Use setImmediate/Promise.resolve to yield to the renderer before the spawn
      await Promise.resolve(); // yield one microtask tick

      if (!isCurrentPaste()) {
        // Remove placeholder if superseded
        buffer.replaceRangeByOffset(placeholderStart, placeholderEnd, '');
        return;
      }

      let imagePath: string | null = null;
      try {
        imagePath = await saveClipboardImage(config.getTargetDir());
      } catch {
        // save failed
      }

      if (!isCurrentPaste()) {
        // Remove placeholder — newer paste is handling the buffer
        buffer.replaceRangeByOffset(placeholderStart, placeholderEnd, '');
        return;
      }

      if (imagePath) {
        // Clean up old images (fire-and-forget, already was)
        cleanupOldClipboardImages(config.getTargetDir()).catch(() => {});

        const relativePath = path.relative(config.getTargetDir(), imagePath);
        const insertText = `@${relativePath} `;
        // Replace placeholder with the real path
        buffer.replaceRangeByOffset(
          placeholderStart,
          placeholderEnd,
          insertText,
        );
      } else {
        // Image save failed — remove placeholder
        buffer.replaceRangeByOffset(placeholderStart, placeholderEnd, '');
      }
      return; // Don't fall through to text paste
    }

    // Guard after async clipboardHasImage check (no image)
    if (!isCurrentPaste()) return;

    if (settings.experimental?.useOSC52Paste) {
      stdout.write('\x1b]52;c;?\x07');
    } else {
      const textToInsert = await clipboardy.read();

      // Guard after async clipboardy.read()
      if (!isCurrentPaste()) return;

      const escapedText = settings.ui?.escapePastedAtSymbols
        ? escapeAtSymbols(textToInsert)
        : textToInsert;
      buffer.insert(escapedText, { paste: true });

      if (isLargePaste(textToInsert)) {
        appEvents.emit(AppEvent.TransientMessage, {
          message: `Press ${formatCommand(Command.EXPAND_PASTE)} to expand pasted text`,
          type: TransientMessageType.Hint,
        });
      }
    }
  } catch (error) {
    debugLogger.error('Error handling paste:', error);
  }
}, [
  buffer,
  config,
  stdout,
  settings,
  shortcutsHelpVisible,
  setShortcutsHelpVisible,
  // pasteVersionRef and mountedRef are refs, no need in dep array
]);
```

### Cleanup effect

```ts
// Add alongside the existing pasteTimeoutRef cleanup effect:
useEffect(() => {
  mountedRef.current = true;
  return () => {
    mountedRef.current = false;
  };
}, []);
```

### New tests in `InputPrompt.test.tsx`

```ts
describe('handleClipboardPaste — H12 optimizations', () => {
  it('discards superseded paste when Ctrl+V is pressed twice rapidly', async () => {
    // Arrange: clipboardy.read is slow first time, fast second time
    let resolveFirst: (v: string) => void;
    const firstRead = new Promise<string>((r) => {
      resolveFirst = r;
    });
    vi.mocked(clipboardy.read)
      .mockReturnValueOnce(firstRead) // first call - slow
      .mockResolvedValueOnce('second paste content'); // second call - fast

    vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(false);

    // Act: fire two Ctrl+V presses
    fireCtrlV(); // starts first paste (still in-flight)
    await Promise.resolve(); // yield
    fireCtrlV(); // starts second paste, increments version token

    // Let second paste complete
    await act(async () => {
      await Promise.resolve();
    });

    // Now resolve the first paste (late)
    resolveFirst!('first paste content (stale)');
    await act(async () => {
      await Promise.resolve();
    });

    // Only second paste should be in buffer
    expect(mockBuffer.insert).toHaveBeenCalledTimes(1);
    expect(mockBuffer.insert).toHaveBeenCalledWith('second paste content', {
      paste: true,
    });
  });

  it('inserts image placeholder immediately then replaces with real path', async () => {
    // Arrange
    vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(true);
    let resolveSave: (v: string) => void;
    vi.mocked(clipboardUtils.saveClipboardImage).mockReturnValue(
      new Promise((r) => {
        resolveSave = r;
      }),
    );

    // Act
    fireCtrlV();
    await act(async () => {
      await Promise.resolve();
    });

    // Assert placeholder is inserted immediately
    expect(mockBuffer.replaceRangeByOffset).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.stringContaining('@<pasting-image'),
    );

    // Resolve the save
    resolveSave!('/tmp/images/clipboard-123.png');
    await act(async () => {
      await Promise.resolve();
    });

    // Assert placeholder replaced with real path
    expect(mockBuffer.replaceRangeByOffset).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.stringMatching(/@clipboard-123\.png/),
    );
  });

  it('removes image placeholder if save fails', async () => {
    vi.mocked(clipboardUtils.clipboardHasImage).mockResolvedValue(true);
    vi.mocked(clipboardUtils.saveClipboardImage).mockResolvedValue(null);

    fireCtrlV();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Placeholder inserted then removed (replace with empty string)
    const calls = vi.mocked(mockBuffer.replaceRangeByOffset).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[2]).toBe('');
  });
});
```

## 7. Implementation steps (in order)

1. Add `pasteVersionRef` and `mountedRef` refs.
2. Add `mountedRef` cleanup `useEffect`.
3. Rewrite `handleClipboardPaste` with the version-token guard and placeholder
   strategy.
4. Add new tests in `InputPrompt.test.tsx`.
5. Run `npm run typecheck`, `npm run lint`,
   `npm run test --workspace=packages/cli -- InputPrompt`.
6. Commit.

## 8. Relation to H1 fix (`fix-ui-hang/`)

The H1 fix (in `fix-ui-hang/packages/cli/src/ui/contexts/KeypressContext.tsx`)
batches printable characters during raw paste to produce a single
`key.name === 'paste'` event instead of thousands of individual character
events. This removes the render-loop freeze for _bracketed paste and raw paste_
(Path B above).

H12 is complementary: it fixes the _Ctrl+V / right-click_ path (Path A above)
by:

- Preventing concurrent `clipboardy.read()` calls from racing.
- Moving image save off the synchronous path with a placeholder.
- Adding a mount guard to prevent post-unmount buffer mutations.

The two fixes do not conflict. If both are applied, all paste paths are
optimized. H12 can be applied independently of H1.
