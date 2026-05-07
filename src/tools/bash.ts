import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolContext } from './types.js';
import type { StepOutcome } from '../types.js';
import { classifyCommand, askUserKeypress } from './permission.js';

const execAsync = promisify(exec);

const READ_ONLY_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'diff', 'stat', 'du',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'pwd', 'which', 'env', 'printenv', 'npx tsc --noEmit',
];

const SHELL_METACHARACTERS = /[;&\n\r|`$()><!#~{}]/;

export function isReadOnlyCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (SHELL_METACHARACTERS.test(trimmed)) return false;
  return READ_ONLY_COMMANDS.some((ro) => trimmed.startsWith(ro));
}

export interface BashToolOptions {
  autoApprove?: boolean;
  cwd?: string;
}

export function isAllowedBySkill(cmd: string, patterns: string[]): boolean {
  // Split on && and ; so "source env && uv pip install" matches "uv*"
  const segments = cmd.split(/&&|;/).map(s => s.trim()).filter(Boolean);
  for (const p of patterns) {
    if (!p.startsWith('Bash(') || !p.endsWith(')')) continue;
    let glob = p.slice(5, -1);
    if (!glob.endsWith('*')) continue;
    const prefix = glob.slice(0, -1);
    for (const seg of segments) {
      if (seg.startsWith(prefix)) return true;
    }
  }
  return false;
}

async function execBash(cmd: string, userTimeout: number | undefined, workspaceRoot: string, cwd?: string): Promise<StepOutcome> {
  const MAX_OUTPUT = 50000; // ~50KB max output — prevents LLM context flooding from large stdout/stderr
  try {
    const timeoutVal = typeof userTimeout === 'number' ? userTimeout : 30_000;
    const timeout = Math.min(Math.max(timeoutVal, 1_000), 600_000);
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: cwd ?? workspaceRoot,
      timeout,
    });
    let output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[truncated]';
    return { data: output, nextPrompt: null, shouldExit: false };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    let output = (e.stdout ?? '') + (e.stderr ? `\n[stderr]\n${e.stderr}` : '') + (e.message ? `\n[error]\n${e.message}` : '');
    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[truncated]';
    return { data: output, nextPrompt: null, shouldExit: false };
  }
}

export function createBashTool(opts: BashToolOptions = {}): Tool {
  return {
    name: 'bash',
    description: 'Execute shell commands. V1 security: user approval required for non-read-only commands.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000, max 600000)' },
      },
      required: ['command'],
    },
    async execute(args, ctx: ToolContext): Promise<StepOutcome> {
      const cmd = args.command as string;
      if (!cmd || typeof cmd !== 'string') {
        return { data: `Missing required parameter: command`, nextPrompt: null, shouldExit: false, isError: true };
      }

      const perm = classifyCommand(cmd);
      if (perm.action === 'deny') {
        return { data: `Denied (hardline): ${perm.reason}`, nextPrompt: null, shouldExit: false, isError: true };
      }

      const skillAllowed = ctx.allowedTools && isAllowedBySkill(cmd, ctx.allowedTools);

      if (perm.action === 'allow' || skillAllowed) {
        return execBash(cmd, args.timeout as number | undefined, ctx.workspaceRoot, opts.cwd);
      }

      const response = await askUserKeypress(`Bash: ${cmd}`);
      if (response === 'n' || response === 'r') {
        const reason = response === 'r' ? 'User rejected all pending requests' : 'User denied this command';
        return { data: `Denied: ${reason}`, nextPrompt: null, shouldExit: false, isError: true };
      }
      return execBash(cmd, args.timeout as number | undefined, ctx.workspaceRoot, opts.cwd);
    },
  };
}
