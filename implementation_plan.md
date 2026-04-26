# H9 — Split UIStateContext to Stop Full-Tree Re-Renders on Every Stream Chunk

## Issue Context

- **Path**: `packages/cli/src/ui/AppContainer.tsx` (provider) plus ~50 consumer components
- **Problem**: One context bundles `pendingHistoryItems`, `streamingState`, and `history`. Each model-stream chunk mutates it; every consumer re-renders even if it only reads the static `history`.
- **Impact**: HIGH — render FPS during streaming + keystroke latency
- **Effort**: M — split into stable `HistoryContext` and volatile `StreamingContext`; memoize provider values

---

## Step 1 — UIState Field Classification

### VOLATILE (changes per stream chunk or frequently during streaming)

These fields change on every token/chunk during streaming and drive the hot render path:

| Field | Change frequency | Who reads it |
|---|---|---|
| `pendingHistoryItems` | Every chunk | MainContent, AlternateBufferQuittingDisplay, ToolGroupMessage, useComposerStatus, useConfirmingTool |
| `pendingGeminiHistoryItems` | Every chunk | (intermediate, folded into pendingHistoryItems) |
| `pendingSlashCommandHistoryItems` | On slash command | (folded into pendingHistoryItems) |
| `streamingState` | On state transitions (Idle/Responding/WaitingForConfirmation) | InputPrompt, Composer, Notifications, DefaultAppLayout, LoadingIndicator, ShowMoreLines, GeminiRespondingSpinner |
| `thought` | Every thinking chunk | StatusRow, StatusDisplay |
| `elapsedTime` | Every second during streaming | StatusRow (via props) |
| `currentLoadingPhrase` | Every phrase cycle | StatusRow (via props) |
| `currentTip` | Occasionally during streaming | StatusRow (via props) |
| `currentWittyPhrase` | Occasionally during streaming | StatusRow (via props) |
| `activeHooks` | During hook execution | StatusRow |

### STABLE (rarely changes — essentially static after initialization)

These fields change only on explicit user actions or initialization:

