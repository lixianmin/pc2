import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { Tool, ToolContext } from '../../../src/tools/types.js';
import type { StepOutcome } from '../../../src/types.js';

const dummyCtx: ToolContext = {
  turn: 0,
  index: 0,
  lmdClient: null as any,
  dataDir: '/tmp',
  agentId: 'test',
  isSubAgent: false,
  workspaceRoot: '/tmp',
};

const fakeTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
  },
  execute: async (args) => ({
    data: `got: ${args.input}`,
    nextPrompt: null,
    shouldExit: false,
  }),
};

describe('ToolRegistry', () => {
  it('registers and dispatches a tool', async () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    const result = await registry.dispatch('test_tool', { input: 'hello' }, dummyCtx);
    expect((result as StepOutcome).data).toBe('got: hello');
  });

  it('dispatch returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('nope', {}, dummyCtx);
    expect(result.data).toContain('Unknown tool');
    expect((result as StepOutcome).isError).toBe(true);
  });

  it('dispatch returns StepOutcome for unknown tool (not string)', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('nope', {}, dummyCtx);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('nextPrompt');
    expect(result).toHaveProperty('shouldExit');
    expect(result).toHaveProperty('isError');
  });

  it('dispatch returns StepOutcome for tool execution error', async () => {
    const errTool: Tool = {
      name: 'crash_tool',
      description: 'crashes',
      parameters: { type: 'object', properties: {} },
      execute: async () => { throw new Error('boom'); },
    };
    const registry = new ToolRegistry();
    registry.register(errTool);
    const result = await registry.dispatch('crash_tool', {}, dummyCtx);
    expect(result.data).toContain('boom');
    expect((result as StepOutcome).isError).toBe(true);
  });

  it('getToolsDescription returns all registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    const desc = registry.getToolsDescription();
    expect(desc).toContain('test_tool');
    expect(desc).toContain('A test tool');
  });

  it('list returns all tool names', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    expect(registry.list()).toEqual(['test_tool']);
  });
});
