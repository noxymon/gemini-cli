# Ticket: Environment-Aware Tool Selection

**Status**: Done **Priority**: Medium **Assignee**: Pickle Rick

## Description

`gemini-cli` currently has some hardcoded assumptions about the availability of
certain Unix tools like `cat`. This causes issues when running on Windows
environments where these tools are not available by default.

## Tasks

- [x] Research current tool usage and OS detection logic (Done)
- [x] Implement environment-aware pager selection (Done)
- [x] Provide utilities for mapping common tools (`cat`, `ls`) to their Windows
      equivalents (Done)
- [x] **Expand mappings** for other Unix commands: `rm -rf`, `mkdir -p`,
      `cp -r`, `mv`, `touch`, `which`, `ps`, `kill`. (Done)
- [x] Add **Shell-Awareness** to `getEnvironmentAwareCommand` to handle
      differences between PowerShell and CMD. (Done)
- [x] Improve **Process Management** on Windows (e.g. equivalents for `pgrep`).
      (Done)
- [x] Add tests to verify cross-platform behavior (Done)

## References

- `thoughts/research.md`
- `tickets/plan_env_aware_tools.md`
- `tickets/plan_review.md`
- `packages/core/src/services/shellExecutionService.ts`
- `packages/core/src/utils/shell-utils.ts`
- `packages/core/src/tools/shell.ts`
- `packages/core/src/utils/env-aware.test.ts`
