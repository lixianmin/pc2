import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMemorySearchTool } from '../../../src/tools/memory-search.js';
import { createAskUserTool } from '../../../src/tools/ask-user.js';
import { createSpawnAgentTool } from '../../../src/tools/spawn-agent.js';
import { createWebSearchTool } from '../../../src/tools/web-search.js';
import type { ToolContext } from '../../../src/tools/types.js';

const mockLmdClient: any = {
  queryMemory: async () => [
    { id: '1', content: 'test fact', type: 'fact', score: 0.9, createdAt: '2026-01-01' },
  ],
};

const dummyCtx: ToolContext = {
  turn: 0, index: 0, lmdClient: mockLmdClient, dataDir: '/tmp', agentId: 'test', isSubAgent: false, workspaceRoot: '/tmp',
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

describe('web_search tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls whoogle API and returns formatted results', async () => {
    const fakeResults = [
      { title: 'Result 1', href: 'https://example.com/1', snippet: 'A <b>great</b> result' },
      { title: 'Result 2', href: 'https://example.com/2', content: 'Another result' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: fakeResults }),
    }));

    const tool = createWebSearchTool();
    const result = await tool.execute({ query: 'test query' }, dummyCtx);
    expect(result.data).toContain('Result 1');
    expect(result.data).toContain('https://example.com/1');
    expect(result.data).toContain('great result');
    expect(result.data).toContain('Result 2');
    expect(result.nextPrompt).toBeNull();
    expect(result.shouldExit).toBe(false);
  });

  it('returns error on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const tool = createWebSearchTool();
    const result = await tool.execute({ query: 'fail' }, dummyCtx);
    expect(String(result.data)).toContain('Search error: HTTP 500');
  });

  it('returns no results message when empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    const tool = createWebSearchTool();
    const result = await tool.execute({ query: 'nothing' }, dummyCtx);
    expect(result.data).toBe('No results found.');
  });

  it('handles fetch exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const tool = createWebSearchTool();
    const result = await tool.execute({ query: 'boom' }, dummyCtx);
    expect(String(result.data)).toContain('connection refused');
  });
});
