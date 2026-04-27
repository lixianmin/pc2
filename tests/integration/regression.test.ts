import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createBashTool } from '../../src/tools/bash.js';
import { makeThreadDir } from '../../src/cli/chat.js';

vi.mock('../../baml_client/index.js', () => ({
  b: {
    AgentChat: vi.fn(),
    SummarizeHistory: vi.fn(),
  },
}));

describe('regression: timezone in thread dir', () => {
  it('uses Asia/Shanghai timezone, not UTC', () => {
    const dir = makeThreadDir();
    const tsPart = dir.split('/').pop()!;

    const now = new Date();
    const utcHour = now.getUTCHours();
    const cstHour = (utcHour + 8) % 24;

    const hourInDir = parseInt(tsPart.split('-')[3], 10);

    expect(hourInDir).toBe(cstHour);
    expect(hourInDir).not.toBe(utcHour);
  });
});

describe('regression: llm_error should not exit silently', () => {
  it('yields user-visible error message on llm_error', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API timeout'));

    const registry = new ToolRegistry();
    registry.register(createBashTool());
    const loop = new AgentLoop(registry);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of loop.execute('test query')) {
      events.push(event);
    }

    const textOrWarningEvents = events.filter(
      e => e.type === 'text' || e.type === 'warning'
    );
    expect(textOrWarningEvents.length).toBeGreaterThanOrEqual(2);
    expect(String(textOrWarningEvents[textOrWarningEvents.length - 1].content)).toContain('LLM');
    expect(events[events.length - 1].type).toBe('done');
    expect(events[events.length - 1].reason).toBe('llm_error');
  });
});
