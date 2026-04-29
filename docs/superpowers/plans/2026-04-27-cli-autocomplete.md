# CLI Autocomplete & Session Picker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Tab completion for `/` commands and interactive session picker to chat REPL.

**Architecture:** Keep `readline` with `completer` for Tab completion. Add `@inquirer/select` for interactive session picker. Minimal changes to `chat.ts`.

**Tech Stack:** Node.js readline, `@inquirer/select`

---

## File Structure

- Modify: `src/cli/chat.ts` — add completer, replace `/sessions` handler with select UI
- Create: `src/cli/completer.ts` — command completion logic (pure function, testable)
- Create: `tests/unit/cli/completer.test.ts` — unit tests for completer
- Modify: `package.json` — add `@inquirer/select`

---

## Chunk 1: Tab Completion

### Task 1: Completer function + tests

**Files:**
- Create: `src/cli/completer.ts`
- Create: `tests/unit/cli/completer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/cli/completer.test.ts
import { describe, it, expect } from 'vitest';
import { commandCompleter, COMMANDS } from '../../../src/cli/completer.js';

describe('commandCompleter', () => {
  it('returns matching commands for "/" prefix', () => {
    const [hits, line] = commandCompleter('/');
    expect(hits).toEqual(COMMANDS);
    expect(line).toBe('/');
  });

  it('filters commands by partial input', () => {
    const [hits] = commandCompleter('/se');
    expect(hits).toEqual(['/sessions']);
  });

  it('returns empty hits when no match', () => {
    const [hits] = commandCompleter('/xyz');
    expect(hits).toEqual([]);
  });

  it('returns empty hits for non-command input', () => {
    const [hits] = commandCompleter('hello');
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cli/completer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement completer**

```typescript
// src/cli/completer.ts
export const COMMANDS = ['/sessions', '/resume', '/help'];

export function commandCompleter(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const hits = COMMANDS.filter((c) => c.startsWith(line));
  return [hits, line];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cli/completer.test.ts`
Expected: PASS

- [ ] **Step 5: Wire completer into readline**

In `src/cli/chat.ts`, change:

```typescript
// Before:
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// After:
import { commandCompleter } from './completer.js';
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: commandCompleter,
});
```

- [ ] **Step 6: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/cli/completer.ts tests/unit/cli/completer.test.ts src/cli/chat.ts
git commit -m "feat: add Tab completion for / commands in chat REPL"
```

---

## Chunk 2: Interactive Session Picker

### Task 2: Install @inquirer/select + replace /sessions handler

**Files:**
- Modify: `package.json` (install dep)
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: Install dependency**

Run: `npm install @inquirer/select`

- [ ] **Step 2: Replace handleSessions with select UI**

In `src/cli/chat.ts`, replace the `handleSessions` function:

```typescript
// Before:
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

// After:
import select from '@inquirer/select';

const handleSessions = async () => {
  const threads = await listThreads(config.dataDir);
  if (threads.length === 0) {
    console.log('No previous sessions found.');
    return;
  }
  const choices = threads.map((t, i) => {
    const shortDate = t.lastActivityAt.slice(5, 16).replace('T', ' ');
    const preview = t.preview.length > 40 ? t.preview.slice(0, 40) + '...' : t.preview;
    return {
      name: `#${i + 1}  ${shortDate}  (${t.messageCount} msg)  ${preview}`,
      value: String(i),
    };
  });
  choices.push({ name: '(cancel)', value: 'cancel' });
  const answer = await select({
    message: 'Select a session to resume:',
    choices,
  });
  if (answer === 'cancel') return;
  const idx = parseInt(answer, 10);
  const thread = threads[idx];
  const resumedDir = join(config.dataDir, 'threads', thread.id);
  const history = await loadThreadHistory(resumedDir);
  loop.resumeHistory(history);
  activeThreadDir = resumedDir;
  console.log(`Resumed session: ${thread.preview}\n`);
};
```

- [ ] **Step 3: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/cli/chat.ts
git commit -m "feat: interactive session picker with up/down selection"
```
