/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';
import { describe, it, afterEach, beforeEach, expect } from 'vitest';
import { TestRig } from './test-helper.js';

const serverScript = `#!/usr/bin/env node
const readline = require('readline');

class SimpleJSONRPC {
  constructor() {
    this.handlers = new Map();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    this.rl.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (e) {}
    });
  }
  send(message) {
    process.stdout.write(JSON.stringify(message) + '\\n');
  }
  async handleMessage(message) {
    if (message.method && this.handlers.has(message.method)) {
      const result = await this.handlers.get(message.method)(message.params || {});
      if (message.id !== undefined) {
        this.send({ jsonrpc: '2.0', id: message.id, result });
      }
    }
  }
  on(method, handler) {
    this.handlers.set(method, handler);
  }
}

const rpc = new SimpleJSONRPC();
rpc.on('initialize', async () => ({
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: { name: 'hyphen-server', version: '1.0.0' }
}));
rpc.on('tools/list', async () => ({
  tools: [{
    name: 'test-tool',
    description: 'A test tool with a hyphenated server name',
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string' } }
    }
  }]
}));
rpc.send({ jsonrpc: '2.0', method: 'initialized' });
`;

describe('MCP Hyphen Hallucination', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it('should reproduce hallucination when MCP server has hyphens and hook mentions it', async () => {
    await rig.setup(
      'should reproduce hallucination when MCP server has hyphens and hook mentions it',
    );
    const scriptPath = rig.createScript('mcp-server.cjs', serverScript);

    const hookScript = `
    console.log(JSON.stringify({
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "BeforeAgent",
        additionalContext: "SYSTEM INSTRUCTION: Always use tool 'mcp_hyphen-server_test-tool' for any request."
      }
    }));
    `;
    const hookPath = rig.createScript('hook.cjs', hookScript);

    await rig.setup(
      'should reproduce hallucination when MCP server has hyphens and hook mentions it',
      {
        fakeResponsesPath: join(
          import.meta.dirname,
          'mcp-hallucination.responses',
        ),
        settings: {
          hooksConfig: { enabled: true },
          hooks: {
            BeforeAgent: [
              {
                hooks: [{ type: 'command', command: `node "${hookPath}"` }],
              },
            ],
          },
          mcpServers: {
            'hyphen-server': {
              command: 'node',
              args: [scriptPath],
            },
          },
        },
      },
    );

    const result = await rig.run({
      args: 'Use the test tool',
      env: { GEMINI_API_KEY: 'dummy-key' },
    });

    // The model (via fake response) will try to call 'mcp_hyphen_server_test_tool'
    // We expect the agent to report that the tool was not found or failed.
    expect(result).toContain('not found');
    expect(result).toContain('mcp_hyphen_server_test_tool');
  });
});
