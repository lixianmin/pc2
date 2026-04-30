import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../../src/agent/loop.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { Tool } from '../../../src/tools/types.js';
import type { StepOutcome } from '../../../src/types.js';

vi.mock('../../../baml_client/index.js', () => ({
  b: {
    AgentChat: vi.fn(),
  },
}));

vi.mock('../../../src/storage/tokens.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/storage/tokens.js')>('../../../src/storage/tokens.js');
  return {
    ...actual,
    countTokens: vi.fn(actual.countTokens),
  };
});

describe('AgentLoop', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    tempDirs = [];
  });

  afterEach(() => {
    for (const d of tempDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function makeThreadDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pc2-loop-'));
    tempDirs.push(dir);
    return dir;
  }

  it('exits on text-only response (no tool calls)', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'Hello! How can I help?',
      tool_calls: [],
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);
    const threadDir = makeThreadDir();
    const events = [];
    for await (const event of loop.execute('Hi', { maxRounds: 5, threadDir })) {
      events.push(event);
    }
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'completed' });
  });

  it('dispatches tool calls and continues loop', async () => {
    const { b } = await import('../../../baml_client/index.js');
    const echoTool: Tool = {
      name: 'echo',
      description: 'echo input',
      parameters: { type: 'object', properties: { msg: { type: 'string' } } },
      execute: async (args) => ({ data: args.msg as string, nextPrompt: null, shouldExit: false }),
    };

    (b.AgentChat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ text: '', tool_calls: [{ name: 'echo', arguments: '{"msg":"hi"}', id: 'tc_1' }] })
      .mockResolvedValueOnce({ text: 'Done!', tool_calls: [] });

    const registry = new ToolRegistry();
    registry.register(echoTool);
    const loop = new AgentLoop(registry);
    const threadDir = makeThreadDir();
    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 5, threadDir })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
  });

  it('exits on max rounds', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'thinking',
      tool_calls: [{ name: 'echo', arguments: '{"msg":"loop"}', id: 'tc_loop' }],
    });

    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ data: 'ok', nextPrompt: null, shouldExit: false }),
    };

    const registry = new ToolRegistry();
    registry.register(echoTool);
    const loop = new AgentLoop(registry);
    const threadDir = makeThreadDir();
    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 2, threadDir })) {
      events.push(event);
    }
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'max_rounds' });
  });

  it('no truncation warning with disk-based context', async () => {
    const { b } = await import('../../../baml_client/index.js');

    let callCount = 0;
    (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { text: 'A'.repeat(50000), tool_calls: [{ name: 'echo', arguments: '{"msg":"x"}', id: 'tc_1' }] };
      }
      return { text: 'Done', tool_calls: [] };
    });

    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ data: 'ok', nextPrompt: null, shouldExit: false }),
    };

    const registry = new ToolRegistry();
    registry.register(echoTool);
    const loop = new AgentLoop(registry);
    const threadDir = makeThreadDir();

    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 5, threadDir })) {
      events.push(event);
    }
    const truncWarnings = events.filter(e => e.type === 'warning' && String(e.content).includes('truncated'));
    expect(truncWarnings).toHaveLength(0);
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'completed' });
  });

  it('persists user messages to JSONL when threadDir is set', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Done',
      tool_calls: [],
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);
    const threadDir = makeThreadDir();

    for await (const _ of loop.execute('test user message', { threadDir })) { /* consume */ }

    const { readFileSync } = await import('fs');
    const content = readFileSync(`${threadDir}/messages-current.jsonl`, 'utf-8');
    expect(content).toContain('"role":"user"');
    expect(content).toContain('test user message');
  });
});
