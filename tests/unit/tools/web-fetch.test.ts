import { describe, it, expect } from 'vitest';
import { isUrlAllowed, createWebFetchTool } from '../../../src/tools/web-fetch.js';

describe('isUrlAllowed (SSRF protection)', () => {
  it('blocks cloud metadata endpoint', () => {
    expect(isUrlAllowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('blocks localhost', () => {
    expect(isUrlAllowed('http://localhost:8080/admin')).toBe(false);
  });

  it('blocks 127.0.0.1', () => {
    expect(isUrlAllowed('http://127.0.0.1:3000/api')).toBe(false);
  });

  it('blocks private network 10.x', () => {
    expect(isUrlAllowed('http://10.0.0.1/internal')).toBe(false);
  });

  it('blocks private network 192.168.x', () => {
    expect(isUrlAllowed('http://192.168.1.1/router')).toBe(false);
  });

  it('blocks private network 172.16.x', () => {
    expect(isUrlAllowed('http://172.16.0.1/internal')).toBe(false);
  });

  it('blocks 0.0.0.0', () => {
    expect(isUrlAllowed('http://0.0.0.0:3000/')).toBe(false);
  });

  it('allows public HTTPS URLs', () => {
    expect(isUrlAllowed('https://example.com/page')).toBe(true);
  });

  it('allows public HTTP URLs', () => {
    expect(isUrlAllowed('http://example.com/page')).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isUrlAllowed('not-a-url')).toBe(false);
  });
});

describe('createWebFetchTool execute', () => {
  const dummyCtx = {};

  it('returns JSON responses without HTML stripping', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{"items": [{"name": "test"}]}', {
      headers: { 'content-type': 'application/json' },
    });
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://api.example.com/data' }, dummyCtx as any);
    expect(String(result.data)).toContain('"items"');
    expect(String(result.data)).toContain('"test"');
    globalThis.fetch = originalFetch;
  });

  it('detects JSON by content even without application/json content-type', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{"key": "value"}', {
      headers: { 'content-type': 'text/html' },
    });
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/api' }, dummyCtx as any);
    expect(String(result.data)).toContain('"key"');
    globalThis.fetch = originalFetch;
  });

  it('strips script and style tags from HTML', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      '<html><head><script>var x = 1;</script><style>.x{color:red}</style></head><body><p>Hello</p></body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/page' }, dummyCtx as any);
    expect(String(result.data)).toContain('Hello');
    expect(String(result.data)).not.toContain('var x');
    expect(String(result.data)).not.toContain('color:red');
    globalThis.fetch = originalFetch;
  });

  it('allows JSON responses longer than 5000 chars', async () => {
    const originalFetch = globalThis.fetch;
    const longJson = '{"data": "' + 'x'.repeat(8000) + '"}';
    globalThis.fetch = async () => new Response(longJson, {
      headers: { 'content-type': 'application/json' },
    });
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://api.example.com/big' }, dummyCtx as any);
    expect(String(result.data).length).toBeGreaterThan(5000);
    globalThis.fetch = originalFetch;
  });

  it('returns fetch error on failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network fail'); };
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/fail' }, dummyCtx as any);
    expect(String(result.data)).toContain('Fetch error');
    globalThis.fetch = originalFetch;
  });

  it('blocks SSRF URLs', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://127.0.0.1:3000/api' }, dummyCtx as any);
    expect(String(result.data)).toContain('URL not allowed');
  });

  it('does not truncate large HTML pages below limit', async () => {
    const originalFetch = globalThis.fetch;
    const items = Array.from({ length: 100 }, (_, i) =>
      `<article><h2>Repo ${i}: some-org/some-repo-name-${i}</h2><p>Description of repo ${i} with some details about what it does and why it is trending this week</p></article>`
    ).join('\n');
    const html = `<html><body>${items}</body></html>`;
    globalThis.fetch = async () => new Response(html, {
      headers: { 'content-type': 'text/html' },
    });
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://github.com/trending' }, dummyCtx as any);
    const data = String(result.data);
    expect(data).toContain('Repo 99');
    expect(data).toContain('Repo 0');
    expect(data.length).toBeLessThanOrEqual(50000);
    globalThis.fetch = originalFetch;
  });
});
