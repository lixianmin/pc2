import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LmdMcpClient } from '../../../src/memory/lmd-client.js';
import type { MemoryHit } from '../../../src/types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LmdMcpClient', () => {
  let client: LmdMcpClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new LmdMcpClient({ host: 'localhost', port: 58080 });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queryMemory sends MCP tools/call request and returns results', async () => {
    const hits: MemoryHit[] = [
      { id: '1', content: 'test', type: 'fact', score: 0.9, createdAt: '2026-01-01' },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify(hits) }] },
      }),
    });
    const results = await client.queryMemory({ query: 'test', limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('test');
  });

  it('addMemory sends MCP tools/call request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify({ id: '42' }) }] },
      }),
    });
    const result = await client.addMemory({ content: 'test fact', type: 'fact' });
    expect(result.id).toBe('42');
  });

  it('handles connection failure gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const promise = client.queryMemory({ query: 'test' });
    await vi.advanceTimersByTimeAsync(15000);
    const results = await promise;
    expect(results).toEqual([]);
  });
});
