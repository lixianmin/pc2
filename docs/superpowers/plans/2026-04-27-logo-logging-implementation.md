# logo 日志库 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 logo 轻量级日志库并集成到 pc2 全路径，支持事后调试和性能分析。

**Architecture:** 单文件 `src/lib/logo.ts` 实现 Logger + RollingFileWriter，按级别分文件写入 `logs/`，rolling 归档到 `logs/archive/`。然后在 agent loop、storage、memory、reflect、CLI、skills 6 个子系统集成日志调用。

**Tech Stack:** TypeScript, Node.js fs/stream, vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/logo.ts` | Create | Logger 类 + RollingFileWriter + singleton |
| `tests/unit/lib/logo.test.ts` | Create | Logo 单元测试 |
| `src/config.ts` | Modify | 添加 logDir, logLevel, logMaxFileSize |
| `src/cli/chat.ts` | Modify | logo.init({ console: false }) |
| `src/agent/loop.ts` | Modify | 添加 LLM/tool/freeze/truncation 日志 |
| `src/storage/tokens.ts` | Modify | encoder init 日志 |
| `src/storage/summary.ts` | Modify | freeze/summarize 日志 |
| `src/memory/lmd-client.ts` | Modify | query/add/retry 日志 |
| `src/reflect/runner.ts` | Modify | 替换 console.* + 添加 task 日志 |
| `src/reflect/scheduler.ts` | Modify | cron fire 日志 |
| `src/cli/index.ts` | Modify | 替换 console.* + 启动日志 |
| `src/skill-sop/loader.ts` | Modify | skill 加载日志 |

---

## Chunk 1: Logo Library Core

### Task 1: Implement logo.ts

**Files:**
- Create: `src/lib/logo.ts`
- Create: `tests/unit/lib/logo.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/lib/logo.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Logo, LogLevel, logo } from '../../../src/lib/logo.js';

const TEST_DIR = path.join(__dirname, 'tmp-logo');

