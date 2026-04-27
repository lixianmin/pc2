import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createFileReadTool } from '../../src/tools/file-read.js';
import { createFileWriteTool } from '../../src/tools/file-write.js';
import { createFileEditTool } from '../../src/tools/file-edit.js';
import { createBashTool } from '../../src/tools/bash.js';
import { createWebSearchTool } from '../../src/tools/web-search.js';
import { createWebFetchTool } from '../../src/tools/web-fetch.js';
import { createMemorySearchTool } from '../../src/tools/memory-search.js';
import { createAskUserTool } from '../../src/tools/ask-user.js';
import { createSpawnAgentTool } from '../../src/tools/spawn-agent.js';

vi.mock('../../baml_client/index.js', () => ({
  b: {
    AgentChat: vi.fn(),
    SummarizeHistory: vi.fn(),
  },
}));

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createFileReadTool());
  registry.register(createFileWriteTool());
  registry.register(createFileEditTool());
  registry.register(createBashTool());
  registry.register(createWebSearchTool());
  registry.register(createWebFetchTool());
  registry.register(createMemorySearchTool());
  registry.register(createAskUserTool());
  registry.register(createSpawnAgentTool());
  return registry;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pc2-int-'));
}

describe('integration: chat flow', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function collectEvents(loop: AgentLoop, input: string, options?: Record<string, unknown>) {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of loop.execute(input, options)) {
      events.push(event);
    }
    return events;
  }

  it('multi-turn: carries history and JSONL persists', async () => {
    const { b } = await import('../../baml_client/index.js');
    const promptCapture: string[] = [];
    (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async (prompt: string) => {
      promptCapture.push(prompt);
      if (promptCapture.length === 1) {
        return {
          text: 'Found: Project A and Project B.',
          tool_calls: [{ name: 'bash', arguments: '{"command":"echo hello"}', id: 'tc_1' }],
        };
      }
      return { text: 'Project B is a CLI tool.', tool_calls: [] };
    });

    const registry = makeRegistry();
    const loop = new AgentLoop(registry);
    const threadDir = join(tempDir, 'thread-1');

    const events1 = await collectEvents(loop, 'find top 2 projects', { threadDir, dataDir: tempDir });
    const events2 = await collectEvents(loop, 'what is the second project?', { threadDir, dataDir: tempDir });

    expect(events1[events1.length - 1]).toEqual({ type: 'done', reason: 'completed' });
    expect(events2[events2.length - 1]).toEqual({ type: 'done', reason: 'completed' });

    expect(promptCapture[2]).toContain('[User]\nfind top 2 projects');
    expect(promptCapture[2]).toContain('[User]\nwhat is the second project?');
    expect(promptCapture[2]).toContain('Project A and Project B');

    const jsonlPath = join(threadDir, 'messages-current.jsonl');
    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const firstMsg = JSON.parse(lines[0]);
    expect(firstMsg.role).toBe('assistant');
  });

  it('memory_search returns graceful message when LMD unavailable', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async (prompt: string) => {
      if (prompt.includes('first_call')) {
        return {
          text: 'Let me search memory.',
          tool_calls: [{ name: 'memory_search', arguments: '{"query":"test"}', id: 'tc_1' }],
        };
      }
      return { text: 'Done.', tool_calls: [] };
    });

    const registry = makeRegistry();
    const loop = new AgentLoop(registry);
    const events = await collectEvents(loop, 'first_call');

    const resultEvent = events.find(e => e.type === 'tool_result' && e.name === 'memory_search');
    expect(resultEvent).toBeDefined();
    expect(String(resultEvent!.result)).toContain('Memory not available');
  });

  it('bash tool executes read-only command and returns output', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: 'Running ls.',
        tool_calls: [{ name: 'bash', arguments: '{"command":"echo hello-world"}', id: 'tc_1' }],
      })
      .mockResolvedValueOnce({ text: 'Done.', tool_calls: [] });

    const registry = makeRegistry();
    const loop = new AgentLoop(registry);
    const events = await collectEvents(loop, 'run echo');

    const resultEvent = events.find(e => e.type === 'tool_result' && e.name === 'bash');
    expect(resultEvent).toBeDefined();
    expect(String(resultEvent!.result)).toContain('hello-world');
  });

  it('file_write + file_read round-trip', async () => {
    const { b } = await import('../../baml_client/index.js');
    const wsDir = join(process.cwd(), 'tmp-int-test');
    mkdirSync(wsDir, { recursive: true });
    const testFile = join(wsDir, 'test-output.txt');
    try {
      (b.AgentChat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          text: 'Writing file.',
          tool_calls: [{ name: 'file_write', arguments: JSON.stringify({ path: testFile, content: 'integration test content' }), id: 'tc_1' }],
        })
        .mockResolvedValueOnce({
          text: 'Reading file.',
          tool_calls: [{ name: 'file_read', arguments: JSON.stringify({ path: testFile }), id: 'tc_2' }],
        })
        .mockResolvedValueOnce({ text: 'Done.', tool_calls: [] });

      const registry = makeRegistry();
      const loop = new AgentLoop(registry);
      const events = await collectEvents(loop, 'write then read', { dataDir: tempDir });

      const writeEvent = events.find(e => e.type === 'tool_result' && e.name === 'file_write');
      expect(writeEvent).toBeDefined();

      const readEvent = events.find(e => e.type === 'tool_result' && e.name === 'file_read');
      expect(readEvent).toBeDefined();
      expect(String(readEvent!.result)).toContain('integration test content');
    } finally {
      rmSync(wsDir, { recursive: true, force: true });
    }
  });

  it('ask_user tool exits loop with shouldExit', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'I need to ask.',
      tool_calls: [{ name: 'ask_user', arguments: '{"question":"What do you prefer?"}', id: 'tc_1' }],
    });

    const registry = makeRegistry();
    const loop = new AgentLoop(registry);
    const events = await collectEvents(loop, 'ask me something');

    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'ask_user' });
  });

  it('spawn_agent returns task in result', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: 'Spawning agent.',
        tool_calls: [{ name: 'spawn_agent', arguments: '{"task":"search the web for X","context":"extra info"}', id: 'tc_1' }],
      })
      .mockResolvedValueOnce({ text: 'Sub-agent done.', tool_calls: [] });

    const registry = makeRegistry();
    const loop = new AgentLoop(registry);
    const events = await collectEvents(loop, 'delegate task');

    const resultEvent = events.find(e => e.type === 'tool_result' && e.name === 'spawn_agent');
    expect(resultEvent).toBeDefined();
    const result = JSON.parse(String(resultEvent!.result));
    expect(result.task).toBe('search the web for X');
  });

  it('anti-loop triggers after consecutive failures', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Trying again.',
      tool_calls: [{ name: 'web_fetch', arguments: '{"url":"https://nonexistent.invalid/page"}', id: 'tc_loop' }],
    });

    const registry = makeRegistry();
    const loop = new AgentLoop(registry);
    const events = await collectEvents(loop, 'fetch broken', { maxRounds: 5 });

    const warningEvents = events.filter(e => e.type === 'warning' && String(e.content).includes('Anti-Loop'));
    expect(warningEvents.length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe('done');
  });
});
