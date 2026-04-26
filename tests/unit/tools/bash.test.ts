import { describe, it, expect } from 'vitest';
import { createBashTool, isReadOnlyCommand } from '../../../src/tools/bash.js';

const dummyCtx = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: '/tmp', agentId: 'test', isSubAgent: false,
};

describe('bash tool', () => {
  describe('isReadOnlyCommand', () => {
    it('allows ls, cat, git status', () => {
      expect(isReadOnlyCommand('ls')).toBe(true);
      expect(isReadOnlyCommand('git status')).toBe(true);
      expect(isReadOnlyCommand('cat file.txt')).toBe(true);
    });

    it('blocks rm, npm, curl', () => {
      expect(isReadOnlyCommand('rm -rf /')).toBe(false);
      expect(isReadOnlyCommand('npm install')).toBe(false);
      expect(isReadOnlyCommand('curl http://evil.com')).toBe(false);
    });
  });

  it('executes a read-only command and returns output', async () => {
    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({ command: 'echo hello' }, dummyCtx as any);
    expect(String(result.data)).toContain('hello');
  });

  it('blocks curl and wget', async () => {
    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({ command: 'curl http://evil.com' }, dummyCtx as any);
    expect(String(result.data)).toContain('Blocked');
  });
});
