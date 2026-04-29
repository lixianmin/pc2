import type { MemoryHit } from '../types.js';
import { logo } from '../lib/logo.js';

export interface LmdMcpClientOptions {
  host: string;
  port: number;
}

export class LmdMcpClient {
  private url: string;
  private nextId = 1;

  constructor(opts: LmdMcpClientOptions) {
    this.url = `http://${opts.host}:${opts.port}/mcp`;
  }

  private async callWithRetry(method: string, params: Record<string, unknown>): Promise<unknown> {
    const delays = [2000, 4000, 8000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.call(method, params);
      } catch {
        if (attempt < delays.length) {
          logo.warn('MCP call retry', { method, attempt: attempt + 1, delay_ms: delays[attempt] });
          await new Promise(r => setTimeout(r, delays[attempt]));
        } else {
          throw new Error(`MCP call failed after ${delays.length} retries: ${method}`);
        }
      }
    }
    throw new Error('unreachable');
  }

  private async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const body = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    };
    logo.debug('MCP request', { method });
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
    const json = (await resp.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);
    return json.result ?? null;
  }

  async queryMemory(params: { query: string; limit?: number }): Promise<MemoryHit[]> {
    try {
      const raw = (await this.callWithRetry('tools/call', {
        name: 'memory_query',
        arguments: { query: params.query, limit: params.limit ?? 5 },
      })) as Array<{ id: number; content: string; type: string; score: number; created_at: string }>;
      const results: MemoryHit[] = raw.map(r => ({
        id: String(r.id),
        content: r.content,
        type: r.type as MemoryHit['type'],
        score: r.score,
        createdAt: r.created_at,
      }));
      logo.info('Memory query', { query_len: params.query.length, hits: results.length });
      return results;
    } catch {
      logo.warn('Memory query failed, returning empty', { query_len: params.query.length });
      return [];
    }
  }

  async addMemory(params: { content: string; type: 'fact' | 'episode' | 'relation' }): Promise<{ id: string }> {
    const raw = (await this.callWithRetry('tools/call', {
      name: 'memory_add',
      arguments: { content: params.content, type: params.type },
    })) as { id: number };
    const id = String(raw.id);
    logo.info('Memory add', { type: params.type, content_len: params.content.length, id });
    return { id };
  }

  async deleteMemory(params: { id: string }): Promise<void> {
    await this.callWithRetry('tools/call', {
      name: 'memory_delete',
      arguments: { id: params.id },
    });
  }
}
