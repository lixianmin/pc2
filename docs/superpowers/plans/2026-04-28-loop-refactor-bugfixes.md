# Loop Refactor & Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Refactor loop.ts execute() into ≤50-line methods, unify appendMessage, fix echo, add BAML retry, fix log format, configure web search URL.

**Spec:** `docs/superpowers/specs/2026-04-28-loop-refactor-bugfixes-design.md`

---

## File Structure

| Action | Path |
|--------|------|
| Modify | `src/storage/jsonl.ts` — add `appendMessage` |
| Modify | `src/lib/logo.ts` — fix timestamp format |
| Modify | `src/config.ts` — add `webSearchUrl` |
| Modify | `src/tools/web-search.ts` — use config URL |
| Modify | `src/cli/input.ts` — fix echo in cleanup() |
| Rewrite | `src/agent/loop.ts` — split execute() into sub-methods |
| Modify | `tests/unit/cli/input.test.ts` — update if needed |

---

## Chunk 1: Independent small changes (no loop.ts dependency)

### Task 1: Add `appendMessage` to jsonl.ts

- [ ] Add `appendMessage(dir, role, content, opts?)` to `src/storage/jsonl.ts`
  - Import `randomBytes` from `crypto`, `join` from `path`
  - Import `Message`, `ToolCall` from `../types.js`
  - ID: `msg_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
  - Timestamp: `new Date().toISOString()`
  - Keep existing `appendJsonl` export

- [ ] Verify: `npx tsc --noEmit`
- [ ] Commit: `feat: add appendMessage with unified ID and timestamp`

### Task 2: Fix log timestamp format

- [ ] In `src/lib/logo.ts`, replace `formatTimestamp()` (line 75-80):
  ```ts
  function formatTimestamp(): string {
    const now = new Date();
    const offset = 8 * 60;
    const local = new Date(now.getTime() + offset * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000);
    const y = local.getFullYear();
    const M = String(local.getMonth() + 1).padStart(2, '0');
    const d = String(local.getDate()).padStart(2, '0');
    const h = String(local.getHours()).padStart(2, '0');
    const m = String(local.getMinutes()).padStart(2, '0');
    const s = String(local.getSeconds()).padStart(2, '0');
    return `${y}-${M}-${d}T${h}:${m}:${s}`;
  }
  ```

- [ ] Run existing tests: `npx vitest run tests/unit/lib/logo.test.ts`
- [ ] Commit: `fix: log timestamp to ISO 8601 with T separator, no milliseconds`

### Task 3: Make web search URL configurable

- [ ] In `src/config.ts`, add `webSearchUrl: process.env.WEB_SEARCH_URL ?? 'http://127.0.0.1:5001'`
- [ ] In `src/tools/web-search.ts`, import config, replace hardcoded URL with `config.webSearchUrl`
- [ ] Verify: `npx tsc --noEmit`
- [ ] Commit: `feat: web search URL configurable via WEB_SEARCH_URL env var`

### Task 4: Fix readMultiline echo

- [ ] In `src/cli/input.ts`, modify `cleanup()`:
  - Before writing `\n`, move cursor up by `previousVisualLines`, then clear (`\x1b[J`)
  - On submit (called with buffer): write `prompt + buffer + \n`
  - On abort (Ctrl+C): write just `\n`
  
  Signature: `cleanup(writeBuffer: boolean)` — `true` for submit, `false` for abort.
  Update all callers: submit passes `true`, Ctrl+C and stdin end pass `false`.

- [ ] Run tests: `npx vitest run tests/unit/cli/input.test.ts`
- [ ] Commit: `fix: clear rendered input area before submit to prevent echo`

---

## Chunk 2: loop.ts refactor (depends on Task 1)

### Task 5: Rewrite loop.ts with sub-methods

The full rewritten file. Key changes:
- Replace `import { appendJsonl }` with `import { appendMessage }`
- Remove `import { join } from 'path'` (no longer needed in loop.ts)
- Split execute() into: callLlm, handleResponse, executeToolCall, postTurn
- All sub-methods are `private async *` returning `AsyncGenerator<AgentEvent>`
- Shared mutable state (messages, lastAssistantText, consecutiveFailures, lastFailedTool) stays as closure vars in execute()
- callLlm handles BamlValidationError retry (3 attempts) + other error retry (2 attempts)

Sub-method signatures (all private async *):

```
callLlm(turn, messages, toolsDesc, skillsList, sopsList, contextBlock, relevantMemory)
  → yields warning on non-parse errors
  → returns ChatResponse | null (null = failed, already yielded done)

handleResponse(turn, response, threadDir)
  → yields { type: 'text' }
  → mutates: messages, lastAssistantText
  → writes appendMessage if response.text non-empty
  → returns boolean (has tool_calls)

executeToolCall(turn, tc, threadDir, options, isSubAgent)
  → yields tool_call, tool_result, possibly done(ask_user)
  → mutates: messages, consecutiveFailures, lastFailedTool
  → writes appendMessage for tool result
  → returns boolean (shouldExit)

postTurn(turn, response, threadDir, options, consecutiveFailures, lastFailedTool)
  → yields warnings
  → mutates: messages (system warnings, truncation)
  → does freeze/summarize, context truncate
```

execute() main loop:
```
async *execute(userMessage, options):
  init vars, write user appendMessage
  for turn 1..maxRounds:
    if timeout: yield done, return
    build contextBlock, relevantMemory
    response = yield* this.callLlm(...)
    if response is null: return
    hasTools = yield* this.handleResponse(...)
    if !hasTools: return
    for tc in response.tool_calls:
      shouldExit = yield* this.executeToolCall(...)
      if shouldExit: return
    yield* this.postTurn(...)
  yield done(max_rounds)
```

- [ ] Rewrite `src/agent/loop.ts`
- [ ] Verify: `npx tsc --noEmit`
- [ ] Run all tests: `npx vitest run`
- [ ] Commit: `refactor: split execute() into callLlm/handleResponse/executeToolCall/postTurn`

### Task 6: Update tests and verify

- [ ] Run: `npx vitest run` — all tests pass
- [ ] Run: `npx tsc --noEmit` — no errors
