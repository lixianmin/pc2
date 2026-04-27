# Multiline Input Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace readline-based single-line input with a raw keypress handler that supports Shift+Enter for multiline input.

**Architecture:** New `src/cli/input.ts` module exports `readMultiline()` which enters raw mode, reads keypress events, maintains a string buffer, and renders to stdout via ANSI escapes. `src/cli/chat.ts` is refactored from callback-style `rl.question()` to async/await using `readMultiline()`.

**Tech Stack:** Node.js `readline.emitKeypressEvents`, `process.stdin` raw mode, ANSI escape sequences. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-27-multiline-input-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/cli/input.ts` | Raw keypress multiline input handler |
| Create | `tests/unit/cli/input.test.ts` | Unit tests for input handler |
| Modify | `src/cli/chat.ts` | Replace `rl.question()` with `readMultiline()` |

---

## Chunk 1: readMultiline — Core Implementation

### Task 1: Create `src/cli/input.ts` with keypress handling, buffer management, and rendering

**Files:**
- Create: `src/cli/input.ts`

This module exports `readMultiline(prompt: string): Promise<string | null>`. It uses raw mode stdin + `readline.emitKeypressEvents` to handle keypresses.

Key design:
- `buffer: string[]` — array of characters (split at boundaries for easy insertion/deletion)
- `cursorPos: number` — index into the flat string representation
- `previousVisualLines: number` — for clearing previous render
- On each keypress: update buffer/cursor, then call `render()`
- `render()` moves up by previousVisualLines, clears down, writes prompt+buffer, positions cursor
- Visual line count accounts for terminal width wrapping

```ts
import * as readline from 'readline';

