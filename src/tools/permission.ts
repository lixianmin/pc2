import type { AgentMode } from './mode.js';
import { parseKeypress } from '../cli/parse-keypress.js';

export const PermissionAction = {
  DENY: 'deny',
  ALLOW: 'allow',
  ASK: 'ask',
} as const;
export type PermissionAction = (typeof PermissionAction)[keyof typeof PermissionAction];

export interface PermissionResult {
  action: PermissionAction;
  prefix: string;
  reason?: string;
}

const HARDLINE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-rf\s+\//, reason: 'rm -rf / is never allowed' },
  { pattern: /\bmkfs\b/, reason: 'mkfs is never allowed' },
  { pattern: /\bdd\s+.*of=\/dev\//, reason: 'dd to /dev/ is never allowed' },
  { pattern: /[>&]\s*\/dev\/sd[a-z]\b/, reason: 'writing to block device is never allowed' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: 'system power commands are never allowed' },
  { pattern: /:\s*\(\s*\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;/, reason: 'fork bomb is never allowed' },
  { pattern: /\bkill\s+-9\s+-1\b/, reason: 'kill -9 -1 is never allowed' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, reason: 'chmod 777 on root is never allowed' },
  { pattern: /\bchown\s+-R\s+root:root\s+\//, reason: 'chown -R root:root on root is never allowed' },
];

// Commands whose prefix includes the first 2 tokens (e.g. git <subcmd>, npm <subcmd>)
const PREFIX_FAMILIES = new Set([
  'git', 'npm', 'npx', 'tsc', 'python', 'python3', 'node',
]);

const AUTO_ALLOW_PREFIXES = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'du', 'stat', 'wc', 'diff',
  'echo', 'test', '[', 'pwd', 'which', 'env', 'printenv', 'whoami', 'date', 'uname',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npx tsc --noEmit', 'node -e', 'node -p',
  'python3 --version', 'python --version',
  'npm --version', 'npm ls', 'npm list',
  'tsc --version', 'tsc --noEmit',
]);

export function extractPrefix(cmd: string): string {
  const trimmed = cmd.trim();
  const segments = trimmed.split(/\s*\|\||\s*&&|\s*;|\s*\|/).map(s => s.trim()).filter(Boolean);
  const first = segments[0] ?? '';
  const tokens = first.split(/\s+/);
  for (const len of [3, 2, 1]) {
    if (tokens.length >= len) {
      const prefix = tokens.slice(0, len).join(' ');
      if (AUTO_ALLOW_PREFIXES.has(prefix)) return prefix;
    }
  }
  if (tokens.length >= 2 && PREFIX_FAMILIES.has(tokens[0])) {
    return tokens.slice(0, 2).join(' ');
  }
  return tokens[0] ?? '';
}

export function classifyCommand(cmd: string): PermissionResult {
  for (const p of HARDLINE_PATTERNS) {
    if (p.pattern.test(cmd)) {
      return { action: 'deny', prefix: extractPrefix(cmd), reason: p.reason };
    }
  }

  const prefix = extractPrefix(cmd);

  if (AUTO_ALLOW_PREFIXES.has(prefix)) {
    return { action: 'allow', prefix };
  }

  return { action: 'ask', prefix };
}

export type AskResponse = 'y' | 'n' | 'a' | 'r';

export function askUserKeypress(question: string, mode: AgentMode = 'default', timeoutMs = 60000): Promise<AskResponse> {
  return new Promise((resolve) => {
    if (mode === 'yolo') { resolve('a'); return; }
    if (mode === 'plan') { resolve('n'); return; }

    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve('n');
      return;
    }

    process.stdout.write(`\n${question}\n\n`);
    process.stdout.write('  [y] Allow once   [n] Deny once\n');
    process.stdout.write('  [a] Always allow  [r] Reject all\n');
    process.stdout.write('\n> ');

    const prevRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const timer = setTimeout(() => {
      cleanup();
      process.stdout.write('(timeout, denied)\n');
      resolve('n');
    }, timeoutMs);

    const onData = (buf: Buffer) => {
      const key = parseKeypress(buf);
      const ch = key.name === '' ? key.sequence?.toLowerCase() : key.name?.toLowerCase();
      if (ch === 'y' || ch === 'n' || ch === 'a' || ch === 'r') {
        cleanup();
        process.stdout.write(`${ch}\n`);
        resolve(ch as AskResponse);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      stdin.removeListener('data', onData);
      stdin.setRawMode(prevRaw ?? false);
      stdin.pause();
    };

    stdin.on('data', onData);
  });
}
