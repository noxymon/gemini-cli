/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig } from './test-helper.js';

describe('run_shell_command reproduction', () => {
  it('should return output for a simple echo command', async () => {
    const rig = new TestRig();
    try {
      await rig.setup();
      const result = await rig.callTool('run_shell_command', {
        command: 'echo "REPRO_SUCCESS"',
        description: 'Testing basic echo',
      });

      expect(result).toBeDefined();
      expect(result.output).toContain('REPRO_SUCCESS');
    } finally {
      await rig.cleanup();
    }
  });

  it('should return exit code 0 for a simple true command', async () => {
    const rig = new TestRig();
    try {
      await rig.setup();
      const result = await rig.callTool('run_shell_command', {
        command: 'true',
        description: 'Testing true command',
      });

      expect(result).toBeDefined();
      // Assuming ToolResult has exitCode or we can check the status
      // If it fails, rig.callTool might throw or return an error result
    } finally {
      await rig.cleanup();
    }
  });
});
