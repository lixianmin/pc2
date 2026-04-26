import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { appendJsonl, readJsonl, countJsonlLines } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-jsonl');
const TEST_FILE = path.join(TEST_DIR, 'test.jsonl');

const msg: Message = {
  id: 'msg_1',
  role: 'user',
  content: 'hello',
  timestamp: '2026-04-25T14:00:00+08:00',
};

describe('jsonl', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('appendJsonl writes a line and readJsonl reads it back', async () => {
    await appendJsonl(TEST_FILE, msg);
    const lines = await readJsonl<Message>(TEST_FILE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(msg);
  });

  it('appendJsonl handles multiple appends', async () => {
    const msg2: Message = { ...msg, id: 'msg_2', content: 'world' };
    await appendJsonl(TEST_FILE, msg);
    await appendJsonl(TEST_FILE, msg2);
    const lines = await readJsonl<Message>(TEST_FILE);
    expect(lines).toHaveLength(2);
    expect(lines[1].content).toBe('world');
  });

  it('readJsonl skips malformed JSON on last line', async () => {
    await appendJsonl(TEST_FILE, msg);
    await fs.appendFile(TEST_FILE, '{"broken\n');
    const lines = await readJsonl<Message>(TEST_FILE);
    expect(lines).toHaveLength(1);
  });

  it('readJsonl returns empty array for nonexistent file', async () => {
    const lines = await readJsonl<Message>(path.join(TEST_DIR, 'nope.jsonl'));
    expect(lines).toEqual([]);
  });

  it('countJsonlLines returns correct count', async () => {
    await appendJsonl(TEST_FILE, msg);
    await appendJsonl(TEST_FILE, { ...msg, id: 'msg_2' });
    expect(await countJsonlLines(TEST_FILE)).toBe(2);
  });
});
