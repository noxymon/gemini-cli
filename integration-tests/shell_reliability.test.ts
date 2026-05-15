/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig } from './test-helper.js';

describe('Shell Execution Reliability', () => {
  it('should execute basic commands successfully', async () => {
    const rig = new TestRig();
    try {
      await rig.setup('shell-basic');
      const result = await rig.callTool('run_shell_command', {
        command: 'echo "TEST_OUTPUT"',
        description: 'Basic echo test',
      });

      expect(result).toBeDefined();
      expect(result.output).toContain('TEST_OUTPUT');
    } finally {
      await rig.cleanup();
    }
  });

  it('should handle multi-line commands', async () => {
    const rig = new TestRig();
    try {
      await rig.setup('shell-multiline');
      const command =
        process.platform === 'win32'
          ? 'echo line1; echo line2'
          : 'echo line1 && echo line2';

      const result = await rig.callTool('run_shell_command', {
        command,
        description: 'Multi-line echo test',
      });

      expect(result.output).toContain('line1');
      expect(result.output).toContain('line2');
    } finally {
      await rig.cleanup();
    }
  });

  it('should correctly capture stderr', async () => {
    const rig = new TestRig();
    try {
      await rig.setup('shell-stderr');
      // Using a command that writes to stderr and exits with error
      const command =
        process.platform === 'win32'
          ? 'powershell -Command "[Console]::Error.WriteLine(\'STDERR_ERROR\'); exit 1"'
          : 'echo "STDERR_ERROR" >&2 && exit 1';

      const result = await rig.callTool('run_shell_command', {
        command,
        description: 'Stderr capture test',
      });

      expect(result.output).toContain('STDERR_ERROR');
    } finally {
      await rig.cleanup();
    }
  });
});
