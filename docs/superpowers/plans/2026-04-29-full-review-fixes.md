# Full Review Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all issues found during the full review (A-G: bugs, security, dead code, magic numbers, method length, docs, tests).

**Architecture:** Fix in dependency order — config first, then bugs, then dead code cleanup, then style (magic numbers, method length), then docs, then tests. Each task is small and independently verifiable.

**Tech Stack:** TypeScript, Vitest, Node.js

**Baseline:** 26 test files, 240 tests passing, tsc clean, 1 pre-existing unhandled rejection in lmd-client test.

---

## Chunk 1: Config & Bugs (A1-A12, B1-B2)

### Task 1: Fix config.ts — add comments to all magic numbers (D)

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add comments to every magic number**

Replace the entire `config.ts` with properly commented values. Every number must have a `//` comment explaining why.

- [ ] **Step 2: Verify tsc passes**

Run: `npx tsc --noEmit`
Expected: clean

---

### Task 2: Fix loop.ts — use config for timeouts (A1), fix null as any (A2), fix retry asymmetry (A3)

**Files:**
- Modify: `src/agent/loop.ts`

- [ ] **Step 1: Replace hardcoded timeouts with config values**

In `execute()`, replace `10 * 60 * 1000` with `config.subAgentTimeoutMs` and `20 * 60 * 1000` with `config.agentTimeoutMs`.

- [ ] **Step 2: Fix `null as any` on line 119**

Change `lmdClient: options.lmdClient ?? null as any` to `lmdClient: options.lmdClient ?? null`.

- [ ] **Step 3: Fix retry asymmetry**

In `callLlm`, change `attempt < 1` to `attempt < 3` so all error types get the same 3 attempts. Or reduce BamlValidationError to also use `attempt < 1` if that was intentional — check with human. **Decision: make both use 3 attempts.**

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/agent/`
Expected: all pass

---

### Task 3: Fix turn-end-callback.ts — use config values (A6), fix condition ordering (A4), remove duplicate warning (A5)

**Files:**
- Modify: `src/agent/turn-end-callback.ts`
- Modify: `src/agent/loop.ts` (remove duplicate anti-loop warning in postTurn)

- [ ] **Step 1: Replace hardcoded thresholds with config values**

Replace `3` with `config.antiLoopThreshold` (new config field, value 3), `7` with `config.antiLoopInterval`, `25` with `config.forceAskUserTurn`, `60` with `config.dangerTurnThreshold` (new, value 60).

- [ ] **Step 2: Fix condition ordering**

Move `turn > 25` safety check AFTER the planFile and completion-claim checks. The safety check should be a catch-all, not blocking more specific checks.

- [ ] **Step 3: Remove duplicate anti-loop warning in loop.ts postTurn**

Remove the `consecutiveFailures >= 3` warning from `loop.ts:postTurn` since `turnEndCallback` already handles it.

- [ ] **Step 4: Update turn-end-callback tests**

Update threshold values in tests if needed to match config values.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/agent/`
Expected: all pass

---

### Task 4: Fix logo.ts — reset writeCount after rotation (A7), remove no-op close (C5)

**Files:**
- Modify: `src/lib/logo.ts`

- [ ] **Step 1: Add `this.writeCount = 0` at end of `roll()` method**

- [ ] **Step 2: Add error logging in `checkRolling` catch block**

Change `catch {}` to `catch (e) { console.error('[logo] checkRolling error:', e) }`

