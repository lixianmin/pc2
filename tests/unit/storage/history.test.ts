import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getFrozenFiles, getCurrentFile, getBridgeFile } from '../../../src/storage/history.js';
import { appendJsonl } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-history');
const THREAD_DIR = path.join(TEST_DIR, 'thread-1');

function makeMsg(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: '2026-04-25T14:00:00+08:00' };
}

describe('history', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('getCurrentFile returns messages-current.jsonl path', () => {
    expect(getCurrentFile(THREAD_DIR)).toMatch(/messages-current\.jsonl$/);
  });

  it('getFrozenFiles returns sorted frozen files', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));
    const frozen = await getFrozenFiles(THREAD_DIR);
    expect(frozen).toHaveLength(2);
    expect(frozen[0]).toMatch(/messages-001\.jsonl$/);
  });

  describe('getBridgeFile', () => {
    it('returns null when no frozen files', async () => {
      const result = await getBridgeFile(THREAD_DIR);
      expect(result).toBeNull();
    });

    it('returns null when only one frozen file', async () => {
      await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
      const result = await getBridgeFile(THREAD_DIR);
      expect(result).toBeNull();
    });

    it('returns second-to-last frozen file as bridge', async () => {
      await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
      await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));
      await appendJsonl(path.join(THREAD_DIR, 'messages-003.jsonl'), makeMsg('3', 'c'));
      const result = await getBridgeFile(THREAD_DIR);
      expect(result).toMatch(/messages-002\.jsonl$/);
    });
  });
});
