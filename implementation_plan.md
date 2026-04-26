# Implementation Plan: H11 — Stop re-rendering `pendingHistoryItems` on every chunk

## Issue Context

- **Path**: `packages/cli/src/ui/components/MainContent.tsx:154-203`
- **Problem**: `pendingItems` `useMemo` depends on `uiState.history`, so a
  text-only append to a pending item still rebuilds the whole element list.
  Indices, not stable IDs, are used as React keys, defeating reconciliation.
- **Impact**: HIGH — same streaming hot path as H9/H10.
- **Effort**: S — stable keys; tighter memo deps; consider `React.memo` on
  `HistoryItemDisplay`.

---

## Inventory of Current Code

### Where `pendingItems` is built

`MainContent.tsx` lines 154–203:

```tsx
const pendingItems = useMemo(
  () => (
    <Box flexDirection="column" key="pending-items-group">
      {pendingHistoryItems.map((item, i) => {
        const prevType =
          i === 0
            ? uiState.history.at(-1)?.type   // <--- reads uiState.history
            : pendingHistoryItems[i - 1]?.type;
        ...
        return (
          <HistoryItemDisplay
            key={`pending-${i}`}            // <--- index-based key
            item={{ ...item, id: -(i + 1) }} // <--- synthetic, unstable id
            ...
          />
        );
      })}
      ...
    </Box>
  ),
  [
    pendingHistoryItems,
    uiState.constrainHeight,
    availableTerminalHeight,
    mainAreaWidth,
    showConfirmationQueue,
    confirmingTool,
    uiState.history,  // <--- causes rebuild on every history append
  ],
);
```

### `pendingHistoryItems` type

`UIState.pendingHistoryItems: HistoryItemWithoutId[]` — items do NOT have an
`id` field. That's why the code synthesizes `-(i + 1)` as the id, and uses
`pending-${i}` as the key.

### Why `uiState.history` is in the deps

The only use of `uiState.history` inside the memo is:

```ts
const prevType = i === 0 ? uiState.history.at(-1)?.type : ...
```

This gets the type of the very last committed history item in order to determine
if the first pending item is the "first thinking" item or "first after thinking"
or a "tool group boundary". It is used only for the _first_ pending item's
boundary flags.

### `HistoryItemDisplay` memo status

`HistoryItemDisplay` is a plain functional component — **not** wrapped in
`React.memo`. There is a `MemoizedHistoryItemDisplay = memo(HistoryItemDisplay)`
used for the _committed_ (non-pending) history items, but `pendingItems` uses
bare `HistoryItemDisplay`.

---

## Design Decisions

### (a) Stable Key Strategy

`pendingHistoryItems` items are `HistoryItemWithoutId` — they have no `id`.
However, we can derive a stable key from the item's `type` combined with its
position at item-creation time. The real problem is that there is no existing
stable field.

**Best approach**: Use the item's position in the pending array as a key prefix
combined with the item type, which makes keys stable as long as the array
doesn't restructure. However, since during streaming the array only _grows_
(items are appended, never reordered), the position of existing items is stable.
So `pending-${i}` is actually a _stable_ key during streaming — the issue is
that React still re-renders all items because the parent `useMemo` rebuilds the
entire element tree.

**Actually**: the real fix is not about key stability (index keys are fine for
append-only lists) but about:

1. Removing `uiState.history` from the deps (the main culprit for over-firing)
2. Wrapping individual `HistoryItemDisplay` items in `React.memo` so React can
   skip re-rendering unchanged items even when the parent array element is
   recreated

**Revised key strategy**: Keep `pending-${i}` keys but cache the `prevType` of
the first item _outside_ the memo using a separate, narrowly-scoped value (only
the last committed item's type).

### (b) Tighter Memo Dependencies

Replace `uiState.history` (entire history array) with just
`uiState.history.at(-1)?.type` (a string or undefined). This is a primitive
value — React's `useMemo` equality check will correctly skip rebuilding when the
type hasn't changed (which it won't during text-only streaming appends).

Extract this value before the `pendingItems` memo:

```tsx
const lastHistoryItemType = uiState.history.at(-1)?.type;
```

Then use `lastHistoryItemType` in the deps array instead of `uiState.history`.

