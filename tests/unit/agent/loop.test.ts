import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits on text-only response (no tool calls)', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'Hello! How can I help?',
      tool_calls: [],
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);
    const events = [];
    for await (const event of loop.execute('Hi', { maxRounds: 5 })) {
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
    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 5 })) {
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
    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 2 })) {
      events.push(event);
    }
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'max_rounds' });
  });

  it('truncates messages when approaching context limit', async () => {
    const { b } = await import('../../../baml_client/index.js');
    const { countTokens } = await import('../../../src/storage/tokens.js');

    let callCount = 0;
    (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { text: 'A'.repeat(50000), tool_calls: [{ name: 'echo', arguments: '{"msg":"x"}', id: 'tc_1' }] };
      }
      return { text: 'Done', tool_calls: [] };
    });

    (countTokens as ReturnType<typeof vi.fn>).mockResolvedValue(70000);

    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ data: 'ok', nextPrompt: null, shouldExit: false }),
    };

    const registry = new ToolRegistry();
    registry.register(echoTool);
    const loop = new AgentLoop(registry);
    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 5 })) {
      events.push(event);
    }
    expect(events.some(e => e.type === 'warning' && String(e.content).includes('truncated'))).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'completed' });
  });

  it('resumeHistory injects prior history into prompt', async () => {
    const { b } = await import('../../../baml_client/index.js');
    let capturedHistory = '';
    (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async (_tools: string, history: string) => {
      capturedHistory = history;
      return { text: 'Done', tool_calls: [] };
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);
    loop.resumeHistory('[User]\nprevious question\n\n[Assistant]\nprevious answer\n\n');

    for await (const _ of loop.execute('new question')) { /* consume */ }

    expect(capturedHistory).toContain('previous question');
    expect(capturedHistory).toContain('previous answer');
    expect(capturedHistory).toContain('[User]\nnew question');
  });

  it('persists user messages to JSONL when threadDir is set', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Done',
      tool_calls: [],
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);
    const tmpDir = `/tmp/loop-test-${Date.now()}`;
    const { mkdirSync, readFileSync, rmSync } = await import('fs');
    mkdirSync(tmpDir, { recursive: true });

    for await (const _ of loop.execute('test user message', { threadDir: tmpDir })) { /* consume */ }

    const content = readFileSync(`${tmpDir}/messages-current.jsonl`, 'utf-8');
    expect(content).toContain('"role":"user"');
    expect(content).toContain('test user message');
    rmSync(tmpDir, { recursive: true });
  });

  it('carries conversation history across execute() calls', async () => {
    const { b } = await import('../../../baml_client/index.js');
    let historyCapture: string[] = [];
    (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async (_tools: string, history: string) => {
      historyCapture.push(history);
      return { text: 'Done', tool_calls: [] };
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);

    for await (const _ of loop.execute('first question')) { /* consume */ }
    for await (const _ of loop.execute('second question')) { /* consume */ }

    expect(historyCapture[0]).toContain('[User]\nfirst question');
    expect(historyCapture[1]).toContain('[User]\nfirst question');
    expect(historyCapture[1]).toContain('[User]\nsecond question');
  });
});
