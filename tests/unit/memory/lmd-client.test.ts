import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LmdMcpClient } from '../../../src/memory/lmd-client.js';
import type { MemoryHit } from '../../../src/types.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mcpResponse(id: number, data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({
      jsonrpc: '2.0',
      id,
      result: data,
    }),
  };
}

function mcpError(id: number, message: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message },
    }),
  };
}

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

  async function drainRetry<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promise;
  }

  describe('queryMemory', () => {
    it('sends correct MCP request format', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, []));
      await client.queryMemory({ query: 'hello', limit: 3 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:58080/mcp');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('tools/call');
      expect(body.params).toEqual({ name: 'memory_query', arguments: { query: 'hello', limit: 3 } });
    });

    it('defaults limit to 5 when not specified', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, []));
      await client.queryMemory({ query: 'test' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.arguments.limit).toBe(5);
    });

    it('returns multiple memory hits with all types', async () => {
      const raw = [
        { id: 1, content: 'likes python', type: 'fact', score: 0.95, created_at: '2026-01-01' },
        { id: 2, content: 'visited Tokyo', type: 'episode', score: 0.8, created_at: '2026-02-01' },
        { id: 3, content: 'friend of Alice', type: 'relation', score: 0.7, created_at: '2026-03-01' },
      ];
      mockFetch.mockResolvedValueOnce(mcpResponse(1, raw));

      const results = await client.queryMemory({ query: 'test' });
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('1');
      expect(results[0].createdAt).toBe('2026-01-01');
      expect(results[0].type).toBe('fact');
      expect(results[1].type).toBe('episode');
      expect(results[2].type).toBe('relation');
    });

    it('returns empty array when no matches', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, []));
      const results = await client.queryMemory({ query: 'nonexistent' });
      expect(results).toEqual([]);
    });

    it('returns empty array on server-side MCP error after retries', async () => {
      mockFetch.mockResolvedValue(mcpError(1, 'internal error'));
      const results = await drainRetry(client.queryMemory({ query: 'test' }));
      expect(results).toEqual([]);
    });

    it('returns empty array on HTTP error after retries', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const results = await drainRetry(client.queryMemory({ query: 'test' }));
      expect(results).toEqual([]);
    });

    it('returns empty array on connection refused after retries', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const results = await drainRetry(client.queryMemory({ query: 'test' }));
      expect(results).toEqual([]);
    });

    it('retries once then succeeds', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(mcpResponse(2, [{ id: 1, content: 'found', type: 'fact', score: 0.9, created_at: '2026-01-01' }]));

      const results = await drainRetry(client.queryMemory({ query: 'test' }));
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('found');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries 3 times (4 total calls) then gives up', async () => {
      mockFetch.mockRejectedValue(new Error('fail'));

      const results = await drainRetry(client.queryMemory({ query: 'test' }));
      expect(results).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('addMemory', () => {
    it('sends correct MCP request for fact type', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, { id: 42, type: 'fact' }));
      await client.addMemory({ content: 'test fact', type: 'fact' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params).toEqual({ name: 'memory_add', arguments: { content: 'test fact', type: 'fact' } });
    });

    it('handles episode type', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, { id: 43, type: 'episode' }));
      const result = await client.addMemory({ content: 'went hiking', type: 'episode' });
      expect(result.id).toBe('43');
    });

    it('handles relation type', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, { id: 44, type: 'relation' }));
      const result = await client.addMemory({ content: 'Bob is colleague of Alice', type: 'relation' });
      expect(result.id).toBe('44');
    });

    it('throws after retries exhausted', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(drainRetry(client.addMemory({ content: 'test', type: 'fact' })))
        .rejects.toThrow('MCP call failed after 3 retries');
    });
  });

  describe('deleteMemory', () => {
    it('sends correct MCP request', async () => {
      mockFetch.mockResolvedValueOnce(mcpResponse(1, null));
      await client.deleteMemory({ id: '42' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params).toEqual({ name: 'memory_delete', arguments: { id: '42' } });
    });
  });

  describe('JSON-RPC id increment', () => {
    it('increments id on each call', async () => {
      mockFetch
        .mockResolvedValueOnce(mcpResponse(1, []))
        .mockResolvedValueOnce(mcpResponse(2, { id: '1' }))
        .mockResolvedValueOnce(mcpResponse(3, null));

      await client.queryMemory({ query: 'a' });
      await client.addMemory({ content: 'b', type: 'fact' });
      await client.deleteMemory({ id: '1' });

      const ids = mockFetch.mock.calls.map((call: [string, RequestInit]) => JSON.parse(call[1].body).id);
      expect(ids).toEqual([1, 2, 3]);
    });
  });
});
