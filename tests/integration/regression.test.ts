import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../src/agent/loop.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createBashTool } from '../../src/tools/bash.js';

vi.mock('../../baml_client/index.js', () => ({
  b: {
    AgentChat: vi.fn(),
    SummarizeHistory: vi.fn(),
  },
}));

describe('regression: llm_error should not exit silently', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pc2-reg-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('yields user-visible error message on llm_error', async () => {
    const { b } = await import('../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API timeout'));

    const registry = new ToolRegistry();
    registry.register(createBashTool());
    const loop = new AgentLoop(registry);

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of loop.execute('test query', { threadDir: join(tempDir, 'thread') })) {
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
