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
});
