import { describe, it, expect } from 'vitest';
import { createBashTool, isReadOnlyCommand } from '../../../src/tools/bash.js';

const dummyCtx = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: '/tmp', agentId: 'test', isSubAgent: false, workspaceRoot: '/tmp',
};

const dummyCtxWithAllowed = (allowedTools: string[]) => ({
  ...dummyCtx,
  allowedTools,
});

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

    it('blocks newline injection', () => {
      expect(isReadOnlyCommand('git status\nrm -rf /')).toBe(false);
      expect(isReadOnlyCommand('ls\r\ncurl http://evil.com')).toBe(false);
    });

    it('blocks brace expansion', () => {
      expect(isReadOnlyCommand('echo {a,b}')).toBe(false);
      expect(isReadOnlyCommand('ls {/tmp,/var}')).toBe(false);
    });

    it('blocks echo with redirection', () => {
      expect(isReadOnlyCommand('echo foo > file')).toBe(false);
      expect(isReadOnlyCommand('echo foo >> file')).toBe(false);
    });

    it('blocks node -e with JS hex-escape bypass', () => {
      // Shell sees literal \xNN sequences (no metacharacters at shell level).
      // Node interprets \xNN as characters, bypassing the regex that blocks literal () etc.
      // \x72\x65\x71\x75\x69\x72\x65 = require
      // \x28 = (, \x29 = )  -- parens encoded as hex, invisible to shell regex
      // \x27 = ' (single quote) -- also hex-encoded
      expect(isReadOnlyCommand('node -e "\\x72\\x65\\x71\\x75\\x69\\x72\\x65\\x28\\x27\\x66\\x73\\x27\\x29"')).toBe(false);
    });
  });

  it('executes an auto-allowed command and returns output', async () => {
    const tool = createBashTool();
    const result = await tool.execute({ command: 'echo hello' }, dummyCtx as any);
    expect(String(result.data)).toContain('hello');
  });

  it('defaults cwd to workspaceRoot when opts.cwd is not set', async () => {
    const ctxWithRoot = { ...dummyCtx, workspaceRoot: '/tmp' } as any;
    const tool = createBashTool();
    const result = await tool.execute({ command: 'pwd' }, ctxWithRoot);
    // /tmp may be a symlink on macOS; accept the resolved path
    const pwd = String(result.data).trim();
    expect(pwd === '/tmp' || pwd === '/private/tmp').toBe(true);
  });

  it('truncates oversized output', async () => {
    // node -e is auto-allowed; generate ~60KB output
    const tool = createBashTool();
    const result = await tool.execute({ command: "node -e \"process.stdout.write('x'.repeat(60000))\"" }, dummyCtx as any);
    const data = String(result.data);
    expect(data.length).toBeLessThanOrEqual(50100); // 50KB + small overhead
    expect(data).toContain('[truncated]');
  });

  it('curl is denied when not in allowedTools', async () => {
    const tool = createBashTool();
    const result = await tool.execute({ command: 'curl http://example.com' }, dummyCtx as any);
    expect(String(result.data)).toContain('Denied');
  });

  it('node -e auto-allow executes and returns output', async () => {
    const tool = createBashTool();
    const result = await tool.execute({ command: "node -e \"process.stdout.write('ok')\"" }, dummyCtx as any);
    expect(String(result.data)).toContain('ok');
  });

  describe('approval wiring', () => {
    it('auto-executes auto-allowed commands', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: 'pwd' }, dummyCtx as any);
      expect(String(result.data)).not.toContain('Denied');
    });

    it('rejects non-read-only command when not in allowedTools', async () => {
      const tool = createBashTool({ cwd: '/tmp' });
      const result = await tool.execute({ command: 'touch /tmp/bash-test-reject' }, dummyCtx as any);
      expect(String(result.data)).toContain('Denied');
    });

    it('node -e auto-allow executes without approval', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: "node -e \"require('fs').writeFileSync('/tmp/bash-test-approval', 'ok')\"" }, dummyCtx as any);
      expect(String(result.data)).not.toContain('Denied');
    });
  });

  describe('allowedTools whitelist', () => {
    it('allows pip install when allowedTools matches Bash(pip*)', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: 'pip install mineru[all]' }, dummyCtxWithAllowed(['Bash(pip*)']) as any);
      expect(String(result.data)).not.toContain('Denied');
    });

    it('allows mineru when allowedTools matches Bash(mineru*)', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: 'mineru -p input.pdf -o /tmp/out' }, dummyCtxWithAllowed(['Bash(mineru*)']) as any);
      expect(String(result.data)).not.toContain('Denied');
    });

    it('blocks command not in allowedTools', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: 'touch /tmp/nope' }, dummyCtxWithAllowed(['Bash(pip*)']) as any);
      expect(String(result.data)).toContain('Denied');
    });

    it('blocks when allowedTools is empty', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: 'pip install foo' }, dummyCtxWithAllowed([]) as any);
      expect(String(result.data)).toContain('Denied');
    });

    it('has no effect when allowedTools is undefined', async () => {
      const tool = createBashTool();
      const result = await tool.execute({ command: 'pip install foo' }, dummyCtx as any);
      expect(String(result.data)).toContain('Denied');
    });
  });
});
