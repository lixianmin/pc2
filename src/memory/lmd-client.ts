import type { MemoryHit } from '../types.js';

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
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
    const json = (await resp.json()) as { result?: { content?: { text?: string }[] }; error?: { message: string } };
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);
    const textContent = json.result?.content?.[0]?.text;
    return textContent ? JSON.parse(textContent) : null;
  }

  async queryMemory(params: { query: string; limit?: number }): Promise<MemoryHit[]> {
    try {
      return (await this.callWithRetry('tools/call', {
        name: 'memory_query',
        arguments: { query: params.query, limit: params.limit ?? 5 },
      })) as MemoryHit[];
    } catch {
      return [];
    }
  }

  async addMemory(params: { content: string; type: 'fact' | 'episode' | 'relation' }): Promise<{ id: string }> {
    const result = await this.callWithRetry('tools/call', {
      name: 'memory_add',
      arguments: { content: params.content, type: params.type },
    });
    return result as { id: string };
  }

  async deleteMemory(params: { id: string }): Promise<void> {
    await this.callWithRetry('tools/call', {
      name: 'memory_delete',
      arguments: { id: params.id },
    });
  }
}