export async function readMultiline(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      resolve(null);
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);

    let buffer = '';
    let cursorPos = 0;
    let previousVisualLines = 0;

    const termWidth = () => stdout.columns || 80;

    const getLineInfo = (pos: number) => {
      const beforeCursor = buffer.slice(0, pos);
      const lines = beforeCursor.split('\n');
      const row = lines.length - 1;
      const col = row === 0 ? prompt.length + lines[0].length : lines[row].length;
      return { row, col };
    };

    const visualLineCount = () => {
      const tw = termWidth();
      const segments = buffer.split('\n');
      let total = 0;
      for (let i = 0; i < segments.length; i++) {
        const len = i === 0 ? prompt.length + segments[i].length : segments[i].length;
        total += Math.max(1, Math.ceil(len / tw) || 1);
      }
      return total;
    };

    const render = () => {
      if (previousVisualLines > 0) {
        stdout.write(`\x1b[${previousVisualLines}A`);
      }
      stdout.write('\x1b[J');
      stdout.write(prompt + buffer);
      const { row, col } = getLineInfo(cursorPos);
      const vl = visualLineCount();
      const bottomRow = vl - 1;
      const moveUp = bottomRow - row;
      if (moveUp > 0) {
        stdout.write(`\x1b[${moveUp}A`);
      } else if (moveUp < 0) {
        stdout.write(`\x1b[${-moveUp}B`);
      }
      stdout.write(`\x1b[${col + 1}G`);
      previousVisualLines = vl;
    };

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      stdin.removeListener('keypress', onKey);
      stdin.removeListener('end', onEnd);
      stdout.removeListener('resize', onResize);
      if (!wasRaw) {
        stdin.setRawMode(false);
      }
      stdout.write('\n');
    };

    const onEnd = () => {
      cleanup();
      resolve(null);
    };

    const onKey = (_: unknown, key: readline.Key) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve(null);
        return;
      }

      if (key.ctrl && key.name === 'd') {
        if (buffer.length === 0) {
          cleanup();
          resolve(null);
          return;
        }
        if (cursorPos < buffer.length) {
          buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
        }
        render();
        return;
      }

      if (key.ctrl && key.name === 'l') {
        stdout.write('\x1b[2J\x1b[H');
        previousVisualLines = 0;
        render();
        return;
      }

      if (key.name === 'return') {
        if (key.shift) {
          buffer = buffer.slice(0, cursorPos) + '\n' + buffer.slice(cursorPos);
          cursorPos += 1;
          render();
          return;
        }
        cleanup();
        resolve(buffer);
        return;
      }

      if (key.name === 'backspace') {
        if (cursorPos > 0) {
          buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
          cursorPos -= 1;
        }
        render();
        return;
      }

      if (key.name === 'delete') {
        if (cursorPos < buffer.length) {
          buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
        }
        render();
        return;
      }

      if (key.name === 'left') {
        if (cursorPos > 0) cursorPos -= 1;
        render();
        return;
      }

      if (key.name === 'right') {
        if (cursorPos < buffer.length) cursorPos += 1;
        render();
        return;
      }

      if (key.name === 'up') {
        const lines = buffer.split('\n');
        const beforeCursor = buffer.slice(0, cursorPos);
        const upToCursor = beforeCursor.split('\n');
        const currentLine = upToCursor.length - 1;
        if (currentLine > 0) {
          const targetLine = currentLine - 1;
          const posInLine = upToCursor[upToCursor.length - 1].length;
          const newPos = lines.slice(0, targetLine).join('\n').length
            + (targetLine > 0 ? 1 : 0)
            + Math.min(posInLine, lines[targetLine].length);
          cursorPos = newPos;
        }
        render();
        return;
      }

      if (key.name === 'down') {
        const lines = buffer.split('\n');
        const beforeCursor = buffer.slice(0, cursorPos);
        const upToCursor = beforeCursor.split('\n');
        const currentLine = upToCursor.length - 1;
        if (currentLine < lines.length - 1) {
          const targetLine = currentLine + 1;
          const posInLine = upToCursor[upToCursor.length - 1].length;
          const newPos = lines.slice(0, targetLine).join('\n').length
            + (targetLine > 0 ? 1 : 0)
            + Math.min(posInLine, lines[targetLine].length);
          cursorPos = newPos;
        }
        render();
        return;
      }

      if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        const beforeCursor = buffer.slice(0, cursorPos);
        const lastNewline = beforeCursor.lastIndexOf('\n');
        cursorPos = lastNewline + 1;
        render();
        return;
      }

      if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        const nextNewline = buffer.indexOf('\n', cursorPos);
        cursorPos = nextNewline === -1 ? buffer.length : nextNewline;
        render();
        return;
      }

      if (key.ctrl && key.name === 'k') {
        const nextNewline = buffer.indexOf('\n', cursorPos);
        const endPos = nextNewline === -1 ? buffer.length : nextNewline;
        buffer = buffer.slice(0, cursorPos) + buffer.slice(endPos);
        render();
        return;
      }

      if (key.ctrl && key.name === 'u') {
        const beforeCursor = buffer.slice(0, cursorPos);
        const lastNewline = beforeCursor.lastIndexOf('\n');
        const startPos = lastNewline + 1;
        buffer = buffer.slice(0, startPos) + buffer.slice(cursorPos);
        cursorPos = startPos;
        render();
        return;
      }

      if (key.name === 'tab') {
        buffer = buffer.slice(0, cursorPos) + '  ' + buffer.slice(cursorPos);
        cursorPos += 2;
        render();
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta && key.name !== 'escape') {
        buffer = buffer.slice(0, cursorPos) + key.sequence + buffer.slice(cursorPos);
        cursorPos += key.sequence.length;
        render();
        return;
      }
    };

    stdin.on('keypress', onKey);
    stdin.on('end', onEnd);

    const onResize = () => {
      previousVisualLines = 0;
      stdout.write('\x1b[J');
      render();
    };
    stdout.on('resize', onResize);

    stdout.write(prompt);
    previousVisualLines = 1;
  });
}
```

- [ ] **Step 1: Create `src/cli/input.ts`** with the code above

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/input.ts
git commit -m "feat: add readMultiline raw keypress input handler"
```

---

### Task 2: Unit tests for `readMultiline`

