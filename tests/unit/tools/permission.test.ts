import { describe, it, expect } from 'vitest';
import { extractPrefix, classifyCommand } from '../../../src/tools/permission.js';

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

  it('classifies echo with pipe as allow', () => {
    expect(classifyCommand('echo hello | cat')).toEqual({ action: 'allow', prefix: 'echo' });
  });

  it('classifies test command as allow', () => {
    expect(classifyCommand('test -x /tmp/mineru-env/bin/mineru')).toEqual({ action: 'allow', prefix: 'test' });
  });
});
