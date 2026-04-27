import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeMeta, listThreads, loadThreadHistory } from '../../src/storage/thread.js';

describe('integration: session management', () => {
  let tempDir: string;
  let threadDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pc2-session-'));
    threadDir = join(tempDir, 'threads', 'test-session');
    mkdirSync(threadDir, { recursive: true });
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('listThreads returns empty for empty directory', async () => {
    const threads = await listThreads(tempDir);
    expect(threads).toEqual([]);
  });

  it('loadThreadHistory returns empty string for empty thread', async () => {
    const history = await loadThreadHistory(threadDir);
    expect(history).toBe('');
  });

  it('full round-trip: write meta -> list -> load history', async () => {
    await writeMeta(threadDir, {
      id: 'test-session',
      createdAt: '2026-04-27T14:30:28+08:00',
      lastActivityAt: '2026-04-27T14:35:00+08:00',
      messageCount: 3,
      preview: 'test question',
    });

    const { appendJsonl } = await import('../../src/storage/jsonl.js');
    await appendJsonl(join(threadDir, 'messages-current.jsonl'), {
      id: 'm1', role: 'user', content: 'test question', timestamp: 't1',
    });
    await appendJsonl(join(threadDir, 'messages-current.jsonl'), {
      id: 'm2', role: 'assistant', content: 'test answer', timestamp: 't2',
    });

    const threads = await listThreads(tempDir);
    expect(threads).toHaveLength(1);
    expect(threads[0].preview).toBe('test question');

    const history = await loadThreadHistory(threadDir);
    expect(history).toContain('[User]\ntest question');
    expect(history).toContain('[Assistant]\ntest answer');
  });
});