| Field | Change trigger |
|---|---|
| `history` | When a turn completes and flushes |
| `historyManager` | Stable reference |
| `historyRemountKey` | On clear screen |
| `isThemeDialogOpen` | User opens/closes theme dialog |
| `themeError` | Theme errors |
| `isAuthenticating` | Auth flow |
| `isConfigInitialized` | Startup |
| `authError` | Auth errors |
| `accountSuspensionInfo` | Account issues |
| `isAuthDialogOpen` | User opens auth dialog |
| `isAwaitingApiKeyInput` | API key flow |
| `apiKeyDefaultValue` | API key flow |
| `editorError` | Editor errors |
| `isEditorDialogOpen` | User opens editor dialog |
| `showPrivacyNotice` | Privacy notice |
| `mouseMode` | Mouse toggle |
| `corgiMode` | Corgi mode toggle |
| `debugMessage` | Debug events |
| `quittingMessages` | Quitting flow |
| `isSettingsDialogOpen` | Settings dialog |
| `isSessionBrowserOpen` | Session browser |
| `isModelDialogOpen` | Model dialog |
| `isVoiceModelDialogOpen` | Voice model dialog |
| `isAgentConfigDialogOpen` | Agent config dialog |
| `selectedAgentName/DisplayName/Definition` | Agent config dialog |
| `isPermissionsDialogOpen` | Permissions dialog |
| `permissionsDialogProps` | Permissions dialog |
| `slashCommands` | On startup |
| `commandContext` | On startup |
| `commandConfirmationRequest` | On slash command confirm |
| `authConsentRequest` | Auth flow |
| `confirmUpdateExtensionRequests` | Extension updates |
| `loopDetectionConfirmationRequest` | Loop detection |
| `permissionConfirmationRequest` | Permission requests |
| `geminiMdFileCount` | File count updates |
| `initError` | Initialization errors |
| `isInputActive` | Input focus |
| `isVoiceModeEnabled` | Voice mode toggle |
| `isResuming` | Session resume |
| `shouldShowIdePrompt` | IDE integration |
| `isFolderTrustDialogOpen` | Trust dialog |
| `folderDiscoveryResults` | Folder trust |
| `isPolicyUpdateDialogOpen` | Policy update |
| `policyUpdateConfirmationRequest` | Policy update |
| `isTrustedFolder` | Trust setting |
| `constrainHeight` | Height constraint |
| `showErrorDetails` | Error toggle |
| `ideContextState` | IDE context |
| `renderMarkdown` | Markdown toggle |
| `ctrlCPressedOnce/ctrlDPressedOnce` | Key press events |
| `shortcutsHelpVisible` | Shortcuts dialog |
| `cleanUiDetailsVisible` | UI toggle |
| `messageQueue` | Message queue |
| `queueErrorMessage` | Queue error |
| `showApprovalModeIndicator` | Approval mode |
| `allowPlanMode` | Plan mode |
| `currentModel` | Model changes |
| `contextFileNames` | Context files |
| `errorCount` | Error count |
| `availableTerminalHeight` | Terminal resize |
| `stableControlsHeight` | Controls height |
| `mainAreaWidth` | Terminal resize |
| `staticAreaMaxItemHeight` | Item height |
| `staticExtraHeight` | Extra height |
| `dialogsVisible` | Dialog visibility |
| `nightly` | Build info |
| `branchName` | Git branch |
| `sessionStats` | Session stats |
| `terminalWidth/terminalHeight` | Terminal resize |
| `mainControlsRef` | DOM ref |
| `rootUiRef` | DOM ref |
| `currentIDE` | IDE info |
| `updateInfo` | Update check |
| `showIdeRestartPrompt` | IDE restart |
| `ideTrustRestartReason` | IDE trust |
| `isRestarting` | Restart state |
| `extensionsUpdateState` | Extensions |
| `activePtyId` | PTY state |
| `backgroundTaskCount` | Background tasks |
| `isBackgroundTaskVisible` | Background tasks |
| `embeddedShellFocused` | Shell focus |
| `showDebugProfiler` | Debug |
| `showFullTodos` | TODO visibility |
| `bannerData/bannerVisible` | Banner |
| `customDialog` | Custom dialogs |
| `terminalBackgroundColor` | Terminal color |
| `settingsNonce` | Settings changes |
| `backgroundTasks` | Background tasks |
| `activeBackgroundTaskPid` | Background tasks |
| `backgroundTaskHeight` | Background tasks |
| `isBackgroundTaskListOpen` | Background task list |
| `adminSettingsChanged` | Admin settings |
| `newAgents` | New agents |
| `showIsExpandableHint` | Expand hint |
| `hintMode/hintBuffer` | Hint mode |
| `transientMessage` | Transient messages |

---

## Step 2 — Consumer Analysis

### Consumers that read ONLY VOLATILE fields (pure volatile consumers)

These are the most impactful to migrate — they SHOULD only subscribe to StreamingContext:

| Consumer | Volatile fields read |
|---|---|
| `useConfirmingTool` | `pendingHistoryItems` |
| `useComposerStatus` | `pendingHistoryItems`, `streamingState` |
| `GeminiRespondingSpinner.tsx` | `streamingState` (already uses `useStreamingContext`) |
| `LoadingIndicator.tsx` | `streamingState` (already uses `useStreamingContext`) |
| `ShowMoreLines.tsx` | `streamingState` (already uses `useStreamingContext`) |

### Consumers that read BOTH STABLE and VOLATILE fields (mixed consumers)

These are the tricky ones — they need BOTH contexts or a combined API:

