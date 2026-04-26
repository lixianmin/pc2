import { describe, it, expect } from 'vitest';
import { createMemorySearchTool } from '../../../src/tools/memory-search.js';
import { createAskUserTool } from '../../../src/tools/ask-user.js';
import { createSpawnAgentTool } from '../../../src/tools/spawn-agent.js';
import type { ToolContext } from '../../../src/tools/types.js';

const mockLmdClient: any = {
  queryMemory: async () => [
    { id: '1', content: 'test fact', type: 'fact', score: 0.9, createdAt: '2026-01-01' },
  ],
};

const dummyCtx: ToolContext = {
  turn: 0, index: 0, lmdClient: mockLmdClient, dataDir: '/tmp', agentId: 'test', isSubAgent: false,
};

describe('memory_search tool', () => {
  it('queries LMD and returns formatted results', async () => {
    const tool = createMemorySearchTool();
    const result = await tool.execute({ query: 'test query' }, dummyCtx);
    expect(String(result.data)).toContain('test fact');
  });
});

describe('ask_user tool', () => {
  it('returns shouldExit=true and the question as nextPrompt', async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Continue?' }, dummyCtx);
    expect(result.shouldExit).toBe(true);
    expect(result.nextPrompt).toBe('Continue?');
  });
});

describe('spawn_agent tool', () => {
  it('blocks sub-agents from spawning further sub-agents', async () => {
    const tool = createSpawnAgentTool();
    const subCtx = { ...dummyCtx, isSubAgent: true };
    const result = await tool.execute({ task: 'sub-task' }, subCtx);
    expect(String(result.data)).toContain('Error');
  });

  it('returns task info for main agent', async () => {
    const tool = createSpawnAgentTool();
    const result = await tool.execute({ task: 'do something', context: 'extra info' }, dummyCtx);
    const data = result.data as Record<string, string>;
    expect(data.task).toBe('do something');
  });
});
