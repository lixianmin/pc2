import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { appendJsonl, readJsonl } from '../../../src/storage/jsonl.js';
import { checkAndFreeze, checkAndSummarize } from '../../../src/storage/summary.js';
import { config } from '../../../src/config.js';
import type { Message } from '../../../src/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-summary');
const THREAD_DIR = path.join(TEST_DIR, 'thread-1');
const CURRENT_FILE = path.join(THREAD_DIR, 'messages-current.jsonl');

function makeMsg(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: '2026-04-25T14:00:00+08:00' };
}

describe('checkAndFreeze', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('does nothing when no messages exist', async () => {
    const tokenCounter = async () => 99999;
    const result = await checkAndFreeze(THREAD_DIR, tokenCounter);
    expect(result).toBe(false);
  });

  it('does nothing when below threshold', async () => {
    await appendJsonl(CURRENT_FILE, makeMsg('1', 'short'));
    const tokenCounter = async () => 100;
    const result = await checkAndFreeze(THREAD_DIR, tokenCounter);
    expect(result).toBe(false);

    const current = await readJsonl(CURRENT_FILE);
    expect(current).toHaveLength(1);
  });

  it('renames current to frozen when threshold exceeded', async () => {
    await appendJsonl(CURRENT_FILE, makeMsg('1', 'hello'));
    const threshold = config.freezeThreshold();
    const tokenCounter = async () => threshold + 1;
    const result = await checkAndFreeze(THREAD_DIR, tokenCounter);
    expect(result).toBe(true);

    const current = await readJsonl(CURRENT_FILE);
    expect(current).toHaveLength(0);

    const frozen = await readJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'));
    expect(frozen).toHaveLength(1);
    expect((frozen[0] as Message).content).toBe('hello');
  });

  it('numbers frozen files sequentially', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'old'));
    await appendJsonl(CURRENT_FILE, makeMsg('2', 'new'));

    const threshold = config.freezeThreshold();
    const tokenCounter = async () => threshold + 1;
    const result = await checkAndFreeze(THREAD_DIR, tokenCounter);
    expect(result).toBe(true);

    const frozen2 = await readJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'));
    expect(frozen2).toHaveLength(1);
    expect((frozen2[0] as Message).content).toBe('new');
  });
});

describe('checkAndSummarize', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('returns null when fewer than 3 frozen files', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));

    const result = await checkAndSummarize(THREAD_DIR);
    expect(result).toBeNull();
  });

  it('returns null when unprocessed summaries exist', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-003.jsonl'), makeMsg('3', 'c'));
    await fs.writeFile(path.join(THREAD_DIR, 'summaries', '001.md'), 'existing', 'utf-8');

    const result = await checkAndSummarize(THREAD_DIR);
    expect(result).toBeNull();
  });

  it('summarizes oldest frozen file and writes to summaries', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'first'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'second'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-003.jsonl'), makeMsg('3', 'third'));

    const summarizeFn = async (msgs: string) => `summary of: ${msgs}`;
    const result = await checkAndSummarize(THREAD_DIR, summarizeFn);
    expect(result).toMatch(/summaries\/001\.md$/);

    const content = await fs.readFile(result!, 'utf-8');
    expect(content).toContain('summary of:');
  });

  it('returns null when summarizeFn not provided and no default', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-003.jsonl'), makeMsg('3', 'c'));

    const result = await checkAndSummarize(THREAD_DIR);
    expect(result).toBeNull();
  });
});

describe('checkAndFreeze and checkAndSummarize integration', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('freeze then summarize pipeline with real file operations', async () => {
    const threshold = config.freezeThreshold();

    for (let i = 0; i < 3; i++) {
      await appendJsonl(CURRENT_FILE, makeMsg(`m${i}`, `message ${i}`));
      await checkAndFreeze(THREAD_DIR, async () => threshold + 1);
    }

    const files = await fs.readdir(THREAD_DIR);
    const frozenFiles = files.filter((f) => f.startsWith('messages-') && f !== 'messages-current.jsonl');
    expect(frozenFiles).toHaveLength(3);

    const summarizeFn = async (msgs: string) => `SUMMARY: ${msgs.slice(0, 20)}`;
    const summaryPath = await checkAndSummarize(THREAD_DIR, summarizeFn);
    expect(summaryPath).toMatch(/summaries\/001\.md$/);

    const content = await fs.readFile(summaryPath!, 'utf-8');
    expect(content).toContain('SUMMARY:');
  });
});