**Files:**
- Create: `tests/unit/cli/input.test.ts`

Testing raw keypress input requires mocking `process.stdin` and `process.stdout`. We emit synthetic keypress events and assert on the resolved value.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as readline from 'readline';

vi.mock('readline', async () => {
  const actual = await vi.importActual<typeof import('readline')>('readline');
  return {
    ...actual,
    emitKeypressEvents: vi.fn(),
  };
});

function mockStdin() {
  const ee = new EventEmitter() as any;
  ee.isTTY = true;
  ee.isRaw = false;
  ee.setRawMode = vi.fn((v: boolean) => { ee.isRaw = v; });
  ee.resume = vi.fn();
  ee.pause = vi.fn();
  ee.removeListener = ee.off.bind(ee);
  return ee;
}

function mockStdout() {
  const ee = new EventEmitter() as any;
  ee.columns = 80;
  const written: string[] = [];
  ee.write = vi.fn((data: string) => { written.push(data); });
  ee.removeListener = ee.off.bind(ee);
  return { stdout: ee, written };
}

function emitKey(stdin: any, key: readline.Key) {
  stdin.emit('keypress', null, key);
}

function makeKey(name: string, opts: Partial<readline.Key> = {}): readline.Key {
  return { name, sequence: '', ctrl: false, meta: false, shift: false, ...opts };
}

