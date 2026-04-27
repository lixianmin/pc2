# /sessions Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/sessions` and `/resume` commands to chat REPL, enabling users to list recent sessions and resume a previous conversation.

**Architecture:** New `thread.ts` module handles thread metadata (CRUD) and history loading. `loop.ts` gains user message persistence and a `resumeHistory()` method. `chat.ts` adds REPL command parsing for `/sessions` and `/resume`.

**Tech Stack:** TypeScript, vitest, existing jsonl/history/summary modules.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/storage/thread.ts` | NEW — ThreadMeta type, writeMeta, readMeta, updateMeta, listThreads, loadThreadHistory |
| `src/agent/loop.ts` | MODIFY — persist user messages to JSONL, add resumeHistory() |
| `src/cli/chat.ts` | MODIFY — REPL command parsing, /sessions list, /resume switch |
| `tests/unit/storage/thread.test.ts` | NEW — unit tests for thread module |
| `tests/integration/session.test.ts` | NEW — end-to-end session resume test |

---

## Chunk 1: Thread Storage Module

### Task 1: ThreadMeta type + writeMeta + readMeta

**Files:**
- Create: `src/storage/thread.ts`
- Create: `tests/unit/storage/thread.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/storage/thread.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeMeta, readMeta } from '../../../src/storage/thread.js';