| Consumer | Stable fields | Volatile fields |
|---|---|---|
| `MainContent.tsx` | `mainAreaWidth`, `staticAreaMaxItemHeight`, `availableTerminalHeight`, `cleanUiDetailsVisible`, `mouseMode`, `history` | `pendingHistoryItems` |
| `InputPrompt.tsx` | `history` (shellHistory) | `streamingState` |
| `Composer.tsx` | Many stable fields | `streamingState` |
| `Notifications.tsx` | `initError`, `updateInfo` | `streamingState` |
| `StatusRow.tsx` | Many stable/layout fields | `thought` |
| `DefaultAppLayout.tsx` | Many layout fields | `streamingState` |
| `ToolGroupMessage.tsx` | Many message fields | `pendingHistoryItems` |
| `AlternateBufferQuittingDisplay.tsx` | `quittingMessages` | `pendingHistoryItems` |

### Consumers that read ONLY STABLE fields

| Consumer | Notes |
|---|---|
| `Footer.tsx` | Pure stable consumer |
| `ThemeDialog.tsx` | Pure stable consumer |
| `ModelDialog.tsx` | Pure stable consumer |
| `ShortcutsHelp.tsx` | Pure stable consumer |
| `DebugProfiler.tsx` | Pure stable consumer |
| `FolderTrustDialog.tsx` | Pure stable consumer |
| `ExitWarning.tsx` | Pure stable consumer |
| `FooterConfigDialog.tsx` | Pure stable consumer |
| `StatusDisplay.tsx` | Reads `thought` (via StatusRow props) but itself reads stable |
| `AppHeader.tsx` | Stable |
| Many auth dialogs | Stable |

---

## Step 3 — Design

### New Context Architecture

```
UIStateContext (all fields, legacy — kept for compatibility)
    ↓
StreamingContext (already exists, currently only streamingState)
    ↓ EXPANDED to include all volatile fields:
      - streamingState
      - pendingHistoryItems
      - thought
      - elapsedTime
      - currentLoadingPhrase
      - currentTip
      - currentWittyPhrase
      - activeHooks (debatable, but changes during hooks)
```

### Strategy: Expand Existing StreamingContext (Lowest Risk)

The codebase already has `StreamingContext.tsx` that provides `streamingState`. Several components already use `useStreamingContext()`. 

**Plan:**
1. Expand `StreamingContext` to include all volatile fields (`StreamingState`, `pendingHistoryItems`, `thought`, and loading indicator fields)
2. Create a new `StreamingContext.Provider` in `AppContainer.tsx` that wraps the volatile slice with a separate `useMemo`
3. Migrate key hot-path consumers:
   - `useConfirmingTool` → reads from new expanded `StreamingContext`
   - `useComposerStatus` → reads from new expanded `StreamingContext`
   - `MainContent` → reads `pendingHistoryItems` from `StreamingContext`
   - `Notifications` → reads `streamingState` from `StreamingContext`
   - `AlternateBufferQuittingDisplay` → reads `pendingHistoryItems` from `StreamingContext`
4. **Compatibility shim**: Keep all fields on `UIStateContext` so existing consumers don't break. The shimming approach means: the uiState useMemo still includes volatile fields (for backward compat), but also provide them via the StreamingContext with a separate memo that breaks subscription isolation.

### Why This Approach?

- **Zero breaking changes**: All existing `useUIState()` consumers continue to work
- **Incremental migration**: Move consumers one by one
- **Immediately reduces re-renders**: Components that subscribe to `StreamingContext` instead of `UIStateContext` will only re-render when the volatile slice changes, not the full state
- **Existing StreamingContext**: Components like `GeminiRespondingSpinner`, `LoadingIndicator`, and `ShowMoreLines` already use `useStreamingContext()` — extending the interface is backward compatible

---

## Step 4 — New Context API Surface

### Expanded `StreamingContext`

```typescript
export interface StreamingContextValue {
  streamingState: StreamingState;
  pendingHistoryItems: HistoryItemWithoutId[];
  thought: ThoughtSummary | null;
  elapsedTime: number;
  currentLoadingPhrase: string | undefined;
  currentTip: string | undefined;
  currentWittyPhrase: string | undefined;
  activeHooks: ActiveHook[];
}

export const useStreamingContext = (): StreamingContextValue => {...}

// Backward compat for components only using streamingState:
export const useStreamingState = (): StreamingState => useStreamingContext().streamingState;
```