describe('readMultiline', () => {
  let origStdin: any;
  let origStdout: any;

  beforeEach(() => {
    origStdin = process.stdin;
    origStdout = process.stdout;
  });

  afterEach(() => {
    process.stdin = origStdin;
    process.stdout = origStdout;
    vi.restoreAllMocks();
  });

  it('resolves with typed text on Enter', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout, written } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');

    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('ab');
  });

  it('resolves with null on Ctrl+C', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('c', { ctrl: true }));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('inserts newline on Shift+Enter', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('return', { shift: true }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a\nb');
  });

  it('resolves with null on Ctrl+D when buffer is empty', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('d', { ctrl: true }));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('resolves with null when stdin is not a TTY', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    stdin.isTTY = false;
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const result = await readMultiline('> ');
    expect(result).toBeNull();
  });

  it('handles backspace across line boundary', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('return', { shift: true }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('backspace'));
    emitKey(stdin, makeKey('backspace'));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('inserts 2 spaces on Tab', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('tab'));
    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('  a');
  });

  it('Ctrl+A moves cursor to start of line', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('c', { sequence: 'c' }));
    emitKey(stdin, makeKey('a', { ctrl: true }));
    emitKey(stdin, makeKey('x', { sequence: 'x' }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('xabc');
  });

  it('Ctrl+E moves cursor to end of line', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('left'));
    emitKey(stdin, makeKey('e', { ctrl: true }));
    emitKey(stdin, makeKey('c', { sequence: 'c' }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('abc');
  });

  it('Ctrl+K kills to end of line', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('left'));
    emitKey(stdin, makeKey('k', { ctrl: true }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('Ctrl+U kills to start of line', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('left'));
    emitKey(stdin, makeKey('u', { ctrl: true }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('b');
  });

  it('Delete key removes character at cursor', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('left'));
    emitKey(stdin, makeKey('delete'));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('up/down arrows move across lines', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('return', { shift: true }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('up'));
    emitKey(stdin, makeKey('x', { sequence: 'x' }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('ax\nb');
  });

  it('Ctrl+D deletes at cursor when buffer non-empty', async () => {
    const { readMultiline } = await import('../../../src/cli/input.js');
    const stdin = mockStdin();
    const { stdout } = mockStdout();
    process.stdin = stdin as any;
    process.stdout = stdout as any;

    const promise = readMultiline('> ');
    await new Promise((r) => setTimeout(r, 10));

    emitKey(stdin, makeKey('a', { sequence: 'a' }));
    emitKey(stdin, makeKey('b', { sequence: 'b' }));
    emitKey(stdin, makeKey('left'));
    emitKey(stdin, makeKey('d', { ctrl: true }));
    emitKey(stdin, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });
});
```

- [ ] **Step 1: Create `tests/unit/cli/input.test.ts`** with the code above

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/cli/input.test.ts`
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/unit/cli/input.test.ts
git commit -m "test: add unit tests for readMultiline"
```

---

## Chunk 2: Integrate into chat.ts

### Task 3: Refactor `src/cli/chat.ts` to use `readMultiline`

**Files:**
- Modify: `src/cli/chat.ts`

Changes:
1. Remove `readline.createInterface` and `rl` variable
2. Remove `commandCompleter` import — `completer.ts` and its test are kept for future tab completion integration
3. Import `readMultiline` from `./input.js`
4. Convert `prompt()` from callback-style to `while(true)` async loop (avoids stack overflow in long sessions)
5. Update `handleSessions()` — no `rl.pause()/resume()` needed
6. Handle `null` return from `readMultiline` (Ctrl+C → exit)
7. `rl.on('close')` cleanup → replace with direct `logo.close()` in exit path

```ts
import { mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { logo, LogLevel } from '../lib/logo.js';
import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { createFileReadTool } from '../tools/file-read.js';
import { createFileWriteTool } from '../tools/file-write.js';
import { createFileEditTool } from '../tools/file-edit.js';
import { createBashTool } from '../tools/bash.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createMemorySearchTool } from '../tools/memory-search.js';
import { createAskUserTool } from '../tools/ask-user.js';
import { createSpawnAgentTool } from '../tools/spawn-agent.js';
import { config } from '../config.js';
import { writeMeta, updateMeta, listThreads, loadThreadHistory, readMeta } from '../storage/thread.js';
import { LmdMcpClient } from '../memory/lmd-client.js';
import { scanSkillDirectory } from '../skill-sop/loader.js';
import { readMultiline } from './input.js';
import select from '@inquirer/select';

export function makeThreadDir(): string {
  const threadsDir = join(config.dataDir, 'threads');
  mkdirSync(threadsDir, { recursive: true });
  let maxNum = 0;
  try {
    const entries = readdirSync(threadsDir);
    for (const entry of entries) {
      const n = parseInt(entry, 10);
      if (!isNaN(n) && String(n) === entry && n > maxNum) maxNum = n;
    }
  } catch {}
  const nextNum = maxNum + 1;
  const name = String(nextNum);
  const dir = join(threadsDir, name);
  mkdirSync(join(dir, 'summaries'), { recursive: true });
  return dir;
}

export async function startChat(options: { initialTask?: string }): Promise<void> {
  logo.init({ console: false, level: LogLevel.Info });
  const registry = new ToolRegistry();
  registry.register(createFileReadTool());
  registry.register(createFileWriteTool());
  registry.register(createFileEditTool());
  registry.register(createBashTool());
  registry.register(createWebSearchTool());
  registry.register(createWebFetchTool());
  registry.register(createMemorySearchTool());
  registry.register(createAskUserTool());
  registry.register(createSpawnAgentTool());

  const lmdClient = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
  const sops = await scanSkillDirectory('sop');
  const skills = await scanSkillDirectory('skills');
  logo.info('Chat initialized', { sops: sops.length, skills: skills.length });

  let activeThreadDir: string | null = null;

  const ensureThread = (preview: string): string => {
    if (activeThreadDir) return activeThreadDir;
    const dir = makeThreadDir();
    writeMeta(dir, {
      id: dir.split('/').pop()!,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      messageCount: 0,
      preview: preview.length > 80 ? preview.slice(0, 80) : preview,
    });
    activeThreadDir = dir;
    logo.info('New thread created', { dir });
    return dir;
  };

  const loop = new AgentLoop(registry);

  const handleSessions = async () => {
    const threads = await listThreads(config.dataDir);
    if (threads.length === 0) {
      console.log('No previous sessions found.');
      return;
    }
    const choices = threads.map((t, i) => {
      const shortDate = t.lastActivityAt.slice(5, 16).replace('T', ' ');
      const preview = t.preview
        ? (t.preview.length > 50 ? t.preview.slice(0, 50) + '...' : t.preview)
        : '(empty)';
      return {
        name: `#${i + 1}  ${shortDate}  ${preview}`,
        value: String(i),
      };
    });
    choices.push({ name: '(cancel)', value: 'cancel' });
    const answer = await select({
      message: 'Select a session to resume:',
      choices,
    });
    if (answer !== 'cancel') {
      const idx = parseInt(answer, 10);
      const thread = threads[idx];
      const resumedDir = join(config.dataDir, 'threads', thread.id);
      const history = await loadThreadHistory(resumedDir);
      loop.resumeHistory(history);
      activeThreadDir = resumedDir;
      console.log(`Resumed session: ${thread.preview}\n`);
    }
  };

  const handleResume = async (input: string) => {
    const match = input.match(/^\/resume\s+(\d+)$/);
    if (!match) {
      console.log('Usage: /resume <number> (use /sessions to list)');
      return;
    }
    const idx = parseInt(match[1], 10) - 1;
    const threads = await listThreads(config.dataDir);
    if (idx < 0 || idx >= threads.length) {
      console.log(`Invalid session #${match[1]}. Use /sessions to list.`);
      return;
    }
    const thread = threads[idx];
    const resumedDir = join(config.dataDir, 'threads', thread.id);
    const history = await loadThreadHistory(resumedDir);
    loop.resumeHistory(history);
    activeThreadDir = resumedDir;
    console.log(`Resumed session: ${thread.preview}\n`);
  };

  const prompt = async () => {
    while (true) {
      const input = await readMultiline('\n> ');
      if (input === null) {
        logo.close();
        process.exit(0);
      }
      if (!input.trim()) continue;
      if (input === 'exit' || input === 'quit') { logo.close(); process.exit(0); }
      if (input === '/sessions') { await handleSessions(); continue; }
      if (input.startsWith('/resume')) { await handleResume(input); continue; }

      const threadDir = ensureThread(input);

      let textYielded = false;
      for await (const event of loop.execute(input, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills })) {
        if (event.type === 'text') {
          textYielded = true;
          process.stdout.write(event.content);
        } else if (event.type === 'tool_result') {
          process.stdout.write(`\n[tool: ${event.name}] ${String(event.result).slice(0, 200)}\n`);
        } else if (event.type === 'warning') {
          process.stdout.write(`\n[warning] ${event.content}\n`);
        } else if (event.type === 'done') {
          if (!textYielded) {
            logo.warn('Chat loop completed without text output', { reason: event.reason });
          }
          process.stdout.write('\n');
        }
      }

      const meta = await readMeta(threadDir);
      await updateMeta(threadDir, {
        lastActivityAt: new Date().toISOString(),
        messageCount: (meta?.messageCount ?? 0) + 1,
      });
    }
  };

  if (options.initialTask) {
    const threadDir = ensureThread(options.initialTask);
    for await (const event of loop.execute(options.initialTask, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills })) {
      if (event.type === 'text') process.stdout.write(event.content);
    }
    process.stdout.write('\n');
  }

  await prompt();
}
```

- [ ] **Step 1: Apply changes to `src/cli/chat.ts`** — remove readline, add readMultiline import, convert to async/await

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/cli/chat.ts
git commit -m "feat: integrate readMultiline into chat loop, replace readline"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Start the CLI**

Run: `npx tsx src/cli/index.ts chat`
Expected: `> ` prompt appears

- [ ] **Step 2: Test single line input**

Type `hello` + Enter → verify assistant responds

- [ ] **Step 3: Test multiline input**

Type `line1` + Shift+Enter + `line2` + Enter → verify multiline sent

- [ ] **Step 4: Test Ctrl+C**

Type Ctrl+C → verify clean exit

- [ ] **Step 5: Test /sessions**

Type `/sessions` + Enter → verify session picker appears

- [ ] **Step 6: Final commit (if any fixes needed)**