describe('thread meta', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'pc2-thread-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('writeMeta creates meta.json and readMeta reads it back', async () => {
    const meta = {
      id: '2026-04-27-14-30-28',
      createdAt: '2026-04-27T14:30:28+08:00',
      lastActivityAt: '2026-04-27T14:30:28+08:00',
      messageCount: 1,
      preview: 'Hello world',
    };
    await writeMeta(tempDir, meta);
    const loaded = await readMeta(tempDir);
    expect(loaded).toEqual(meta);
  });

  it('readMeta returns null when no meta.json exists', async () => {
    const loaded = await readMeta(tempDir);
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/storage/thread.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement thread.ts (writeMeta + readMeta only)**

```typescript
// src/storage/thread.ts
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import { getFrozenFiles, getCurrentFile } from './history.js';
import { serializeMessages } from '../agent/prompt.js';
import type { Message } from '../types.js';

export interface ThreadMeta {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  preview: string;
}

const META_FILE = 'meta.json';

export async function writeMeta(threadDir: string, meta: ThreadMeta): Promise<void> {
  const path = join(threadDir, META_FILE);
  await writeFile(path, JSON.stringify(meta, null, 2), 'utf-8');
}

export async function readMeta(threadDir: string): Promise<ThreadMeta | null> {
  try {
    const raw = await readFile(join(threadDir, META_FILE), 'utf-8');
    return JSON.parse(raw) as ThreadMeta;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/storage/thread.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/thread.ts tests/unit/storage/thread.test.ts
git commit -m "feat(thread): add writeMeta and readMeta"
```

### Task 2: updateMeta + listThreads

**Files:**
- Modify: `src/storage/thread.ts`
- Modify: `tests/unit/storage/thread.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/storage/thread.test.ts`:

```typescript
import { updateMeta, listThreads } from '../../../src/storage/thread.js';
import { mkdirSync } from 'fs';

it('updateMeta patches existing meta', async () => {
  await writeMeta(tempDir, {
    id: 'test', createdAt: 't0', lastActivityAt: 't0', messageCount: 1, preview: 'hi',
  });
  await updateMeta(tempDir, { messageCount: 5, lastActivityAt: 't1' });
  const loaded = await readMeta(tempDir);
  expect(loaded!.messageCount).toBe(5);
  expect(loaded!.lastActivityAt).toBe('t1');
  expect(loaded!.preview).toBe('hi');
});

it('listThreads returns threads sorted by lastActivityAt desc', async () => {
  const threadsDir = join(tempDir, 'threads');
  for (const name of ['a', 'b', 'c']) {
    const dir = join(threadsDir, name);
    mkdirSync(dir, { recursive: true });
  }
  await writeMeta(join(threadsDir, 'a'), {
    id: 'a', createdAt: 't0', lastActivityAt: '2026-01-01', messageCount: 1, preview: 'a',
  });
  await writeMeta(join(threadsDir, 'b'), {
    id: 'b', createdAt: 't0', lastActivityAt: '2026-01-03', messageCount: 2, preview: 'b',
  });
  await writeMeta(join(threadsDir, 'c'), {
    id: 'c', createdAt: 't0', lastActivityAt: '2026-01-02', messageCount: 3, preview: 'c',
  });
  const threads = await listThreads(threadsDir);
  expect(threads.map(t => t.id)).toEqual(['b', 'c', 'a']);
});

it('listThreads skips threads without meta.json', async () => {
  const threadsDir = join(tempDir, 'threads');
  mkdirSync(join(threadsDir, 'empty'), { recursive: true });
  mkdirSync(join(threadsDir, 'has-meta'), { recursive: true });
  await writeMeta(join(threadsDir, 'has-meta'), {
    id: 'has-meta', createdAt: 't0', lastActivityAt: 't0', messageCount: 1, preview: 'x',
  });
  const threads = await listThreads(threadsDir);
  expect(threads).toHaveLength(1);
  expect(threads[0].id).toBe('has-meta');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/storage/thread.test.ts`
Expected: FAIL — updateMeta/listThreads not exported

- [ ] **Step 3: Implement updateMeta + listThreads**

Add to `src/storage/thread.ts`:

```typescript
import { readdir } from 'fs/promises';

export async function updateMeta(threadDir: string, patch: Partial<ThreadMeta>): Promise<void> {
  const existing = await readMeta(threadDir);
  if (!existing) return;
  const merged = { ...existing, ...patch };
  await writeMeta(threadDir, merged);
}

export async function listThreads(dataDir: string, limit = 10): Promise<ThreadMeta[]> {
  const threadsDir = join(dataDir, 'threads');
  let entries: string[];
  try {
    entries = await readdir(threadsDir);
  } catch {
    return [];
  }
  const metas: ThreadMeta[] = [];
  for (const entry of entries) {
    const meta = await readMeta(join(threadsDir, entry));
    if (meta) metas.push(meta);
  }
  metas.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return metas.slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/storage/thread.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/thread.ts tests/unit/storage/thread.test.ts
git commit -m "feat(thread): add updateMeta and listThreads"
```

### Task 3: loadThreadHistory

**Files:**
- Modify: `src/storage/thread.ts`
- Modify: `tests/unit/storage/thread.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/storage/thread.test.ts`:

```typescript
import { appendJsonl } from '../../../src/storage/jsonl.js';
import { loadThreadHistory } from '../../../src/storage/thread.js';

it('loadThreadHistory loads frozen + current and serializes', async () => {
  const msgs: Message[] = [
    { id: 'm1', role: 'user', content: 'hello', timestamp: 't1' },
    { id: 'm2', role: 'assistant', content: 'hi there', timestamp: 't2' },
  ];
  await appendJsonl(join(tempDir, 'messages-current.jsonl'), msgs[0]);
  await appendJsonl(join(tempDir, 'messages-current.jsonl'), msgs[1]);

  const history = await loadThreadHistory(tempDir);
  expect(history).toContain('[User]\nhello');
  expect(history).toContain('[Assistant]\nhi there');
});
```

Add import at top: `import type { Message } from '../../../src/types.js';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/storage/thread.test.ts`
Expected: FAIL — loadThreadHistory not exported

- [ ] **Step 3: Implement loadThreadHistory**

Add to `src/storage/thread.ts`:

```typescript
export async function loadThreadHistory(threadDir: string): Promise<string> {
  const frozenFiles = await getFrozenFiles(threadDir);
  const allMessages: Message[] = [];
  for (const f of frozenFiles) {
    const msgs = await readJsonl<Message>(f);
    allMessages.push(...msgs);
  }
  const currentFile = getCurrentFile(threadDir);
  const currentMsgs = await readJsonl<Message>(currentFile);
  allMessages.push(...currentMsgs);
  return serializeMessages(allMessages);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/storage/thread.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/thread.ts tests/unit/storage/thread.test.ts
git commit -m "feat(thread): add loadThreadHistory"
```

---

## Chunk 2: Loop Changes

### Task 4: Persist user messages to JSONL + resumeHistory

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/unit/agent/loop.test.ts`

- [ ] **Step 1: Write failing test for resumeHistory**

Add to `tests/unit/agent/loop.test.ts`:

```typescript
it('resumeHistory sets conversation history', async () => {
  const { b } = await import('../../../baml_client/index.js');
  (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
    text: 'Done', tool_calls: [],
  });

  const registry = new ToolRegistry();
  const loop = new AgentLoop(registry);

  loop.resumeHistory('[User]\nprevious question\n\n[Assistant]\nprevious answer\n\n');

  const promptCapture: string[] = [];
  (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async (prompt: string) => {
    promptCapture.push(prompt);
    return { text: 'Done', tool_calls: [] };
  });

  for await (const _ of loop.execute('new question')) { /* consume */ }
  expect(promptCapture[0]).toContain('previous question');
  expect(promptCapture[0]).toContain('previous answer');
  expect(promptCapture[0]).toContain('[User]\nnew question');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: FAIL — resumeHistory is not a function

- [ ] **Step 3: Add resumeHistory method to AgentLoop**

In `src/agent/loop.ts`, add after constructor:

```typescript
  resumeHistory(history: string): void {
    this.conversationHistory = history;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Add user message persistence**

In `src/agent/loop.ts`, in `execute()`, after the `let messages = ...` line (around line 54), add:

```typescript
    if (options.threadDir) {
      await appendJsonl(
        join(options.threadDir, 'messages-current.jsonl'),
        { id: `msg_${options.agentId ?? 'main'}_u_${Date.now()}`, role: 'user', content: userMessage,
          timestamp: new Date().toISOString() } satisfies Message,
      );
    }
```

- [ ] **Step 6: Add failing test for user message persistence**

Add to `tests/unit/agent/loop.test.ts`:

```typescript
it('persists user message to JSONL when threadDir is set', async () => {
  const { b } = await import('../../../baml_client/index.js');
  (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
    text: 'Done', tool_calls: [],
  });

  const registry = new ToolRegistry();
  const loop = new AgentLoop(registry);
  const threadDir = join(tmpdir(), `pc2-user-msg-${Date.now()}`);
  mkdirSync(threadDir, { recursive: true });

  try {
    for await (const _ of loop.execute('test user message', { threadDir })) { /* consume */ }
    const content = readFileSync(join(threadDir, 'messages-current.jsonl'), 'utf-8');
    expect(content).toContain('"role":"user"');
    expect(content).toContain('test user message');
  } finally {
    rmSync(threadDir, { recursive: true, force: true });
  }
});
```

Add imports at top of test file: `import { readFileSync } from 'fs'; import { tmpdir } from 'os'; import { mkdirSync, rmSync } from 'fs';`

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/agent/loop.ts tests/unit/agent/loop.test.ts
git commit -m "feat(loop): add resumeHistory and persist user messages to JSONL"
```

---

## Chunk 3: Chat REPL Commands

### Task 5: /sessions and /resume in chat.ts

**Files:**
- Modify: `src/cli/chat.ts`
- Create: `tests/integration/session.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// tests/integration/session.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeMeta } from '../../src/storage/thread.js';
import { listThreads, loadThreadHistory } from '../../src/storage/thread.js';

describe('integration: session management', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pc2-session-'));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('listThreads returns empty for empty directory', async () => {
    const threads = await listThreads(tempDir);
    expect(threads).toEqual([]);
  });

  it('loadThreadHistory returns empty string for empty thread', async () => {
    const history = await loadThreadHistory(tempDir);
    expect(history).toBe('');
  });

  it('full round-trip: write meta → list → load history', async () => {
    await writeMeta(tempDir, {
      id: 'test-session',
      createdAt: '2026-04-27T14:30:28+08:00',
      lastActivityAt: '2026-04-27T14:35:00+08:00',
      messageCount: 3,
      preview: 'test question',
    });

    const { appendJsonl } = await import('../../src/storage/jsonl.js');
    await appendJsonl(join(tempDir, 'messages-current.jsonl'), {
      id: 'm1', role: 'user', content: 'test question', timestamp: 't1',
    });
    await appendJsonl(join(tempDir, 'messages-current.jsonl'), {
      id: 'm2', role: 'assistant', content: 'test answer', timestamp: 't2',
    });

    const threads = await listThreads(tempDir);
    expect(threads).toHaveLength(1);
    expect(threads[0].preview).toBe('test question');

    const history = await loadThreadHistory(tempDir);
    expect(history).toContain('[User]\ntest question');
    expect(history).toContain('[Assistant]\ntest answer');
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (thread module already implemented)

Run: `npx vitest run tests/integration/session.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Implement /sessions and /resume in chat.ts**

Modify `src/cli/chat.ts`:

1. Add imports:
```typescript
import { writeMeta, updateMeta, listThreads, loadThreadHistory } from '../storage/thread.js';
import { appendJsonl } from '../storage/jsonl.js';
import type { Message } from '../types.js';
```

2. Replace the `prompt` function with command handling:

```typescript
  let activeThreadDir = threadDir;

  const handleSessions = async () => {
    const threads = await listThreads(config.dataDir);
    if (threads.length === 0) {
      console.log('No previous sessions found.');
      return;
    }
    console.log('\nRecent sessions:');
    threads.forEach((t, i) => {
      const shortDate = t.lastActivityAt.slice(5, 16).replace('T', ' ');
      const preview = t.preview.length > 50 ? t.preview.slice(0, 50) + '...' : t.preview;
      console.log(`  #${i + 1}  ${shortDate}  (${t.messageCount} msg)  ${preview}`);
    });
    console.log('');
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
    const threadDir = join(config.dataDir, 'threads', thread.id);
    const history = await loadThreadHistory(threadDir);
    loop.resumeHistory(history);
    activeThreadDir = threadDir;
    console.log(`Resumed session: ${thread.preview}\n`);
  };

  const prompt = () => rl.question('\n> ', async (input) => {
    if (!input.trim()) { prompt(); return; }
    if (input === 'exit' || input === 'quit') { rl.close(); return; }
    if (input === '/sessions') { await handleSessions(); prompt(); return; }
    if (input.startsWith('/resume')) { await handleResume(input); prompt(); return; }

    let textYielded = false;
    for await (const event of loop.execute(input, { threadDir: activeThreadDir, dataDir: config.dataDir })) {
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

    const meta = await import('../storage/thread.js').then(m => m.readMeta(activeThreadDir));
    if (meta) {
      await updateMeta(activeThreadDir, {
        lastActivityAt: new Date().toISOString(),
      });
    }

    prompt();
  });
```

- [ ] **Step 4: Add meta creation in startChat**

In `src/cli/chat.ts`, after `const threadDir = makeThreadDir();`, add:

```typescript
  const preview = options.initialTask ?? '';
  await writeMeta(threadDir, {
    id: threadDir.split('/').pop()!,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    messageCount: 0,
    preview: preview.length > 80 ? preview.slice(0, 80) : preview,
  });
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/cli/chat.ts src/agent/loop.ts tests/integration/session.test.ts
git commit -m "feat(chat): add /sessions and /resume commands for session management"
```

---

## Verification

- [ ] Run full test suite: `npx vitest run`
- [ ] Run type check: `npx tsc --noEmit`
- [ ] Manual test: `npm start chat` → type `/sessions` → should show empty or existing sessions
- [ ] Manual test: chat a bit → exit → restart → `/sessions` → `/resume 1` → continue conversation
