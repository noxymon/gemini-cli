# Research: Environment-Aware Tool Selection vs. Bundled Bash

## Goal

Decide between implementing environment-aware tool selection or bundling a Bash
binary to handle cross-platform shell command compatibility.

## Comparison

### Approach A: Environment-Aware Selection (Surgical)

- **Mechanism**: Use `isWindows()` to swap `cat` for `type` (or no-op pager) and
  `ls` for `dir`.
- **Pros**:
  - Lightweight (0 bytes added).
  - Native performance.
  - No licensing issues (Bash is GPL).
  - Respects host system configuration.
- **Cons**:
  - Requires mapping logic.
  - `dir` and `ls` have different output formats (may confuse the model).
- **Feasibility**: Very high.

### Approach B: Bundled Bash (God Mode)

- **Mechanism**: Include a minimal Bash binary (e.g., from MSYS2 or Git for
  Windows) in the `vendor/` directory.
- **Pros**:
  - Unified shell syntax for the model across all platforms.
  - No mapping logic needed in JS.
- **Cons**:
  - **Bloat**: Adds 10-20MB+ to the binary.
  - **Complexity**: Bash requires a runtime environment (libc, terminfo) on
    Windows. Bundling just the `.exe` usually isn't enough.
  - **Path Hell**: MSYS2 paths (`/c/Users/...`) vs Windows paths
    (`C:\Users\...`) require a complex translation layer.
  - **Licensing**: GPL license may impose restrictions on redistribution.
- **Feasibility**: Low/Medium (High maintenance).

## Findings from RipGrep (`ripGrep.ts`)

The project already bundles platform-specific binaries for `rg`. However, `rg`
is a standalone static binary (usually). Bash is a dynamic beast with many
dependencies.

## Recommendation: Environment Awareness

Bundling Bash is a "Jerry-move"—it's an over-engineered solution to a surgical
problem. We should stick to making the CLI smarter about its environment. We're
Pickle Rick; we adapt to the environment, we don't carry a whole biosphere with
us just to survive a cold day.

## Implementation Path (Revised)

1. Implement `getEnvironmentAwareCommand` to handle basic translations.
2. Provide a "System Prompt" hint to the model about the current shell
   (`powershell` vs `bash`).
3. Ensure the `PAGER` is set to something non-breaking on Windows.
