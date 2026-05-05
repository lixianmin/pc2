import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { runDream } from '../../../src/reflect/dream.js';
import type { LmdMcpClient } from '../../../src/memory/lmd-client.js';
import { appendJsonl } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';

vi.mock('../../../baml_client/index.js', () => ({
  b: {
    ExtractMemory: vi.fn(),
  },
}));

const mockLmd: any = {
  addMemory: vi.fn().mockResolvedValue({ id: '1' }),
  queryMemory: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
};

const TEST_DIR = path.join(__dirname, 'tmp-dream');
const THREAD_DIR = path.join(TEST_DIR, 'threads', 'thread-1');

function makeMsg(id: string, role: string, content: string): Message {
  return { id, role: role as any, content, timestamp: '2026-04-25T14:00:00+08:00' };
}

describe('Dream', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('runDream processes unprocessed summaries', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.ExtractMemory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { content: 'User prefers dark mode', type: 'fact' },
    ]);

    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'user', 'I like dark mode'));
    await fs.writeFile(path.join(THREAD_DIR, 'summaries', '001.md'), 'Summary of dark mode discussion', 'utf-8');

    const result = await runDream(TEST_DIR, mockLmd as LmdMcpClient);
    expect(result.processed).toBe(1);
    expect(mockLmd.addMemory).toHaveBeenCalledWith({ content: 'User prefers dark mode' });

    const files = await fs.readdir(path.join(THREAD_DIR, 'summaries'));
    expect(files).toContain('001.lmd.md');
    expect(files).not.toContain('001.md');
  });

  it('runDream returns empty result when no threads', async () => {
    const emptyDir = path.join(TEST_DIR, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });
    const result = await runDream(emptyDir, mockLmd as LmdMcpClient);
    expect(result.processed).toBe(0);
  });

  it('runDream handles BAML errors gracefully', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.ExtractMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('BAML error'));

    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('1', 'user', 'test'));
    await fs.writeFile(path.join(THREAD_DIR, 'summaries', '002.md'), 'Summary', 'utf-8');

    const result = await runDream(TEST_DIR, mockLmd as LmdMcpClient);
    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
  });
});
