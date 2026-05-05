import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findActivePlanFile } from '../../../src/storage/plan-file.js';

describe('findActivePlanFile', () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
  });

  afterEach(() => {
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  });

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pc2-plan-'));
    tempDirs.push(dir);
    return dir;
  }

  it('returns null when no plan files exist', async () => {
    const tmp = makeTempDir();
    const result = await findActivePlanFile(tmp);
    expect(result).toBeNull();
  });

  it('returns null when temp dir does not exist', async () => {
    const result = await findActivePlanFile('/nonexistent/path/xyz');
    expect(result).toBeNull();
  });

  it('finds plan.md in plan_ subdirectory', async () => {
    const tmp = makeTempDir();
    const planDir = join(tmp, 'plan_abc123');
    mkdirSync(planDir);
    writeFileSync(join(planDir, 'plan.md'), '# Plan\n- [ ] step 1');
    const result = await findActivePlanFile(tmp);
    expect(result).toBe(join(planDir, 'plan.md'));
  });

  it('finds plan.md in a different plan_ subdirectory', async () => {
    const tmp = makeTempDir();
    const planDir = join(tmp, 'plan_xyz789');
    mkdirSync(planDir);
    writeFileSync(join(planDir, 'plan.md'), '# Plan');
    const result = await findActivePlanFile(tmp);
    expect(result).toBe(join(planDir, 'plan.md'));
  });

  it('ignores non-plan subdirectories', async () => {
    const tmp = makeTempDir();
    mkdirSync(join(tmp, 'other_dir'));
    mkdirSync(join(tmp, 'not_plan'));
    const result = await findActivePlanFile(tmp);
    expect(result).toBeNull();
  });

  it('returns null when plan_ dir exists but no plan.md inside', async () => {
    const tmp = makeTempDir();
    mkdirSync(join(tmp, 'plan_empty'));
    const result = await findActivePlanFile(tmp);
    expect(result).toBeNull();
  });

  it('finds first plan.md when multiple plan dirs exist', async () => {
    const tmp = makeTempDir();
    const first = join(tmp, 'plan_aaa');
    const second = join(tmp, 'plan_bbb');
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(join(first, 'plan.md'), '# First');
    writeFileSync(join(second, 'plan.md'), '# Second');
    const result = await findActivePlanFile(tmp);
    expect(result).not.toBeNull();
    // Returns first found (readdir order)
    expect(result).toMatch(/plan\.md$/);
  });
});