### Provider in AppContainer

```tsx
// New volatile-only memo (re-renders only when volatile fields change)
const streamingContextValue = useMemo(() => ({
  streamingState,
  pendingHistoryItems,
  thought,
  elapsedTime,
  currentLoadingPhrase,
  currentTip,
  currentWittyPhrase,
  activeHooks,
}), [streamingState, pendingHistoryItems, thought, elapsedTime, 
    currentLoadingPhrase, currentTip, currentWittyPhrase, activeHooks]);

// The uiState memo continues to include all fields for backward compat
// but its volatile field updates no longer matter for components 
// that have migrated to StreamingContext
```

---

## Step 5 — Rollout Plan (Incremental, No Big-Bang)

### Phase 1 — Expand StreamingContext (this PR)
1. Update `StreamingContext.tsx` to include all volatile fields
2. Add a separate `streamingContextValue` useMemo in `AppContainer.tsx`
3. Update the provider tree to include `StreamingContext.Provider`

### Phase 2 — Migrate Pure Volatile Consumers (this PR)
Migrate these consumers to use `useStreamingContext()` instead of `useUIState()`:
- `useConfirmingTool` — reads only `pendingHistoryItems`
- `useComposerStatus` — reads `pendingHistoryItems` and `streamingState`
- `AlternateBufferQuittingDisplay` — reads `pendingHistoryItems`
- `Notifications` — reads `streamingState` alongside stable fields
- `MainContent` — reads `pendingHistoryItems` alongside stable fields

### Phase 3 — Mixed Consumers (deferred)
Components that read both stable and volatile fields need more care:
- `InputPrompt` — reads `streamingState` alongside many stable fields
- `Composer` — reads `streamingState` alongside many stable fields
- `DefaultAppLayout` — reads `streamingState` alongside layout fields
- `ToolGroupMessage` — reads `pendingHistoryItems` alongside message fields
- `StatusRow` — reads `thought` alongside many stable fields

These can be migrated in follow-up PRs without risk.

---

## Step 6 — Risks

1. **Component double-subscription**: A component that subscribes to BOTH `UIStateContext` and `StreamingContext` for different fields will re-render on EITHER change. The migration benefit is lost for mixed consumers — they need to be fully migrated.

2. **Stale volatile data in UIStateContext**: If we remove volatile fields from the uiState useMemo's dependency array (to stop it from re-running), but consumers still read via `useUIState()`, they'll get stale data. Solution: Keep volatile fields in the uiState memo for backward compat during transition.

3. **Test mocking complexity**: Tests that mock `UIStateContext` will need to also mock `StreamingContext` for migrated components.

4. **Ordering of provider updates**: React updates all providers synchronously, so there's no race between `UIStateContext` and `StreamingContext` values.

---

## Files to Touch

1. **`packages/cli/src/ui/contexts/StreamingContext.tsx`** — Expand interface
2. **`packages/cli/src/ui/AppContainer.tsx`** — Add streamingContextValue useMemo + wrap StreamingContext.Provider
3. **`packages/cli/src/ui/hooks/useConfirmingTool.ts`** — Migrate to StreamingContext
4. **`packages/cli/src/ui/hooks/useComposerStatus.ts`** — Migrate to StreamingContext
5. **`packages/cli/src/ui/components/AlternateBufferQuittingDisplay.tsx`** — Migrate to StreamingContext
6. **`packages/cli/src/ui/components/Notifications.tsx`** — Partial migrate (streamingState from StreamingContext)
7. **`packages/cli/src/ui/components/MainContent.tsx`** — Migrate pendingHistoryItems to StreamingContext
8. **`packages/cli/src/ui/components/messages/ToolGroupMessage.tsx`** — Migrate pendingHistoryItems to StreamingContext