describe('Logo', () => {
  let testLogo: Logo;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    testLogo = new Logo();
    testLogo.init({ logDir: TEST_DIR, console: false, level: LogLevel.Debug, maxFileSize: 1024, maxArchives: 2 });
  });

  afterEach(async () => {
    testLogo.close();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes info log to info.log', async () => {
    testLogo.info('test message');
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).toContain('[I] test message');
  });

  it('formats timestamp as YYYY-MM-DD HH:mm:ss.SSS', async () => {
    testLogo.info('format test');
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('includes caller file and line', async () => {
    testLogo.info('caller test');
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    // Should NOT contain logo.ts itself
    expect(content).not.toContain('logo.ts:');
    // Should contain some filename:line
    expect(content).toMatch(/\w+\.ts:\d+/);
  });

  it('cascades error to error.log + warn.log + info.log', async () => {
    testLogo.error('cascade test');
    testLogo.close();
    const errorContent = await fs.readFile(path.join(TEST_DIR, 'error.log'), 'utf-8');
    const warnContent = await fs.readFile(path.join(TEST_DIR, 'warn.log'), 'utf-8');
    const infoContent = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(errorContent).toContain('[E] cascade test');
    expect(warnContent).toContain('[E] cascade test');
    expect(infoContent).toContain('[E] cascade test');
  });

  it('cascades warn to warn.log + info.log', async () => {
    testLogo.warn('warn cascade');
    testLogo.close();
    const warnContent = await fs.readFile(path.join(TEST_DIR, 'warn.log'), 'utf-8');
    const infoContent = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(warnContent).toContain('[W] warn cascade');
    expect(infoContent).toContain('[W] warn cascade');
  });

  it('filters by level', async () => {
    testLogo.init({ logDir: TEST_DIR, console: false, level: LogLevel.Warn, maxFileSize: 1024 });
    testLogo.debug('should not appear');
    testLogo.info('should not appear');
    testLogo.warn('should appear');
    testLogo.close();
    const infoContent = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(infoContent).not.toContain('should not appear');
    expect(infoContent).toContain('should appear');
  });

  it('serializes objects as JSON', async () => {
    testLogo.info('data test', { tokens: 150, latency_ms: 1200 });
    testLogo.close();
    const content = await fs.readFile(path.join(TEST_DIR, 'info.log'), 'utf-8');
    expect(content).toContain('"tokens":150');
    expect(content).toContain('"latency_ms":1200');
  });

  it('rolls file when exceeding maxFileSize', async () => {
    // Write enough data to exceed 1024 bytes
    for (let i = 0; i < 50; i++) {
      testLogo.info(`rolling test line ${i} with padding to make it longer than usual`);
    }
    testLogo.close();
    const archiveDir = path.join(TEST_DIR, 'archive');
    const exists = await fs.access(archiveDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('does not write to console when console:false', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    testLogo.init({ logDir: TEST_DIR, console: false, maxFileSize: 1024 });
    testLogo.info('no console');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('writes to stderr when console:true', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    testLogo.init({ logDir: TEST_DIR, console: true, maxFileSize: 1024 });
    testLogo.info('yes console');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('close is idempotent', () => {
    testLogo.close();
    testLogo.close();
    testLogo.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/logo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement logo.ts**

```typescript
// src/lib/logo.ts
import fs from 'fs';
import path from 'path';

export enum LogLevel { Debug = 1, Info = 2, Warn = 3, Error = 4 }

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.Debug]: '[D]',
  [LogLevel.Info]: '[I]',
  [LogLevel.Warn]: '[W]',
  [LogLevel.Error]: '[E]',
};

interface LogoOptions {
  logDir?: string;
  maxFileSize?: number;
  maxArchives?: number;
  console?: boolean;
  level?: LogLevel;
}

class RollingFileWriter {
  private stream: fs.WriteStream | null = null;
  private writeCount = 0;
  private readonly checkInterval = 1024;

  constructor(
    private filePath: string,
    private maxFileSize: number,
    private maxArchives: number,
  ) {}

  write(line: string): void {
    if (!this.stream) {
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
    this.stream.write(line + '\n');
    this.writeCount++;
    if (this.writeCount % this.checkInterval === 0) {
      this.checkRolling();
    }
  }

  private checkRolling(): void {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size >= this.maxFileSize) {
        this.roll();
      }
    } catch {}
  }

  private roll(): void {
    this.stream?.end();
    this.stream = null;
    const archiveDir = path.join(path.dirname(this.filePath), 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const baseName = path.basename(this.filePath, '.log');
    const date = formatArchiveDate();
    let seq = 1;
    while (fs.existsSync(path.join(archiveDir, `${baseName}${date}_${String(seq).padStart(3, '0')}.log`))) {
      seq++;
    }
    const archivePath = path.join(archiveDir, `${baseName}${date}_${String(seq).padStart(3, '0')}.log`);
    fs.renameSync(this.filePath, archivePath);
    this.cleanOldArchives(archiveDir, baseName);
  }

  private cleanOldArchives(archiveDir: string, baseName: string): void {
    const files = fs.readdirSync(archiveDir)
      .filter(f => f.startsWith(baseName))
      .sort();
    while (files.length > this.maxArchives) {
      const toDelete = files.shift()!;
      fs.unlinkSync(path.join(archiveDir, toDelete));
    }
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

function formatTimestamp(): string {
  const now = new Date();
  const dateStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false });
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${dateStr}.${ms}`;
}

function formatArchiveDate(): string {
  const now = new Date();
  const parts = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).split('-');
  return parts.join('');
}

export class Logo {
  private writers: Map<string, RollingFileWriter> = new Map();
  private initialized = false;
  private logDir = 'logs';
  private maxFileSize = 10 * 1024 * 1024;
  private maxArchives = 5;
  private consoleEnabled = true;
  private level = LogLevel.Info;

  init(opts?: LogoOptions): void {
    if (opts?.logDir !== undefined) this.logDir = opts.logDir;
    if (opts?.maxFileSize !== undefined) this.maxFileSize = opts.maxFileSize;
    if (opts?.maxArchives !== undefined) this.maxArchives = opts.maxArchives;
    if (opts?.console !== undefined) this.consoleEnabled = opts.console;
    if (opts?.level !== undefined) this.level = opts.level;
    fs.mkdirSync(this.logDir, { recursive: true });
    this.initialized = true;
  }

  debug(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Debug, msg, args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Info, msg, args);
  }

  warn(msg: string, ...args: string | unknown[]): void {
    this.log(LogLevel.Warn, msg, args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Error, msg, args);
  }

  close(): void {
    for (const w of this.writers.values()) w.close();
    this.writers.clear();
  }

  private log(level: LogLevel, msg: string, args: unknown[]): void {
    if (level < this.level) return;
    if (!this.initialized) this.init();

    const timestamp = formatTimestamp();
    const caller = this.getCallerInfo();
    const label = LEVEL_LABELS[level];
    const serialized = args.map(a => {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'object') {
        if (a instanceof Error) return a.message;
        return JSON.stringify(a);
      }
      return String(a);
    }).join(' ');
    const line = `${timestamp} ${caller.file}:${caller.line} ${label} ${msg}${serialized ? ' ' + serialized : ''}`;

    // File cascade
    const files: string[] = [];
    if (level >= LogLevel.Error) files.push('error.log', 'warn.log', 'info.log');
    else if (level >= LogLevel.Warn) files.push('warn.log', 'info.log');
    else files.push('info.log');

    for (const f of files) {
      this.getWriter(f).write(line);
    }

    // Console
    if (this.consoleEnabled) {
      process.stderr.write(line + '\n');
    }
  }

  private getWriter(filename: string): RollingFileWriter {
    let w = this.writers.get(filename);
    if (!w) {
      w = new RollingFileWriter(
        path.join(this.logDir, filename),
        this.maxFileSize,
        this.maxArchives,
      );
      this.writers.set(filename, w);
    }
    return w;
  }

  private getCallerInfo(): { file: string; line: number } {
    const err = new Error();
    const lines = err.stack?.split('\n') || [];
    for (const line of lines) {
      const match = line.match(/at .+ \((.+):(\d+):\d+\)/) ?? line.match(/at (.+):(\d+):\d+/);
      if (match) {
        const filePath = match[1];
        const lineNum = parseInt(match[2], 10);
        const file = path.basename(filePath);
        if (file !== 'logo.ts') {
          return { file, line: lineNum };
        }
      }
    }
    return { file: 'unknown', line: 0 };
  }
}

export const logo = new Logo();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/logo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/logo.ts tests/unit/lib/logo.test.ts
git commit -m "feat: implement logo logging library — Logger + RollingFileWriter"
```

---

## Chunk 2: Integration — Config + Chat Init

### Task 2: Config and chat init

**Files:**
- Modify: `src/config.ts`
- Modify: `src/cli/chat.ts`

- [ ] **Step 1: Add logging config fields**

In `src/config.ts`, add after `workspaceRoot`:

```typescript
  logDir: 'logs',
  logLevel: LogLevel.Info,
  logMaxFileSize: 10 * 1024 * 1024,
```

Also add import: `import { LogLevel } from './lib/logo.js';`

- [ ] **Step 2: Add logo.init to chat.ts**

In `src/cli/chat.ts`, add at top of file:

```typescript
import { logo, LogLevel } from '../lib/logo.js';
```

At start of `startChat()` function, before `const registry`:

```typescript
  logo.init({ console: false, level: LogLevel.Info });
```

Add cleanup before return:

```typescript
  rl.on('close', () => { logo.close(); });
```

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/cli/chat.ts
git commit -m "feat: add logo config and init in chat mode"
```

---

## Chunk 3: Integration — Agent Loop (Core Tracing)

### Task 3: Agent loop logging

**Files:**
- Modify: `src/agent/loop.ts`

This is the most important integration — logs every LLM call, tool call, freeze, summarize, truncation.

- [ ] **Step 1: Add logo import**

Add at top of `src/agent/loop.ts`:

```typescript
import { logo } from '../lib/logo.js';
```

- [ ] **Step 2: Add loop start/end logging**

After `const startTime = Date.now();` (line ~44), add:

```typescript
    logo.info('Agent loop started', { agentId: options.agentId ?? 'main', isSubAgent, maxRounds });
```

Before each `yield { type: 'done', ... }`, add appropriate log. Replace each return point:

After `yield { type: 'done', reason: 'timeout' };` and `return;`:
```typescript
    logo.info('Agent loop done', { reason: 'timeout', turns: turn - 1, elapsed_ms: Date.now() - startTime });
```

After `yield { type: 'done', reason: 'llm_error' };`:
```typescript
    logo.error('Agent loop done', { reason: 'llm_error', turns: turn, elapsed_ms: Date.now() - startTime });
```

After `yield { type: 'done', reason: 'completed' };`:
```typescript
    logo.info('Agent loop done', { reason: 'completed', turns: turn, elapsed_ms: Date.now() - startTime });
```

After `yield { type: 'done', reason: 'ask_user' };`:
```typescript
    logo.info('Agent loop done', { reason: 'ask_user', turns: turn, elapsed_ms: Date.now() - startTime });
```

After `yield { type: 'done', reason: 'max_rounds' };` at end:
```typescript
    logo.warn('Agent loop done', { reason: 'max_rounds', turns: maxRounds, elapsed_ms: Date.now() - startTime });
```

- [ ] **Step 3: Add LLM call logging**

After `response = await b.AgentChat(...)` on first call success (line ~68):

```typescript
        logo.info('LLM response', { turn, text_len: response.text?.length ?? 0, tool_calls: response.tool_calls?.length ?? 0 });
```

After retry warning `yield { type: 'warning', content: 'LLM call failed, retrying...' }`:

```typescript
        logo.warn('LLM call failed, retrying', { turn });
```

- [ ] **Step 4: Add tool call logging**

Before `const result = await this.registry.dispatch(...)` (line ~124):

```typescript
        const toolStart = Date.now();
        logo.info('Tool call start', { turn, name: tc.name, args_len: tc.arguments.length });
```

After result, before JSONL append:

```typescript
        logo.info('Tool call done', { turn, name: tc.name, latency_ms: Date.now() - toolStart, result_len: resultStr.length });
```

- [ ] **Step 5: Add freeze/summarize/truncation logging**

After `await checkAndFreeze(...)` (line ~156):

```typescript
        logo.info('Freeze check completed', { threadDir: options.threadDir });
```

After `await checkAndSummarize(...)`:

```typescript
        if (summaryPath) {
          logo.info('Summarize completed', { source: summaryPath });
        }
```

Inside truncation block (line ~165), after `messages = '...'`:

```typescript
        logo.warn('Context truncated', { removed: lines.length - keepCount, kept: keepCount, tokens: msgTokens });
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: PASS (existing tests should still pass)

- [ ] **Step 7: Commit**

```bash
git add src/agent/loop.ts
git commit -m "feat(loop): add logo logging for LLM calls, tool calls, freeze, truncation"
```

---

## Chunk 4: Integration — Storage, Memory, Reflect, CLI, Skills

### Task 4: Storage layer logging

**Files:**
- Modify: `src/storage/tokens.ts`
- Modify: `src/storage/summary.ts`

- [ ] **Step 1: Add logging to tokens.ts**

Add import: `import { logo } from '../lib/logo.js';`

Inside `getEncoder()` function, after `_encoderPromise = (async () => {`:

```typescript
      logo.debug('tiktoken encoder initializing');
```

After `return tiktoken.encoding_for_model('gpt-4o');`:

```typescript
      logo.debug('tiktoken encoder initialized');
```

- [ ] **Step 2: Add logging to summary.ts**

Add import: `import { logo } from '../lib/logo.js';`

In `checkAndFreeze`, after successful freeze (`await rename(currentFile, frozenPath);`):

```typescript
      logo.info('Freeze completed', { file: frozenPath, tokens, messages: messages.length });
```

Before `freezeLocks.set(threadDir, ...)` — this is the lock acquisition point:

```typescript
    logo.debug('Freeze lock acquired', { threadDir });
```

In `checkAndSummarize`, after `await writeFile(summaryPath, summary, 'utf-8');`:

```typescript
  logo.info('Summarize completed', { source: oldestFile, output: summaryPath, summary_len: summary.length });
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/storage/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/storage/tokens.ts src/storage/summary.ts
git commit -m "feat(storage): add logo logging for encoder init, freeze, summarize"
```

---

### Task 5: Memory client logging

**Files:**
- Modify: `src/memory/lmd-client.ts`

- [ ] **Step 1: Add logging to lmd-client.ts**

Add import: `import { logo } from '../lib/logo.js';`

In `callWithRetry`, inside catch block before `await new Promise`:

```typescript
          logo.warn('MCP call retry', { method, attempt: attempt + 1, delay_ms: delays[attempt] });
```

In `call`, before `return await fetch`:

```typescript
    logo.debug('MCP call', { method, id: body.id });
```

After success, before `return textContent ? ...`:

```typescript
    logo.debug('MCP response', { method, status: resp.status });
```

In `queryMemory`, after successful call:

```typescript
      logo.info('Memory query', { query_len: params.query.length, hits: results.length });
```

In `queryMemory` catch (the graceful degradation):

```typescript
      logo.warn('Memory query failed, returning empty', { query_len: params.query.length });
```

In `addMemory`, after successful call:

```typescript
    logo.info('Memory add', { type: params.type, content_len: params.content.length, id: result.id });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/memory/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/memory/lmd-client.ts
git commit -m "feat(memory): add logo logging for MCP calls, retries, query/add"
```

---

### Task 6: Reflect system logging

**Files:**
- Modify: `src/reflect/runner.ts`
- Modify: `src/reflect/scheduler.ts`

- [ ] **Step 1: Replace console.* in runner.ts**

Add import: `import { logo } from '../lib/logo.js';`

Replace `console.error(`[reflect] module ${mod.name} error:`, err)`:
```typescript
          logo.error('Reflect module error', { module: mod.name, error: String(err) });
```

Replace `console.log(`[reflect] task: ${task}`)`:
```typescript
          logo.info('Reflect task', { task });
```

Replace `console.error('[reflect] task error:', err)`:
```typescript
          logo.error('Reflect task error', { error: String(err) });
```

- [ ] **Step 2: Add logging to scheduler.ts**

Add import: `import { logo } from '../lib/logo.js';`

After `tasks.push(job.task);`:

```typescript
            logo.info('Cron job fired', { task: job.task, expression: job.expression });
```

Inside catch for invalid cron expression:

```typescript
          logo.warn('Invalid cron expression', { expression: job.expression, task: job.task });
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/reflect/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/reflect/runner.ts src/reflect/scheduler.ts
git commit -m "feat(reflect): add logo logging — replace console.*, log cron fires"
```

---

### Task 7: CLI and Skills logging

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/skill-sop/loader.ts`

- [ ] **Step 1: Replace console.* in cli/index.ts**

Add import: `import { logo } from '../lib/logo.js';`

Replace `console.log(`[reflect] executing: ${task}`)`:
```typescript
      (task) => logo.info('Reflect executing', { task }),
```

Replace `console.log('Reflect started. Press Ctrl+C to stop.')`:
```typescript
    logo.info('Reflect started');
```

Replace `console.log('Reflect status: checking...')`:
```typescript
    logo.info('Reflect status: checking...');
```

Replace `console.log(`Added memory: ${result.id}`)`:
```typescript
    logo.info('Memory added', { id: result.id });
```

Replace the memory search loop:
```typescript
    logo.info('Memory search results', { count: results.length });
    for (const r of results) {
      console.log(`[${r.type}] (${r.score.toFixed(2)}) ${r.content}`);
    }
```

Note: the `console.log` in memory search output is user-facing output (not a log), so keep it as-is. But add a logo.info before it.

Also add startup log in the `chat` command action, before `await startChat`:

```typescript
    logo.info('pc2 chat starting');
```

And in `reflect start`, add `logo.init({ console: true });` at start of the action.

- [ ] **Step 2: Add logging to loader.ts**

Add import: `import { logo } from '../lib/logo.js';`

In `scanSkillDirectory`, after `skills.push({ ...parsed, filePath: skillPath });`:

```typescript
      logo.debug('Skill loaded', { name: parsed.name, path: skillPath, evolvable: parsed.evolvable });
```

In the catch after `parseSkillFrontmatter` fails:

```typescript
      logo.warn('Skill load failed', { path: skillPath });
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts src/skill-sop/loader.ts
git commit -m "feat(cli,skills): add logo logging — replace console.*, log skill loading"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Verify no console.* remains in src/**

Run: `rg 'console\.(log|warn|error)' src/ --no-heading`
Expected: Only `process.stderr.write` in logo.ts (the console output path). All other `console.*` calls should be replaced.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: logo integration cleanup"
```
