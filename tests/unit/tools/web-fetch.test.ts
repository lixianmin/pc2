import { describe, it, expect } from 'vitest';
import { isUrlAllowed } from '../../../src/tools/web-fetch.js';

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