- [ ] **Step 3: Remove no-op `close()` method** (or make it actually flush/close the file)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/lib/`
Expected: all pass

---

### Task 5: Fix chat.ts — UTC+8 timestamps (A8), initial task missing options (A9), magic number comments (D)

**Files:**
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: Import and use `formatTimestamp` from logo.ts for UTC+8**

Replace `new Date().toISOString()` with `formatTimestamp(new Date())` for `createdAt` and `lastActivityAt`.

- [ ] **Step 2: Pass lmdClient/sops/skills in initial task**

In the initial task path, pass the same options as the main loop: `{ threadDir, dataDir, lmdClient, sops, skills }`.

- [ ] **Step 3: Add comments to magic numbers 80, 50, 200**

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all pass

---

### Task 6: Fix cli/index.ts — logo.close on exit (A10), version sync (A11), remove reflect status stub (C7)

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add `logo.close()` before `process.exit()` in signal handlers**

- [ ] **Step 2: Fix version from `0.1.0` to `1.0.0` (or read from package.json)**

- [ ] **Step 3: Remove `reflect status` stub command (dead code)**

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all pass

---

### Task 7: Fix input.ts — tryProcessEsc recursion → loop (A12), magic number comments (D)

**Files:**
- Modify: `src/cli/input.ts`

- [ ] **Step 1: Convert `tryProcessEsc` recursion to while loop**

```typescript
function tryProcessEsc(): void {
  while (dataBuffer.length > 0 && dataBuffer.startsWith('\x1b')) {
    const key = parseKeypress(dataBuffer);
    if (key.name && key.sequence === dataBuffer) {
      dataBuffer = dataBuffer.slice(key.sequence.length);
      onKeypress(key);
      continue;
    }
    // Bare ESC or incomplete sequence — wait for more data
    parseTimer = setTimeout(processBuffer, 10); // 10ms: ESC sequence wait timeout
    return;
  }
  if (dataBuffer.length > 0) {
    processBuffer();
  }
}
```

- [ ] **Step 2: Add comments to magic numbers**

- `10` (ms): `// 10ms: typical ESC sequence wait timeout for terminal key sequences`
- `2` (tab spaces): `// 2 spaces per tab — standard for this codebase`
- `0x7f`: `// 0x7f: ASCII DEL, upper bound for single-width characters`

- [ ] **Step 3: Run all input tests**

Run: `npx vitest run tests/unit/cli/input.test.ts`
Expected: all pass

---

### Task 8: Fix security — bash.ts isReadOnlyCommand (B1), path-sandbox symlink (B2)

**Files:**
- Modify: `src/tools/bash.ts`
- Modify: `src/tools/path-sandbox.ts`
- Modify: `tests/unit/tools/bash.test.ts`
- Modify: `tests/unit/tools/path-sandbox.test.ts`

- [ ] **Step 1: Fix bash.ts isReadOnlyCommand**

Split command by shell metacharacters (`;`, `&&`, `||`, `|`, `$()`, backticks) and check each segment. Or simpler: reject if the command contains any shell metacharacter.

- [ ] **Step 2: Fix path-sandbox.ts — resolve symlinks**

Use `realpathSync` on both `resolved` and `resolvedRoot` before comparison.

- [ ] **Step 3: Write failing test for bash metacharacter bypass**

Test: `isReadOnlyCommand('ls; rm -rf /')` should return false.

- [ ] **Step 4: Write failing test for symlink bypass**

Test: create a symlink inside temp dir pointing outside, verify it's blocked.

