import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createFileReadTool } from '../../../src/tools/file-read.js';
import { createFileWriteTool } from '../../../src/tools/file-write.js';
import { createFileEditTool } from '../../../src/tools/file-edit.js';
import type { ToolContext } from '../../../src/tools/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-file-tools');
const dummyCtx: ToolContext = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: TEST_DIR, agentId: 'test', isSubAgent: false, workspaceRoot: TEST_DIR,
};

describe('file tools', () => {
  beforeEach(async () => { await fs.mkdir(TEST_DIR, { recursive: true }); });
  afterEach(async () => { await fs.rm(TEST_DIR, { recursive: true, force: true }); });

  describe('file_read', () => {
    it('reads entire file', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath }, dummyCtx);
      expect(result.data).toContain('line1');
      expect(result.data).toContain('line3');
    });

    it('reads specific line range', async () => {
      const filePath = path.join(TEST_DIR, 'lines.txt');
      await fs.writeFile(filePath, 'a\nb\nc\nd\ne', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath, offset: 2, limit: 2 }, dummyCtx);
      expect(result.data).toContain('b');
      expect(result.data).toContain('c');
      expect(result.data).not.toContain('a');
    });

    it('returns error for nonexistent file', async () => {
      const tool = createFileReadTool();
      const result = await tool.execute({ path: path.join(TEST_DIR, 'nope.txt') }, dummyCtx);
      expect(String(result.data)).toContain('not found');
    });

    it('rejects offset 0 (produces garbage with negative slice)', async () => {
      const filePath = path.join(TEST_DIR, 'lines.txt');
      await fs.writeFile(filePath, 'a\nb\nc\nd\ne', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath, offset: 0, limit: 2 }, dummyCtx);
      expect(result.isError).toBe(true);
      expect(String(result.data)).toContain('offset');
    });

    it('rejects negative offset', async () => {
      const filePath = path.join(TEST_DIR, 'lines.txt');
      await fs.writeFile(filePath, 'a\nb\nc', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath, offset: -1, limit: 2 }, dummyCtx);
      expect(result.isError).toBe(true);
      expect(String(result.data)).toContain('offset');
    });
  });

  describe('file_write', () => {
    it('creates a new file', async () => {
      const filePath = path.join(TEST_DIR, 'new.txt');
      const tool = createFileWriteTool();
      await tool.execute({ path: filePath, content: 'hello' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('hello');
    });

    it('overwrites existing file', async () => {
      const filePath = path.join(TEST_DIR, 'overwrite.txt');
      await fs.writeFile(filePath, 'old', 'utf-8');
      const tool = createFileWriteTool();
      await tool.execute({ path: filePath, content: 'new' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new');
    });
  });

  describe('file_edit', () => {
    it('replaces exact string match', async () => {
      const filePath = path.join(TEST_DIR, 'edit.txt');
      await fs.writeFile(filePath, 'foo bar baz', 'utf-8');
      const tool = createFileEditTool();
      await tool.execute({ path: filePath, old_string: 'bar', new_string: 'qux' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('foo qux baz');
    });

    it('fails when old_string not found', async () => {
      const filePath = path.join(TEST_DIR, 'edit2.txt');
      await fs.writeFile(filePath, 'hello', 'utf-8');
      const tool = createFileEditTool();
      const result = await tool.execute({ path: filePath, old_string: 'xyz', new_string: 'abc' }, dummyCtx);
      expect(String(result.data)).toContain('not found');
    });

    it('rejects empty old_string (would corrupt file)', async () => {
      const filePath = path.join(TEST_DIR, 'edit3.txt');
      await fs.writeFile(filePath, 'original content', 'utf-8');
      const tool = createFileEditTool();
      const result = await tool.execute({ path: filePath, old_string: '', new_string: 'prefix' }, dummyCtx);
      expect(result.isError).toBe(true);
      expect(String(result.data)).toContain('empty');
      // File must be unchanged
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('original content');
    });

    it('replaces all occurrences, not just first', async () => {
      const filePath = path.join(TEST_DIR, 'edit4.txt');
      await fs.writeFile(filePath, 'cat dog cat', 'utf-8');
      const tool = createFileEditTool();
      await tool.execute({ path: filePath, old_string: 'cat', new_string: 'bird' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('bird dog bird');
    });

    it('replaces single occurrence correctly', async () => {
      const filePath = path.join(TEST_DIR, 'edit5.txt');
      await fs.writeFile(filePath, 'foo bar baz', 'utf-8');
      const tool = createFileEditTool();
      await tool.execute({ path: filePath, old_string: 'bar', new_string: 'qux' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('foo qux baz');
    });
  });

  describe('path sandbox', () => {
    it('file_read rejects path traversal', async () => {
      const tool = createFileReadTool();
      const result = await tool.execute({ path: '/etc/passwd' }, dummyCtx);
      expect(String(result.data)).toContain('outside workspace');
    });

    it('file_write rejects path traversal', async () => {
      const tool = createFileWriteTool();
      const result = await tool.execute({ path: '/tmp/evil.txt', content: 'pwned' }, dummyCtx);
      expect(String(result.data)).toContain('outside workspace');
    });

    it('file_edit rejects path traversal', async () => {
      const tool = createFileEditTool();
      const result = await tool.execute({ path: '/etc/hosts', old_string: 'x', new_string: 'y' }, dummyCtx);
      expect(String(result.data)).toContain('outside workspace');
    });

    it('file_read allows path within workspace', async () => {
      const filePath = path.join(TEST_DIR, 'safe.txt');
      await fs.writeFile(filePath, 'safe content', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath }, dummyCtx);
      expect(String(result.data)).toContain('safe content');
    });
  });
});