### (c) `React.memo` on `HistoryItemDisplay` for Pending Items

The `pendingItems` memo already uses bare `HistoryItemDisplay`. Even with
tighter deps, when _any_ pending item's text changes, the whole memo fires and
all sibling items re-render. We should use `MemoizedHistoryItemDisplay` (which
already exists) for pending items too, and ensure the props passed to unchanged
items are referentially stable.

Key insight: `item={{ ...item, id: -(i + 1) }}` creates a new object on every
render, defeating `React.memo`. We need to either:

- Pass `item` directly (but `pendingHistoryItems` items don't have `id`)
- Assign a stable negative id to each item when it enters the pending list
  (upstream change — too risky)
- Memoize the augmented item objects

The simplest safe fix: use `MemoizedHistoryItemDisplay` with the existing
synthetic id pattern, but understand that `item={{ ...item, id: -(i+1) }}` will
still defeat memo for the updating item. However, _unchanged_ items in the array
will have stable object references if we memoize the items array.

**Better approach**: Pre-compute an array of augmented pending items (with
synthetic ids) and memo that separately, so that unchanged items keep their
reference identity.

### (d) Prop-Shape Changes

No prop-shape changes needed. The `HistoryItemWithoutId` to `HistoryItem`
conversion via `{ ...item, id: -(i+1) }` is fine to keep.

---

## Concrete Changes

### Change 1: Extract `lastHistoryItemType` before the memo

```tsx
const lastHistoryItemType = uiState.history.at(-1)?.type;
```

### Change 2: Replace `uiState.history` dep with `lastHistoryItemType`

```tsx
const pendingItems = useMemo(
  () => (
    <Box flexDirection="column" key="pending-items-group">
      {pendingHistoryItems.map((item, i) => {
        const prevType =
          i === 0
            ? lastHistoryItemType  // use extracted primitive
            : pendingHistoryItems[i - 1]?.type;
        ...
        return (
          <MemoizedHistoryItemDisplay  // use memoized version
            key={`pending-${i}`}
            item={{ ...item, id: -(i + 1) }}
            ...
          />
        );
      })}
      ...
    </Box>
  ),
  [
    pendingHistoryItems,
    uiState.constrainHeight,
    availableTerminalHeight,
    mainAreaWidth,
    showConfirmationQueue,
    confirmingTool,
    lastHistoryItemType,  // primitive string | undefined — not the whole array
  ],
);
```

### Change 3: Use `MemoizedHistoryItemDisplay` instead of `HistoryItemDisplay` for pending items

This is already memoized for committed history. Using it for pending items means
React will skip re-rendering items whose props haven't changed. Note: the
updating item's `item` prop will still change (new object), but all _other_
pending items will be stable.

---

## Critical Files

- `packages/cli/src/ui/components/MainContent.tsx` — primary change
- `packages/cli/src/ui/components/HistoryItemDisplay.tsx` — read-only reference;
  no changes needed
- `packages/cli/src/ui/types.ts` — read-only reference; no changes needed

---

## Risks

1. **`lastHistoryItemType` primitive extraction**: The `uiState.history` array
   reference changes on every history item addition. By extracting only
   `.at(-1)?.type` as a string, we lose reactivity to _type changes_ in non-last
   items — but that's fine because only the _last_ item's type matters for the
   `i === 0` case.

2. **`item={{ ...item, id: -(i+1) }}` defeats memo for the active item**: This
   is unavoidable without upstream changes. The optimization primarily benefits
   _sibling_ pending items (e.g., thinking items that appeared before the
   current streaming gemini item).

3. **No off-by-one re-key bugs**: Keeping `pending-${i}` keys is safe for
   append-only arrays. Items do not get reordered in the pending list.

4. **`MemoizedHistoryItemDisplay` for pending items**: The `commands` prop is
   not passed to pending items (pending items pass `isPending={true}` but no
   `commands`). This is consistent with the current implementation.

---

## Verification Approach

1. Run `npm run typecheck` — must pass with zero errors.
2. Run `npm run lint` — must pass.
3. Run `npm run test` (or targeted test for `MainContent`) — must pass.
4. Manual: launch `npm run start` and observe that streaming responses do not
   cause excessive repaints (use React DevTools profiler if available in Ink
   context).
