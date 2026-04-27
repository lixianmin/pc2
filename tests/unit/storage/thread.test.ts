import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeMeta,
  readMeta,
  updateMeta,
  listThreads,
  loadThreadHistory,
} from '../../../src/storage/thread.js';
import { appendJsonl } from '../../../src/storage/jsonl.js';
import type { ThreadMeta } from '../../../src/storage/thread.js';
import type { Message } from '../../../src/types.js';

let tmpDirs: string[] = [];

function makeTmp(prefix: string) {
  const d = mkdtempSync(join(tmpdir(), `pc2-thread-${prefix}-`));
  tmpDirs.push(d);
  return d;
}

function makeMsg(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: '2026-04-27T10:00:00+08:00' };
}

function makeMeta(overrides: Partial<ThreadMeta> = {}): ThreadMeta {
  return {
    id: 'thread-1',
    createdAt: '2026-04-27T10:00:00+08:00',
    lastActivityAt: '2026-04-27T10:00:00+08:00',
    messageCount: 0,
    preview: '',
    ...overrides,
  };
}

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('thread', () => {
  describe('writeMeta / readMeta', () => {
    it('writeMeta creates meta.json and readMeta reads it back', async () => {
      const dir = makeTmp('wr');
      const meta = makeMeta();
      await writeMeta(dir, meta);
      const result = await readMeta(dir);
      expect(result).toEqual(meta);
    });

    it('readMeta returns null when no meta.json exists', async () => {
      const dir = makeTmp('rn');
      const result = await readMeta(dir);
      expect(result).toBeNull();
    });
  });

  describe('updateMeta', () => {
    it('patches existing meta with partial update', async () => {
      const dir = makeTmp('up');
      const meta = makeMeta({ messageCount: 5, preview: 'old preview' });
      await writeMeta(dir, meta);
      await updateMeta(dir, { messageCount: 10, preview: 'new preview' });
      const result = await readMeta(dir);
      expect(result).not.toBeNull();
      expect(result!.messageCount).toBe(10);
      expect(result!.preview).toBe('new preview');
      expect(result!.id).toBe(meta.id);
      expect(result!.createdAt).toBe(meta.createdAt);
    });
  });

  describe('listThreads', () => {
    it('returns threads sorted by lastActivityAt descending', async () => {
      const dataDir = makeTmp('lt');
      const threadsDir = join(dataDir, 'threads');
      mkdirSync(join(threadsDir, 't1'), { recursive: true });
      mkdirSync(join(threadsDir, 't2'), { recursive: true });
      mkdirSync(join(threadsDir, 't3'), { recursive: true });

      await writeMeta(join(threadsDir, 't1'), makeMeta({
        id: 't1',
        lastActivityAt: '2026-04-27T10:00:00+08:00',
      }));
      await writeMeta(join(threadsDir, 't2'), makeMeta({
        id: 't2',
        lastActivityAt: '2026-04-27T12:00:00+08:00',
      }));
      await writeMeta(join(threadsDir, 't3'), makeMeta({
        id: 't3',
        lastActivityAt: '2026-04-27T11:00:00+08:00',
      }));

      const threads = await listThreads(dataDir);
      expect(threads.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
    });

    it('respects limit parameter', async () => {
      const dataDir = makeTmp('ll');
      const threadsDir = join(dataDir, 'threads');
      mkdirSync(join(threadsDir, 't1'), { recursive: true });
      mkdirSync(join(threadsDir, 't2'), { recursive: true });

      await writeMeta(join(threadsDir, 't1'), makeMeta({
        id: 't1',
        lastActivityAt: '2026-04-27T10:00:00+08:00',
      }));
      await writeMeta(join(threadsDir, 't2'), makeMeta({
        id: 't2',
        lastActivityAt: '2026-04-27T12:00:00+08:00',
      }));

      const threads = await listThreads(dataDir, 1);
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe('t2');
    });

    it('skips threads without meta.json', async () => {
      const dataDir = makeTmp('ls');
      const threadsDir = join(dataDir, 'threads');
      mkdirSync(join(threadsDir, 't1'), { recursive: true });
      mkdirSync(join(threadsDir, 'no-meta'), { recursive: true });

      await writeMeta(join(threadsDir, 't1'), makeMeta({
        id: 't1',
        lastActivityAt: '2026-04-27T10:00:00+08:00',
      }));

      const threads = await listThreads(dataDir);
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe('t1');
    });
  });

  describe('loadThreadHistory', () => {
    it('loads messages-current.jsonl and serializes', async () => {
      const dir = makeTmp('lh');
      const currentFile = join(dir, 'messages-current.jsonl');
      await appendJsonl(currentFile, makeMsg('1', 'hello'));
      await appendJsonl(currentFile, makeMsg('2', 'world'));

      const result = await loadThreadHistory(dir);
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('returns empty string for empty thread', async () => {
      const dir = makeTmp('le');
      const result = await loadThreadHistory(dir);
      expect(result).toBe('');
    });

    it('loads frozen files and current file together', async () => {
      const dir = makeTmp('lf');
      const frozen = join(dir, 'messages-001.jsonl');
      const currentFile = join(dir, 'messages-current.jsonl');
      await appendJsonl(frozen, makeMsg('1', 'frozen msg'));
      await appendJsonl(currentFile, makeMsg('2', 'current msg'));

      const result = await loadThreadHistory(dir);
      expect(result).toContain('frozen msg');
      expect(result).toContain('current msg');
    });
  });
});
