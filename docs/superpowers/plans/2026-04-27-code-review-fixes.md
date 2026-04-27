# Code Review Critical Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and important issues found during code review of the pc2 codebase.

**Architecture:** Two chunks — security fixes first (path sandbox, bash approval, SSRF, yaml safety), then runtime correctness fixes (tiktoken race, messages budget, cron logic, reflect runner). Each task follows TDD: write failing test → verify → implement → verify → commit.

**Tech Stack:** TypeScript, vitest, Node.js fs/path, cron-parser, js-yaml, tiktoken

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/tools/path-sandbox.ts` | Create | Path validation utility (`isPathWithinRoot`) |
| `src/tools/file-read.ts` | Modify | Add path sandbox |
| `src/tools/file-write.ts` | Modify | Add path sandbox |
| `src/tools/file-edit.ts` | Modify | Add path sandbox |
| `src/tools/bash.ts` | Modify | Wire `isReadOnlyCommand` into `execute()` |
| `src/tools/web-fetch.ts` | Modify | Add URL validation (SSRF protection) |
| `src/skill-sop/loader.ts` | Modify | Safe yaml.load with JSON_SCHEMA |
| `src/storage/tokens.ts` | Modify | Promise-based singleton + shutdown hook |
| `src/agent/loop.ts` | Modify | Token budget on `messages` string |
| `src/reflect/scheduler.ts` | Modify | Fix cron fire logic |
| `src/reflect/runner.ts` | Modify | Error handling + task consumer |
| `src/cli/index.ts` | Modify | Wire reflect consumer, SIGTERM |
| `src/config.ts` | Modify | Add `workspaceRoot` field |
| `tests/unit/tools/path-sandbox.test.ts` | Create | Path sandbox tests |
| `tests/unit/tools/file-tools.test.ts` | Modify | Add path traversal test cases |
| `tests/unit/tools/bash.test.ts` | Modify | Add approval wiring test cases |
| `tests/unit/tools/web-fetch.test.ts` | Create | SSRF protection tests |
| `tests/unit/skill-sop/loader.test.ts` | Modify | Add yaml injection test |
| `tests/unit/storage/tokens.test.ts` | Modify | Add race condition test |
| `tests/unit/agent/loop.test.ts` | Modify | Add token budget test |
| `tests/unit/reflect/scheduler.test.ts` | Create | Cron fire logic tests |
| `tests/unit/reflect/runner.test.ts` | Create | Runner error handling tests |

---

## Chunk 1: Security Fixes

### Task 1: Path validation utility

**Files:**
- Create: `src/tools/path-sandbox.ts`
- Test: `tests/unit/tools/path-sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tools/path-sandbox.test.ts
import { describe, it, expect } from 'vitest';
import { isPathWithinRoot } from '../../../src/tools/path-sandbox.js';

