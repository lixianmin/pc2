import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractPrefix, classifyCommand, loadPermissions, savePermission } from '../../../src/tools/permission.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('extractPrefix', () => {
  it('extracts single-word command', () => {
    expect(extractPrefix('ls -la /tmp')).toBe('ls');
  });

  it('extracts from pipeline with ||', () => {
    expect(extractPrefix('ls /tmp 2>/dev/null || echo nope')).toBe('ls');
  });

  it('extracts from pipeline with &&', () => {
    expect(extractPrefix('mkdir -p dir && cp file dir/')).toBe('mkdir');
  });

  it('extracts git subcommand prefix', () => {
    expect(extractPrefix('git push origin main')).toBe('git push');
  });

  it('extracts npm run prefix', () => {
    expect(extractPrefix('npm run test --watch')).toBe('npm run');
  });
});

import { askUserKeypress } from '../../../src/tools/permission.js';

describe('askUserKeypress', () => {
  it('returns n when stdin is not TTY', async () => {
    const result = await askUserKeypress('test question');
    expect(result).toBe('n');
  });
});

describe('classifyCommand', () => {
  it('classifies ls as allow', () => {
    expect(classifyCommand('ls -la')).toEqual({ action: 'allow', prefix: 'ls' });
  });

  it('classifies cp as ask', () => {
    expect(classifyCommand('cp file dest')).toEqual({ action: 'ask', prefix: 'cp' });
  });

  it('classifies rm -rf / as deny', () => {
    const r = classifyCommand('rm -rf /');
    expect(r.action).toBe('deny');
    expect(r.reason).toContain('rm -rf /');
  });

  it('classifies mkfs as deny', () => {
    expect(classifyCommand('mkfs.ext4 /dev/sda').action).toBe('deny');
  });

  it('classifies shutdown as deny', () => {
    expect(classifyCommand('shutdown now').action).toBe('deny');
  });

  it('classifies dd to /dev as deny', () => {
    expect(classifyCommand('dd if=/dev/zero of=/dev/sda').action).toBe('deny');
  });

  it('classifies chmod -R 777 / as deny', () => {
    expect(classifyCommand('chmod -R 777 /').action).toBe('deny');
  });

  it('classifies chown -R root:root / as deny', () => {
    expect(classifyCommand('chown -R root:root /').action).toBe('deny');
  });

  it('classifies echo with pipe as allow', () => {
    expect(classifyCommand('echo hello | cat')).toEqual({ action: 'allow', prefix: 'echo' });
  });

  it('classifies test command as allow', () => {
    expect(classifyCommand('test -x /tmp/mineru-env/bin/mineru')).toEqual({ action: 'allow', prefix: 'test' });
  });
});

describe('permissions persistence', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pc2-perm-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads empty store when no file exists', () => {
    const s = loadPermissions(dir);
    expect(s.bash).toEqual({});
  });

  it('saves and loads permission', () => {
    savePermission(dir, 'bash', 'cp', true);
    const s = loadPermissions(dir);
    expect(s.bash['cp']).toBe(true);
  });
});