- [ ] **Step 5: Implement fixes**

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/tools/`
Expected: all pass

---

## Chunk 2: Dead Code Cleanup (C1-C7)

### Task 9: Delete completer.ts and its test (C1)

**Files:**
- Delete: `src/cli/completer.ts`
- Delete: `tests/unit/cli/completer.test.ts`

- [ ] **Step 1: Delete both files**

- [ ] **Step 2: Verify no imports reference completer**

Run: `rg completer src/`
Expected: no hits

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: all pass

---

### Task 10: Delete sub-agent.ts (C2)

**Files:**
- Delete: `src/agent/sub-agent.ts`

- [ ] **Step 1: Verify no imports**

Run: `rg sub-agent src/`
Expected: no hits (only spawn-agent.ts references, which doesn't import from sub-agent.ts)

- [ ] **Step 2: Delete the file**

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: clean

---

### Task 11: Delete getBridgeFile (C3), BLOCKED_COMMANDS (C6), no-op sequence assignment (C4)

**Files:**
- Modify: `src/storage/history.ts`
- Modify: `src/tools/bash.ts`
- Modify: `src/cli/parse-keypress.ts`

- [ ] **Step 1: Remove `getBridgeFile` from history.ts**

- [ ] **Step 2: Remove `BLOCKED_COMMANDS` from bash.ts and its usage**

- [ ] **Step 3: Remove dead `key.sequence = key.sequence || s || key.name` line from parse-keypress.ts**

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all pass

---

## Chunk 3: Method Length Refactor (E)

### Task 12: Refactor chat.ts startChat into smaller functions (E)

**Files:**
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: Extract `handleSessions` and `handleResume` as module-level functions**

- [ ] **Step 2: Extract `prompt()` as a module-level function**

- [ ] **Step 3: Extract `ensureThread()` as a module-level function**

- [ ] **Step 4: Verify startChat is ≤50 lines**

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: all pass

---

### Task 13: Refactor input.ts readMultiline into a class (E)

**Files:**
- Modify: `src/cli/input.ts`
- Modify: `tests/unit/cli/input.test.ts` (update if API changes)

- [ ] **Step 1: Create `MultilineInput` class with methods for each concern**

Break `readMultiline` into a class:
- Private fields: `buffer`, `cursorPos`, `previousVisualLines`, `resolved`, `resolve`, `dataBuffer`, `parseTimer`
- Methods: `vWidth`, `visualLineCount`, `getLineInfo`, `currentLineStart`, `currentLineEnd`, `render`, `cleanup`, `onKeypress`, `processBuffer`, `tryProcessEsc`, `onData`, `onEnd`, `onResize`
- Public entry: static `read(prompt, stdin, stdout): Promise<string|null>`

- [ ] **Step 2: Ensure all 53 input tests still pass**

Run: `npx vitest run tests/unit/cli/input.test.ts`

---

### Task 14: Refactor loop.ts execute into smaller pieces (E)

**Files:**
- Modify: `src/agent/loop.ts`

- [ ] **Step 1: Extract `prepareContext` — memory retrieval + context formatting**

- [ ] **Step 2: Extract `handleTurnResult` — combines handleResponse + executeToolCall + postTurn**

- [ ] **Step 3: Verify execute is ≤50 lines**

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/agent/`
Expected: all pass

---

## Chunk 4: Magic Number Comments (D) — remaining files

### Task 15: Add comments to remaining magic numbers

**Files:**
- Modify: `src/lib/logo.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/web-search.ts`
- Modify: `src/storage/summary.ts`
- Modify: `src/storage/thread.ts`
- Modify: `src/storage/jsonl.ts`
- Modify: `src/tools/bash.ts`

- [ ] **Step 1: Add `//` comments to all magic numbers in each file**

- [ ] **Step 2: Verify tsc and tests**

Run: `npx tsc --noEmit && npx vitest run`

---

## Chunk 5: Documentation Updates (F)

### Task 16: Update outdated documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-04-27-cli-autocomplete-design.md`
- Modify: `docs/superpowers/specs/2026-04-27-logo-logging-design.md`
- Modify: `docs/superpowers/specs/2026-04-27-multiline-input-design.md`

- [ ] **Step 1: Mark autocomplete design as superseded**

Add note at top: Tab completion via readline is no longer possible since stdin is in raw mode. Tab currently inserts 2 spaces.

- [ ] **Step 2: Update logo-logging timestamp format**

Update Section 4 to show `YYYY-MM-DDTHH:mm:ss` (T separator, no ms).

- [ ] **Step 3: Update multiline-input spec**

Remove "CJK deferred" — mark as implemented. Add reference to `parse-keypress.ts` and Kitty protocol.

---

## Chunk 6: Test Coverage (G)

### Task 17: Add missing unit tests for critical paths

**Files:**
- Create: `tests/unit/cli/parse-keypress.test.ts`
- Modify: `tests/unit/tools/bash.test.ts`
- Modify: `tests/unit/agent/loop.test.ts`

- [ ] **Step 1: Write parse-keypress unit tests**

Test single chars (a-z, A-Z, 0-9, symbols), ESC sequences (arrows, F-keys, Home/End), Kitty protocol sequences, Ctrl+letter, unknown sequences.

- [ ] **Step 2: Add bash tool tests for metacharacter bypass, timeout, stderr**

- [ ] **Step 3: Add loop tests for tool execution errors, shouldExit, BamlValidationError retry**

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all pass