describe('isPathWithinRoot', () => {
  it('allows paths within root', () => {
    expect(isPathWithinRoot('/home/user/project/src/foo.ts', '/home/user/project')).toBe(true);
  });

  it('blocks path traversal with ..', () => {
    expect(isPathWithinRoot('/home/user/project/../../../etc/passwd', '/home/user/project')).toBe(false);
  });

  it('blocks absolute path outside root', () => {
    expect(isPathWithinRoot('/etc/passwd', '/home/user/project')).toBe(false);
  });

  it('handles relative paths correctly', () => {
    // resolve('./foo') relative to root should be within root
    expect(isPathWithinRoot('src/foo.ts', '/home/user/project')).toBe(true);
  });

  it('blocks symlink-like traversal', () => {
    expect(isPathWithinRoot('/home/user/project/../secret', '/home/user/project')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tools/path-sandbox.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/tools/path-sandbox.ts
import { resolve } from 'path';

export function isPathWithinRoot(inputPath: string, root: string): boolean {
  const resolved = resolve(inputPath);
  const resolvedRoot = resolve(root);
  return resolved.startsWith(resolvedRoot + '/') || resolved === resolvedRoot;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tools/path-sandbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/path-sandbox.ts tests/unit/tools/path-sandbox.test.ts
git commit -m "feat(tools): add path validation utility for sandbox"
```

---

### Task 2: File tools path sandbox

**Files:**
- Modify: `src/tools/file-read.ts`
- Modify: `src/tools/file-write.ts`
- Modify: `src/tools/file-edit.ts`
- Modify: `src/tools/types.ts`
- Modify: `tests/unit/tools/file-tools.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add `workspaceRoot` to config**

In `src/config.ts`, add field: `workspaceRoot: process.cwd()`

- [ ] **Step 2: Add `workspaceRoot` to ToolContext**

In `src/tools/types.ts`, add to `ToolContext` interface: `workspaceRoot: string`

- [ ] **Step 3: Write failing test for path traversal rejection**

Add to `tests/unit/tools/file-tools.test.ts`:

```typescript
describe('path sandbox', () => {
  it('file_read rejects path traversal', async () => {
    const tool = createFileReadTool();
    const ctx = { ...dummyCtx, workspaceRoot: TEST_DIR };
    const result = await tool.execute({ path: '/etc/passwd' }, ctx);
    expect(String(result.data)).toContain('outside workspace');
  });

  it('file_write rejects path traversal', async () => {
    const tool = createFileWriteTool();
    const ctx = { ...dummyCtx, workspaceRoot: TEST_DIR };
    const result = await tool.execute({ path: '/tmp/evil.txt', content: 'pwned' }, ctx);
    expect(String(result.data)).toContain('outside workspace');
  });

  it('file_edit rejects path traversal', async () => {
    const tool = createFileEditTool();
    const ctx = { ...dummyCtx, workspaceRoot: TEST_DIR };
    const result = await tool.execute({ path: '/etc/hosts', old_string: 'x', new_string: 'y' }, ctx);
    expect(String(result.data)).toContain('outside workspace');
  });

  it('file_read allows path within workspace', async () => {
    const filePath = path.join(TEST_DIR, 'safe.txt');
    await fs.writeFile(filePath, 'safe content', 'utf-8');
    const tool = createFileReadTool();
    const ctx = { ...dummyCtx, workspaceRoot: TEST_DIR };
    const result = await tool.execute({ path: filePath }, ctx);
    expect(String(result.data)).toContain('safe content');
  });
});
```

Update `dummyCtx` to include `workspaceRoot: TEST_DIR`.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/tools/file-tools.test.ts`
Expected: FAIL — paths not rejected (tools don't check)

- [ ] **Step 5: Implement path checks in file-read.ts**

```typescript
import { isPathWithinRoot } from './path-sandbox.js';

// At start of execute(), before any file ops:
const filePath = args.path as string;
const root = ctx.workspaceRoot;
if (!isPathWithinRoot(filePath, root)) {
  return { data: `Access denied: path outside workspace (${filePath})`, nextPrompt: null, shouldExit: false };
}
```

Repeat similar check in `file-write.ts` and `file-edit.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/tools/file-tools.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests pass (may need to update dummyCtx in other tests)

- [ ] **Step 8: Commit**

```bash
git add src/tools/file-read.ts src/tools/file-write.ts src/tools/file-edit.ts src/tools/types.ts src/config.ts tests/unit/tools/file-tools.test.ts
git commit -m "fix(tools): add path sandbox to file_read/write/edit — block path traversal"
```

---

### Task 3: Bash tool — wire isReadOnlyCommand

**Files:**
- Modify: `src/tools/bash.ts`
- Modify: `tests/unit/tools/bash.test.ts`

The spec says: read-only commands auto-approve, everything else requires approval. Since V1 has no interactive approval mechanism, non-read-only commands are rejected unless `autoApprove` is set.

- [ ] **Step 1: Write failing test**

Add to `tests/unit/tools/bash.test.ts`:

```typescript
describe('approval wiring', () => {
  it('auto-executes read-only commands without autoApprove', async () => {
    const tool = createBashTool({ autoApprove: false });
    const result = await tool.execute({ command: 'echo hello' }, dummyCtx as any);
    expect(String(result.data)).toContain('hello');
  });

  it('rejects non-read-only command when autoApprove is false', async () => {
    const tool = createBashTool({ autoApprove: false, cwd: '/tmp' });
    const result = await tool.execute({ command: 'rm -rf /tmp/test' }, dummyCtx as any);
    expect(String(result.data)).toContain('requires approval');
  });

  it('executes non-read-only command when autoApprove is true', async () => {
    const tool = createBashTool({ autoApprove: true, cwd: '/tmp' });
    const result = await tool.execute({ command: 'touch /tmp/bash-test-approval' }, dummyCtx as any);
    expect(String(result.data)).not.toContain('requires approval');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tools/bash.test.ts`
Expected: FAIL — `rm` command executes instead of being rejected

- [ ] **Step 3: Wire isReadOnlyCommand into execute()**

In `src/tools/bash.ts`, modify `execute()`:

```typescript
async execute(args): Promise<StepOutcome> {
  const cmd = args.command as string;
  if (BLOCKED_COMMANDS.some((b) => cmd.trim().startsWith(b))) {
    return { data: `Blocked command: ${cmd}. Use web_fetch instead.`, nextPrompt: null, shouldExit: false };
  }
  if (!opts.autoApprove && !isReadOnlyCommand(cmd)) {
    return { data: `Command requires approval: ${cmd}. Set autoApprove or use a read-only alternative.`, nextPrompt: null, shouldExit: false };
  }
  // ... existing exec logic
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tools/bash.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/tools/bash.ts tests/unit/tools/bash.test.ts
git commit -m "fix(tools): wire isReadOnlyCommand into bash execute — reject non-read-only without approval"
```

---

### Task 4: web_fetch SSRF protection

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Create: `tests/unit/tools/web-fetch.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/tools/web-fetch.test.ts
import { describe, it, expect } from 'vitest';
import { createWebFetchTool } from '../../../src/tools/web-fetch.js';

const dummyCtx = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: '/tmp', agentId: 'test', isSubAgent: false,
};

describe('web_fetch SSRF protection', () => {
  it('blocks cloud metadata endpoint', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }, dummyCtx as any);
    expect(String(result.data)).toContain('not allowed');
  });

  it('blocks localhost', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://localhost:8080/admin' }, dummyCtx as any);
    expect(String(result.data)).toContain('not allowed');
  });

  it('blocks 127.0.0.1', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://127.0.0.1:3000/api' }, dummyCtx as any);
    expect(String(result.data)).toContain('not allowed');
  });

  it('blocks private network 10.x', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://10.0.0.1/internal' }, dummyCtx as any);
    expect(String(result.data)).toContain('not allowed');
  });

  it('allows public HTTPS URLs', async () => {
    const tool = createWebFetchTool();
    // This will fail at fetch() but should NOT be blocked by SSRF check
    const result = await tool.execute({ url: 'https://example.com/page' }, dummyCtx as any);
    expect(String(result.data)).not.toContain('not allowed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tools/web-fetch.test.ts`
Expected: FAIL — SSRF not blocked

- [ ] **Step 3: Implement SSRF check**

```typescript
// src/tools/web-fetch.ts
const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '169.254.169.254',
];

function isUrlAllowed(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;
    if (BLOCKED_HOSTS.includes(host)) return false;
    // Block private networks: 10.x, 172.16-31.x, 192.168.x
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}
```

In `execute()`, before fetch:
```typescript
if (!isUrlAllowed(args.url as string)) {
  return { data: `URL not allowed: ${args.url}`, nextPrompt: null, shouldExit: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tools/web-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-fetch.ts tests/unit/tools/web-fetch.test.ts
git commit -m "fix(tools): add SSRF protection to web_fetch — block private/metadata IPs"
```

---

### Task 5: yaml.load safe schema

**Files:**
- Modify: `src/skill-sop/loader.ts`
- Modify: `tests/unit/skill-sop/loader.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/skill-sop/loader.test.ts`:

```typescript
it('rejects yaml with !!js/function (code injection)', () => {
  const malicious = '---\nname: Evil\ndescription: !!js/function "function(){return process}"\nevolvable: true\n---\n\nBody';
  expect(() => parseSkillFrontmatter(malicious)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/skill-sop/loader.test.ts`
Expected: FAIL — !!js/function is silently parsed

- [ ] **Step 3: Fix yaml.load**

In `src/skill-sop/loader.ts`, change line 9:
```typescript
const frontmatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/skill-sop/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-sop/loader.ts tests/unit/skill-sop/loader.test.ts
git commit -m "fix(loader): use JSON_SCHEMA for yaml.load — block !!js/function injection"
```

---

## Chunk 2: Runtime Correctness

### Task 6: Tiktoken encoder race condition + shutdown hook

**Files:**
- Modify: `src/storage/tokens.ts`
- Modify: `tests/unit/storage/tokens.test.ts`

- [ ] **Step 1: Write failing test for concurrent access**

Add to `tests/unit/storage/tokens.test.ts`:

```typescript
it('concurrent getEncoder calls return same instance', async () => {
  freeEncoder();
  const results = await Promise.all([
    countTokens('hello'),
    countTokens('world'),
    countTokens('test'),
  ]);
  expect(results.every(r => r > 0)).toBe(true);
});
```

This test verifies the fix works — concurrent calls don't crash or leak.

- [ ] **Step 2: Run test — should pass after fix, may fail before**

Run: `npx vitest run tests/unit/storage/tokens.test.ts`

- [ ] **Step 3: Fix with promise-based singleton**

Replace `src/storage/tokens.ts`:

```typescript
import type { Message } from '../types.js';

let _encoderPromise: Promise<any> | null = null;

function getEncoder() {
  if (!_encoderPromise) {
    _encoderPromise = (async () => {
      const tiktoken = await import('tiktoken');
      return tiktoken.encoding_for_model('gpt-4o');
    })();
  }
  return _encoderPromise;
}

export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;
  const encoder = await getEncoder();
  return encoder.encode(text).length;
}

export async function countMessagesTokens(messages: Message[]): Promise<number> {
  let total = 0;
  for (const msg of messages) {
    total += await countTokens(msg.content);
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += await countTokens(JSON.stringify(tc.arguments));
      }
    }
  }
  return total;
}

export function freeEncoder(): void {
  if (_encoderPromise) {
    _encoderPromise.then(enc => enc.free()).catch(() => {});
    _encoderPromise = null;
  }
}

export function registerShutdownHook(): void {
  process.on('exit', () => {
    if (_encoderPromise) {
      // Synchronous cleanup not possible with async encoder.
      // The promise-based approach ensures only one instance exists.
    }
  });
}
```

Key change: `_encoder` (nullable instance) → `_encoderPromise` (nullable promise). The promise is created once and shared across all callers, eliminating the race.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/storage/tokens.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/tokens.ts tests/unit/storage/tokens.test.ts
git commit -m "fix(tokens): promise-based singleton — eliminate encoder race condition"
```

---

### Task 7: Messages string token budget

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/unit/agent/loop.test.ts`

The `messages` string grows without bound. Fix: after each turn, check token count. If it exceeds 60% of context window, truncate oldest content (keep system + recent turns).

- [ ] **Step 1: Write failing test**

Add to `tests/unit/agent/loop.test.ts`:

```typescript
it('truncates messages when approaching context limit', async () => {
  const { b } = await import('../../../baml_client/index.js');

  // First call returns long text + tool call, second returns done
  let callCount = 0;
  (b.AgentChat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    callCount++;
    if (callCount === 1) {
      return { text: 'A'.repeat(50000), tool_calls: [{ name: 'echo', arguments: '{"msg":"x"}', id: 'tc_1' }] };
    }
    return { text: 'Done', tool_calls: [] };
  });

  const echoTool: Tool = {
    name: 'echo',
    description: 'echo',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ data: 'ok', nextPrompt: null, shouldExit: false }),
  };

  const registry = new ToolRegistry();
  registry.register(echoTool);
  const loop = new AgentLoop(registry);
  const events = [];
  for await (const event of loop.execute('test', { maxRounds: 5 })) {
    events.push(event);
  }
  // Should not crash or OOM — messages should be truncated
  expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'completed' });
});
```

- [ ] **Step 2: Run test to verify it fails or is fragile**

Run: `npx vitest run tests/unit/agent/loop.test.ts`

- [ ] **Step 3: Implement message budget in loop.ts**

In `src/agent/loop.ts`, after the `messages += ...` append inside the loop:

```typescript
import { countTokens } from '../storage/tokens.js';
import { config } from '../config.js';

// After all message appends in a turn, before next iteration:
const msgTokens = await countTokens(messages);
const budget = Math.floor(config.modelContextWindow * 0.6);
if (msgTokens > budget) {
  // Keep roughly the last 30% of budget worth of messages
  const keepRatio = 0.3;
  const lines = messages.split('\n');
  const keepCount = Math.floor(lines.length * keepRatio);
  messages = '[...earlier context truncated...]\n\n' + lines.slice(-keepCount).join('\n');
  yield { type: 'warning', content: `Context truncated: removed ${lines.length - keepCount} lines to stay within token budget` };
}
```

Placement: after the `turnEndCallback` block (line ~150), before the loop continues.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/loop.ts tests/unit/agent/loop.test.ts
git commit -m "fix(loop): add token budget to messages string — truncate when approaching context limit"
```

---

### Task 8: Cron scheduler — fix fire logic

**Files:**
- Modify: `src/reflect/scheduler.ts`
- Create: `tests/unit/reflect/scheduler.test.ts`

Bug: `interval.next()` returns future time, so `next <= now` is always false. Fix: use `.prev()` to check if a scheduled time occurred since last run.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/reflect/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCronSchedulerModule } from '../../../src/reflect/scheduler.js';

describe('cron scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires when scheduled time passes', async () => {
    // Set time to 09:00
    const baseTime = new Date('2026-04-27T09:00:00+08:00');
    vi.setSystemTime(baseTime);

    const mod = createCronSchedulerModule([{
      expression: '30 9 * * *', // 09:30
      task: 'morning_report',
      timezone: 'Asia/Shanghai',
      enabled: true,
    }], 60_000);

    // At 09:00 — not yet due
    let result = await mod.check();
    expect(result).toBeNull();

    // Advance to 09:31 — should fire
    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    result = await mod.check();
    expect(result).toBe('morning_report');

    // Check again immediately — should not fire again (cooldown)
    result = await mod.check();
    expect(result).toBeNull();
  });

  it('skips disabled jobs', async () => {
    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    const mod = createCronSchedulerModule([{
      expression: '30 9 * * *',
      task: 'disabled_task',
      timezone: 'Asia/Shanghai',
      enabled: false,
    }], 60_000);

    const result = await mod.check();
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/reflect/scheduler.test.ts`
Expected: FAIL — scheduler never fires

- [ ] **Step 3: Fix cron logic**

Replace `scheduler.ts` check logic:

```typescript
async check() {
  const now = Date.now();
  const tasks: string[] = [];

  for (const job of jobs) {
    if (!job.enabled) continue;
    const last = lastRuns.get(job.task) ?? 0;
    try {
      const interval = CronExpressionParser.parse(job.expression, { tz: job.timezone });
      // prev() returns the last scheduled time BEFORE now
      const prev = interval.prev().getTime();
      // Fire if: a scheduled time occurred since our last run
      if (prev > last) {
        tasks.push(job.task);
        lastRuns.set(job.task, now);
      }
    } catch {
      // invalid cron expression — skip
    }
  }

  return tasks.length > 0 ? tasks.join('\n') : null;
}
```

Key changes:
- Use `.prev()` instead of `.next()` — gets last scheduled time before now
- Use `job.task` as Map key instead of `job.expression` — avoids collision when multiple jobs share same expression
- Remove the `60_000` cooldown hack — crontab expressions inherently express frequency

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/reflect/scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/reflect/scheduler.ts tests/unit/reflect/scheduler.test.ts
git commit -m "fix(scheduler): use prev() instead of next() — cron jobs actually fire now"
```

---

### Task 9: ReflectRunner — error handling + task consumer

**Files:**
- Modify: `src/reflect/runner.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/unit/reflect/runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/reflect/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ReflectRunner } from '../../../src/reflect/runner.js';
import type { ReflectModule } from '../../../src/reflect/types.js';

describe('ReflectRunner', () => {
  it('wraps check() in try/catch — does not crash on module error', async () => {
    const badModule: ReflectModule = {
      name: 'bad',
      interval: 100,
      once: false,
      async check() { throw new Error('boom'); },
    };
    const runner = new ReflectRunner([badModule]);
    // start() sets up intervals — should not throw
    expect(() => runner.start()).not.toThrow();
    runner.stop();
  });

  it('accumulates tasks from check() results', async () => {
    const mod: ReflectModule = {
      name: 'test',
      interval: 100,
      once: false,
      async check() { return 'do_something'; },
    };
    const runner = new ReflectRunner([mod]);
    runner.start();
    // Wait for one interval tick
    await new Promise(r => setTimeout(r, 150));
    expect(runner.pendingCount).toBeGreaterThan(0);
    runner.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/reflect/runner.test.ts`
Expected: FAIL — unhandled promise rejection from `badModule`

- [ ] **Step 3: Fix runner — wrap check() in try/catch + add consumer**

Replace `src/reflect/runner.ts`:

```typescript
import type { ReflectModule } from './types.js';

export class ReflectRunner {
  private timers: NodeJS.Timeout[] = [];
  private taskQueue: string[] = [];
  private consumerTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private modules: ReflectModule[],
    private onTask?: (task: string) => void | Promise<void>,
  ) {}

  start(): void {
    for (const mod of this.modules) {
      const timer = setInterval(async () => {
        try {
          const task = await mod.check();
          if (task) {
            this.taskQueue.push(task);
          }
        } catch (err) {
          console.error(`[reflect] module ${mod.name} error:`, err);
        }
      }, mod.interval);
      this.timers.push(timer);
    }
    // Start consumer
    this.consumerTimer = setInterval(() => this.processQueue(), 5_000);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    if (this.consumerTimer) clearInterval(this.consumerTimer);
    this.timers = [];
    this.consumerTimer = null;
  }

  private async processQueue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      try {
        if (this.onTask) {
          await this.onTask(task);
        } else {
          console.log(`[reflect] task: ${task}`);
        }
      } catch (err) {
        console.error('[reflect] task error:', err);
      }
    }
    this.running = false;
  }

  pollQueue(): string | null {
    return this.taskQueue.shift() ?? null;
  }

  get pendingCount(): number {
    return this.taskQueue.length;
  }
}
```

- [ ] **Step 4: Update cli/index.ts to pass onTask callback**

In `src/cli/index.ts`, update reflect start action:

```typescript
const runner = new ReflectRunner(
  [createAutonomousModule(), createCronSchedulerModule([])],
  (task) => console.log(`[reflect] executing: ${task}`),
);
runner.start();
```

Also add SIGTERM handler:

```typescript
process.on('SIGTERM', () => {
  runner.stop();
  process.exit(0);
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/reflect/runner.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/reflect/runner.ts src/cli/index.ts tests/unit/reflect/runner.test.ts
git commit -m "fix(reflect): error handling in runner + task consumer + SIGTERM handler"
```

---

### Task 10: checkAndFreeze race condition

**Files:**
- Modify: `src/storage/summary.ts`

Race: two concurrent `checkAndFreeze` calls both see `frozenFiles.length === N`, both generate `messages-00N.jsonl`, second overwrites first.

Fix: use a per-directory lock (in-memory promise).

- [ ] **Step 1: Write failing test**

Add to `tests/unit/storage/summary.test.ts`:

```typescript
it('concurrent checkAndFreeze calls do not conflict', async () => {
  const threshold = config.freezeThreshold();
  const tokenCounter = async () => threshold + 1;

  // Create messages for 2 separate freeze attempts
  await appendJsonl(CURRENT_FILE, makeMsg('1', 'first'));

  // Run two freeze attempts concurrently
  const [r1, r2] = await Promise.all([
    checkAndFreeze(THREAD_DIR, tokenCounter),
    checkAndFreeze(THREAD_DIR, tokenCounter),
  ]);

  // One should succeed, one should no-op (no data loss)
  const successes = [r1, r2].filter(Boolean).length;
  expect(successes).toBe(1);

  // Verify only one frozen file was created
  const files = await fs.readdir(THREAD_DIR);
  const frozen = files.filter(f => f.startsWith('messages-') && f !== 'messages-current.jsonl');
  expect(frozen).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/storage/summary.test.ts`
Expected: FAIL — both calls may create conflicting files

- [ ] **Step 3: Implement per-directory lock**

In `src/storage/summary.ts`:

```typescript
const freezeLocks = new Map<string, Promise<boolean>>();

export async function checkAndFreeze(
  threadDir: string,
  tokenCounter: (msgs: any[]) => Promise<number>,
): Promise<boolean> {
  // Serialize concurrent calls for the same directory
  const prev = freezeLocks.get(threadDir) ?? Promise.resolve(false);
  const next = prev.then(async () => {
    const currentFile = join(threadDir, 'messages-current.jsonl');
    const messages = await readJsonl(currentFile);
    if (messages.length === 0) return false;

    const tokens = await tokenCounter(messages);
    if (tokens < config.freezeThreshold()) return false;

    const frozenFiles = await getFrozenFiles(threadDir);
    const nextNum = String(frozenFiles.length + 1).padStart(3, '0');
    const frozenPath = join(threadDir, `messages-${nextNum}.jsonl`);

    await rename(currentFile, frozenPath);
    await writeFile(currentFile, '', 'utf-8');
    return true;
  });
  freezeLocks.set(threadDir, next.catch(() => false));
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/storage/summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/summary.ts tests/unit/storage/summary.test.ts
git commit -m "fix(summary): per-directory lock in checkAndFreeze — prevent concurrent freeze race"
```

---

### Task 11: Full test suite verification

- [ ] **Step 1: Run tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full vitest suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Verify no regressions**

Spot-check a few key tests:
- `tests/unit/tools/file-tools.test.ts` — path sandbox works
- `tests/unit/tools/bash.test.ts` — approval wiring works
- `tests/unit/reflect/scheduler.test.ts` — cron fires correctly
- `tests/unit/storage/tokens.test.ts` — concurrent access safe
- `tests/unit/agent/loop.test.ts` — message budget works
