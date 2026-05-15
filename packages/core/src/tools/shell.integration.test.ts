/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShellTool } from './shell.js';
import { createMockMessageBus } from '../test-utils/mock-message-bus.js';
import type { AgentLoopContext } from '../config/agent-loop-context.js';
import { NoopSandboxManager } from '../services/sandboxManager.js';

describe('ShellTool Integration', () => {
  const bus = createMockMessageBus();
  let shellTool: ShellTool;

  const createMockContext = (
    overrides: any = {}, // eslint-disable-line @typescript-eslint/no-explicit-any
  ) => {
    const { config: configOverrides, ...otherOverrides } = overrides;
    return {
      config: {
        getSessionId: () => 'default',
        getEnableWindowsBash: () => false,
        getInteractiveShellSettings: () => ({ enabled: false }),
        getEnableInteractiveShell: () => false,
        getWorkspaceIds: () => [],
        getEnableShellOutputEfficiency: () => false,
        getSandboxEnabled: () => false,
        getShellToolInactivityTimeout: () => 300000,
        getInteractiveShellDefaultPager: () => 'cat',
        getTargetDir: () => process.cwd(),
        validatePathAccess: () => undefined,
        getShellBackgroundCompletionBehavior: () => 'silent',
        sanitizationConfig: {},
        get sandboxManager() {
          return new NoopSandboxManager();
        },
        getDebugMode: () => false,
        getSummarizeToolOutputConfig: () => ({ enabled: false }),
        ...configOverrides,
      },
      ...otherOverrides,
    } as unknown as AgentLoopContext;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    shellTool = new ShellTool(createMockContext(), bus);
  });

  it('should run simple echo command successfully', async () => {
    const invocation = shellTool.build({ command: 'echo "hello"' });
    const result = await invocation.execute({
      abortSignal: new AbortController().signal,
    });

    expect(result.llmContent).toContain('hello');
    expect(result.llmContent).not.toContain('Exit code: 1');
  });

  it('should run simple cross-platform command successfully', async () => {
    const result = await invocation.execute({
      abortSignal: new AbortController().signal,
    });

    expect(result.llmContent).toContain('ok');
    expect(result.llmContent).not.toContain('Exit code: 1');
  });

  it('should run simple echo command successfully with windows bash', async () => {
    const bashMockContext = createMockContext({
      config: {
        getEnableWindowsBash: () => true,
      },
    });
    const bashShellTool = new ShellTool(bashMockContext, bus);

    const invocation = bashShellTool.build({ command: 'echo "hello"' });
    const result = await invocation.execute({
      abortSignal: new AbortController().signal,
    });

    expect(result.llmContent).toContain('hello');
    expect(result.llmContent).not.toContain('Exit Code: 1');
  });

  it('should handle "true" command (built-in in bash, may fail in ps)', async () => {
    const invocation = shellTool.build({ command: 'true' });
    const result = await invocation.execute({
      abortSignal: new AbortController().signal,
    });

    expect(result.llmContent).toBeDefined();
  });

  it('should handle "ls" command', async () => {
    const invocation = shellTool.build({ command: 'ls' });
    const result = await invocation.execute({
      abortSignal: new AbortController().signal,
    });

    if (result.exitCode !== 0 && result.exitCode !== null) {
      throw new Error(
        `Command "ls" failed with code ${result.exitCode}. Output: ${result.llmContent}`,
      );
    }
    expect(result.llmContent).toBeTruthy();
  });
});
