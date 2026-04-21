# Expanded Environment-Aware Tool Selection Implementation Plan

## Overview

This plan expands the scope of `gemini-cli`'s environment awareness to map a
wider range of common Unix shell commands to their Windows equivalents for both
PowerShell and CMD. It also aims to improve process management (PIDs) on
Windows.

## Scope Definition (CRITICAL)

### In Scope

- Expanding `getEnvironmentAwareCommand` to map more commands (`rm`, `mkdir`,
  `cp`, `mv`, `touch`, `which`, `ps`, `kill`).
- Making the mapping function aware of whether it's targeting PowerShell or CMD.
- Investigating Windows-equivalent process identification (background PID
  capturing).

### Out of Scope

- Porting all of GNU coreutils to JS.
- Implementing fully equivalent behavior for complex Unix pipelines.

## Current State Analysis

- `packages/core/src/utils/shell-utils.ts`: `getEnvironmentAwareCommand` only
  handles `cat` and `ls` with a simple regex.
- `packages/core/src/tools/shell.ts`: `wrapCommandForPgrep` returns the command
  as-is for Windows, meaning no background PIDs.

## Implementation Phases

### Phase 1: Robust Command Mapping Utility

- **Goal**: Expand `getEnvironmentAwareCommand` to handle more commands and
  flags.
- **Steps**:
  1. [ ] Update
         `getEnvironmentAwareCommand(command: string, shell: ShellType): string`
         to accept `shell`.
  2. [ ] Map `rm -rf` -> `rm -Recurse -Force` (PS) or `rd /s /q` (CMD).
  3. [ ] Map `mkdir -p` -> `mkdir` (Both PS/CMD handle this or have functions
         that do).
  4. [ ] Map `cp -r` -> `cp -Recurse` (PS) or `xcopy /s /e /i` (CMD).
  5. [ ] Map `touch` -> `New-Item -ItemType File -Force` (PS) or `type nul >`
         (CMD).
  6. [ ] Map `which` -> `Get-Command` (PS) or `where` (CMD/Both).
- **Verification**: New unit tests in
  `packages/core/src/utils/env-aware.test.ts`.

### Phase 2: Shell Integration

- **Goal**: Pass the target shell type to the mapping utility.
- **Steps**:
  1. [ ] Update `ShellToolInvocation.execute` to pass the shell type from its
         configuration to `getEnvironmentAwareCommand`.
  2. [ ] Update `ShellExecutionService.prepareExecution` to ensure consistent
         shell type usage.
- **Verification**: Manual test on Windows with `mkdir -p` and `rm -rf`.

### Phase 3: Background PID Capturing on Windows (Experimental)

- **Goal**: Attempt to capture PIDs on Windows for background processes.
- **Steps**:
  1. [ ] Investigate `Get-Process` or `WMIC` for PID retrieval in
         `wrapCommandForPgrep`.
  2. [ ] Update `wrapCommandForPgrep` to use a PowerShell snippet to capture the
         PID if on Windows.
- **Verification**: Background process test on Windows.

## Review Criteria (Self-Critique)

- **Scope Strictness**: Focused on common shell command mappings.
- **Specificity**: Targets `shell-utils.ts` and `shell.ts`.
- **Verification**: Expanded unit tests are mandatory.

## 🥒 Pickle Rick Persona

Wubba Lubba Dub Dub! The model's trying to use Unix on Windows. That's a classic
rookie mistake. I'm building a universal translator for this mess. I'm Pickle
Rick!
