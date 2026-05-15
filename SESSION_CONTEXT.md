# Current Session Context & Learnings

## Issue: Unexpected Process Exit in YOLO Mode

- **Symptom:** The Gemini CLI forcefully exits during tool execution
  (specifically after `npx depcheck --json`) while in "Thinking..." state. The
  terminal returns to the OS prompt.
- **Environment:** YOLO mode enabled, monorepo structure.

## Investigation Details

- **Shell Tool Limits:**
  - `packages/core/src/tools/shell.ts` has
    `OUTPUT_SIZE_LIMIT = 10 * 1024 * 1024` (10MB).
  - `packages/core/src/services/shellExecutionService.ts` has
    `MAX_CHILD_PROCESS_BUFFER_SIZE = 16 * 1024 * 1024` (16MB).
  - When `OUTPUT_SIZE_LIMIT` is exceeded,
    `combinedController.abort(new Error(...))` is called.
- **Exit Logic:**
  - `packages/cli/src/ui/AppContainer.tsx` defines a `quit` action calling
    `process.exit(0)`.
  - `packages/cli/src/utils/cleanup.ts` has a `setupTtyCheck` that triggers
    `gracefulShutdown` (and `process.exit(0)`) if both stdin and stdout lose TTY
    status.
  - `packages/cli/src/gemini.tsx` calls
    `await runExitCleanup(); process.exit(ExitCodes.SUCCESS);` after
    `runNonInteractive`.
- **Policy Engine:**
  - In YOLO mode, some `DENY` decisions are possible if shell parsing fails for
    restricted rules (e.g. commands with redirections/substitutions that can't
    be safely parsed).
  - Parsing failures in `policy-engine.ts` currently return
    `PolicyDecision.DENY` even in YOLO mode if `rule.argsPattern` is present.

## Hypothesis

1. **TTY Loss:** The large output from `depcheck` or `ts-prune` might be causing
   a TTY buffer issue or triggering the TTY loss check in `cleanup.ts`, leading
   to `gracefulShutdown`.
2. **Unhandled Error:** The "Output size limit exceeded" error might be reaching
   a top-level handler that calls `process.exit` without logging clearly to the
   UI.
3. **Double Exit:** A tool completion or cancellation might be triggering the
   `quit` logic unexpectedly.

## Next Steps (Paused)

- Create a minimal reproduction test case simulating large tool output in YOLO
  mode.
- Verify if `setupTtyCheck` is triggered by large data bursts.
- Inspect if `PolicyDecision.DENY` during "Thinking..." state can trigger an
  exit.
