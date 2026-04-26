import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { writeJsonAtomic, readJson } from '../../../src/storage/json-safe.js';

const TEST_DIR = path.join(__dirname, 'tmp-json-safe');
const TEST_FILE = path.join(TEST_DIR, 'test.json');

describe('json-safe', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writeJsonAtomic creates file with correct content', async () => {
    const data = { id: 'abc', name: 'test' };
    await writeJsonAtomic(TEST_FILE, data);
    const result = await readJson(TEST_FILE);
    expect(result).toEqual(data);
  });

  it('writeJsonAtomic overwrites existing file atomically', async () => {
    await writeJsonAtomic(TEST_FILE, { version: 1 });
    await writeJsonAtomic(TEST_FILE, { version: 2 });
    const result = await readJson(TEST_FILE);
    expect(result.version).toBe(2);
  });

  it('no .tmp file remains after write', async () => {
    await writeJsonAtomic(TEST_FILE, { ok: true });
    const files = await fs.readdir(TEST_DIR);
    expect(files).not.toContain('test.json.tmp');
  });
});
