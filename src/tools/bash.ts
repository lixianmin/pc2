import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

const execAsync = promisify(exec);

const READ_ONLY_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'diff', 'stat', 'du',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'echo', 'pwd', 'which', 'env', 'printenv', 'node -e', 'npx tsc --noEmit',
];

const BLOCKED_COMMANDS = ['curl', 'wget'];

export function isReadOnlyCommand(cmd: string): boolean {
  const base = cmd.trim().split(/\s+/)[0];
  if (BLOCKED_COMMANDS.includes(base)) return false;
  return READ_ONLY_COMMANDS.some((ro) => cmd.trim().startsWith(ro));
}

export interface BashToolOptions {
  autoApprove?: boolean;
  cwd?: string;
}

export function createBashTool(opts: BashToolOptions = {}): Tool {
  return {
    name: 'bash',
    description: 'Execute shell commands. V1 security: user approval required for non-read-only commands.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
    async execute(args): Promise<StepOutcome> {
      const cmd = args.command as string;
      if (BLOCKED_COMMANDS.some((b) => cmd.trim().startsWith(b))) {
        return { data: `Blocked command: ${cmd}. Use web_fetch instead.`, nextPrompt: null, shouldExit: false };
      }
      try {
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: opts.cwd,
          timeout: 30_000,
        });
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
        return { data: output, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const output = (e.stdout ?? '') + (e.stderr ? `\n[stderr]\n${e.stderr}` : '') + (e.message ? `\n[error]\n${e.message}` : '');
        return { data: output, nextPrompt: null, shouldExit: false };
      }
    },
  };
}
