import { describe, it, expect } from 'vitest';
import { createBashTool, isReadOnlyCommand } from '../../../src/tools/bash.js';

const dummyCtx = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: '/tmp', agentId: 'test', isSubAgent: false, workspaceRoot: '/tmp',
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

    it('blocks shell metacharacter chaining', () => {
      expect(isReadOnlyCommand('ls; rm -rf /')).toBe(false);
      expect(isReadOnlyCommand('cat file && rm file')).toBe(false);
      expect(isReadOnlyCommand('echo hello | cat')).toBe(false);
      expect(isReadOnlyCommand('echo $(cat /etc/passwd)')).toBe(false);
      expect(isReadOnlyCommand('ls `rm -rf /`')).toBe(false);
    });

    it('blocks echo with redirection', () => {
      expect(isReadOnlyCommand('echo foo > file')).toBe(false);
      expect(isReadOnlyCommand('echo foo >> file')).toBe(false);
    });
  });

  it('executes a read-only command and returns output', async () => {
    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({ command: 'echo hello' }, dummyCtx as any);
    expect(String(result.data)).toContain('hello');
  });

  it('curl requires approval when autoApprove is false', async () => {
    const tool = createBashTool({ autoApprove: false });
    const result = await tool.execute({ command: 'curl http://example.com' }, dummyCtx as any);
    expect(String(result.data)).toContain('requires approval');
  });

  it('curl executes when autoApprove is true', async () => {
    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({ command: 'curl --version' }, dummyCtx as any);
    expect(String(result.data)).not.toContain('Blocked');
    expect(String(result.data)).not.toContain('requires approval');
  });

  describe('approval wiring', () => {
    it('auto-executes read-only commands without autoApprove', async () => {
      const tool = createBashTool({ autoApprove: false });
      const result = await tool.execute({ command: 'pwd' }, dummyCtx as any);
      expect(String(result.data)).not.toContain('requires approval');
    });

    it('rejects non-read-only command when autoApprove is false', async () => {
      const tool = createBashTool({ autoApprove: false, cwd: '/tmp' });
      const result = await tool.execute({ command: 'touch /tmp/bash-test-reject' }, dummyCtx as any);
      expect(String(result.data)).toContain('requires approval');
    });

    it('executes non-read-only command when autoApprove is true', async () => {
      const tool = createBashTool({ autoApprove: true, cwd: '/tmp' });
      const result = await tool.execute({ command: 'touch /tmp/bash-test-approval' }, dummyCtx as any);
      expect(String(result.data)).not.toContain('requires approval');
    });
  });
});
