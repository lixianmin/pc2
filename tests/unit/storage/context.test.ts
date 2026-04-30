import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { appendJsonl } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';
import { assembleContext } from '../../../src/storage/context.js';

const TMP = join(process.cwd(), '.tmp-context-test');

function makeMsg(id: string, role: Message['role'], content: string): Message {
  return { id, role, content, timestamp: '2026-04-25T14:00:00+08:00' };
}

describe('assembleContext', () => {
  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, 'summaries'), { recursive: true });
  });
  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it('returns empty string when no messages', async () => {
    const result = await assembleContext(TMP);
    expect(result).toBe('');
  });

  it('loads only current file when no frozen files', async () => {
    await appendJsonl(join(TMP, 'messages-current.jsonl'), makeMsg('1', 'user', 'hello'));
    const result = await assembleContext(TMP);
    expect(result).toContain('hello');
    expect(result).not.toContain('[Summary]');
  });

  it('loads all frozen files + current when fewer than 2 frozen files', async () => {
    await appendJsonl(join(TMP, 'messages-001.jsonl'), makeMsg('1', 'user', 'frozen1'));
    await appendJsonl(join(TMP, 'messages-current.jsonl'), makeMsg('2', 'user', 'current'));
    const result = await assembleContext(TMP);
    expect(result).toContain('frozen1');
    expect(result).toContain('current');
  });

  it('loads bridge + last frozen + current, skips pre-bridge frozen files when summaries exist', async () => {
    await appendJsonl(join(TMP, 'messages-001.jsonl'), makeMsg('1', 'user', 'oldest-frozen'));
    await appendJsonl(join(TMP, 'messages-002.jsonl'), makeMsg('2', 'user', 'bridge-msg'));
    await appendJsonl(join(TMP, 'messages-003.jsonl'), makeMsg('3', 'user', 'last-frozen'));
    await appendJsonl(join(TMP, 'messages-current.jsonl'), makeMsg('4', 'user', 'current-msg'));

    // summary for messages-001
    await writeFile(join(TMP, 'summaries', '001.md'), 'summary of oldest', 'utf-8');

    const result = await assembleContext(TMP);
    expect(result).toContain('[Summary: 001]');
    expect(result).toContain('summary of oldest');
    expect(result).toContain('bridge-msg');
    expect(result).toContain('last-frozen');
    expect(result).toContain('current-msg');
  });

  it('includes unprocessed summaries (.md) but not processed (.lmd.md)', async () => {
    await appendJsonl(join(TMP, 'messages-001.jsonl'), makeMsg('1', 'user', 'old'));
    await appendJsonl(join(TMP, 'messages-002.jsonl'), makeMsg('2', 'user', 'bridge'));
    await appendJsonl(join(TMP, 'messages-current.jsonl'), makeMsg('3', 'user', 'cur'));

    await writeFile(join(TMP, 'summaries', '001.md'), 'alpha-summary-text', 'utf-8');
    await writeFile(join(TMP, 'summaries', '000.lmd.md'), 'beta-lmd-processed-text', 'utf-8');

    const result = await assembleContext(TMP);
    expect(result).toContain('alpha-summary-text');
    expect(result).not.toContain('beta-lmd-processed-text');
  });

  it('appends inMemorySuffix after disk content', async () => {
    await appendJsonl(join(TMP, 'messages-current.jsonl'), makeMsg('1', 'user', 'disk-msg'));
    const result = await assembleContext(TMP, '[Tool Result: bash]\noutput here\n\n');
    expect(result).toContain('disk-msg');
    expect(result).toContain('output here');
    const diskIdx = result.indexOf('disk-msg');
    const memIdx = result.indexOf('output here');
    expect(memIdx).toBeGreaterThan(diskIdx);
  });

  it('inMemorySuffix appears even when disk is empty', async () => {
    const result = await assembleContext(TMP, '[Tool Result: bash]\nmem only\n\n');
    expect(result).toContain('mem only');
  });
});
