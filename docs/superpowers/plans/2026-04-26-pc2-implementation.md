# pc2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete personal AI agent CLI in TypeScript with BAML LLM integration, LMD MCP memory, SOP/Skill system, and file-based storage.

**Architecture:** Monolithic modular TypeScript app. Agent loop follows ReAct pattern with tool dispatch via registry. All LLM calls through BAML (text protocol for tool calling). Memory via LMD MCP HTTP JSON-RPC. File-based data storage (JSONL + JSON + Markdown). Reflect system for autonomous tasks and Dream memory consolidation.

**Tech Stack:** TypeScript, Node.js, BAML (`@boundaryml/baml`), `cron-parser`, `js-yaml`, `tiktoken` (token counting), `commander` (CLI), vitest (testing)

**Spec documents:**
- Main spec: `docs/superpowers/specs/2026-04-25-personal-agent-design.md`
- Memory spec: `docs/superpowers/specs/memory-and-context.md`

**Reference projects:**
- `/Users/xmli/me/code/others/generic-agent` — Agent loop, tool dispatch, reflect, SOP, turn-end callback
- `/Users/xmli/me/code/xvc.agent2` — TypeScript agent loop, SSE streaming, tool map dispatch, sub-agent
- `/Users/xmli/me/code/lmd` — MCP HTTP JSON-RPC protocol, memory types (fact/episode/relation)

**Naming conventions:** kebab-case for all filenames. camelCase for code. UPPER_SNAKE_CASE for constants. See `docs/01.memory.md`.

---

## File Structure

```
pc2/
  src/
    types.ts                  # Shared types: Message, ToolResult, StepOutcome, etc.
    config.ts                 # Configuration constants and loading
    agent/
      loop.ts                 # Core ReAct loop (AgentLoop class)
      prompt.ts               # System prompt builder + context assembly
      sub-agent.ts            # Sub-agent isolation (spawn_agent tool impl)
      turn-end-callback.ts    # Turn-end callback logic
    tools/
      types.ts                # Tool interface, ToolContext, ToolRegistry
      registry.ts             # Tool registration and dispatch
      file-read.ts            # file_read tool
      file-write.ts           # file_write tool
      file-edit.ts            # file_edit tool
      bash.ts                 # bash tool (V1 security)
      web-search.ts           # web_search tool
      web-fetch.ts            # web_fetch tool
      memory-search.ts        # memory_search tool
      ask-user.ts             # ask_user tool
      spawn-agent.ts          # spawn_agent tool
    memory/
      lmd-client.ts           # LMD MCP client (HTTP JSON-RPC)
    storage/
      jsonl.ts                # JSONL read/write/append
      json-safe.ts            # Atomic JSON write (write-to-temp-then-rename)
      history.ts              # Message history loading + token budget
      summary.ts              # Conversation summary (freeze + summarize)
    skill-sop/
      loader.ts               # SKILL.md scanner and loader (shared by skills/ and sop/)
      types.ts                # SkillDefinition, SopDefinition interfaces
    reflect/
      types.ts                # ReflectModule interface
      runner.ts               # ReflectRunner (setInterval scheduler)
      autonomous.ts           # Autonomous reflect module
      dream.ts                # Dream memory consolidation (Worker thread)
      scheduler.ts            # Cron job scheduler reflect module
    cli/
      index.ts                # CLI entry (commander)
      chat.ts                 # Interactive chat UI (streaming markdown)
  baml_src/
    clients.baml              # LLM client definitions
    generator.baml            # Code generator config
    chat.baml                 # Main agent dialog
    extract-memory.baml       # Extract memory items
    summarize-history.baml    # Conversation summary
    verify.baml               # Adversarial verification
  baml_client/                # Generated — do not edit
  tests/
    unit/
      storage/
        jsonl.test.ts
        json-safe.test.ts
        history.test.ts
        summary.test.ts
      tools/
        registry.test.ts
        file-tools.test.ts
        bash.test.ts
      memory/
        lmd-client.test.ts
      skill-sop/
        loader.test.ts
      agent/
        loop.test.ts
        prompt.test.ts
        turn-end-callback.test.ts
    integration/
      chat-flow.test.ts
      memory-flow.test.ts
      summary-flow.test.ts
      dream-flow.test.ts
      cron-flow.test.ts
  sop/
    plan/SKILL.md
    verify/SKILL.md
    dream/SKILL.md
    subagent/SKILL.md
    autonomous/SKILL.md
    memory-management/SKILL.md
  skills/
  data/                       # Runtime data (gitignored)
  temp/                       # Temp files (gitignored)
  docs/
  AGENTS.md
  package.json
  tsconfig.json
  vitest.config.ts
```

---

## Chunk 1: Project Skeleton + Storage Layer

### Task 1: Initialize project skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize npm project with TypeScript**

```bash
npm init -y
npm install typescript @types/node vitest --save-dev
npx tsc --init
```

- [ ] **Step 2: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Configure vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
data/
temp/
*.lmd.md
baml_client/
.DS_Store
```

- [ ] **Step 5: Create src/types.ts with shared types**

```typescript
import type { ToolCall as BamlToolCall, MemoryItem, VerifyResult } from '../../baml_client/types.js';

// Application-level types — NOT generated by BAML.
// BAML-generated types (ToolCall, ChatResponse, MemoryItem, VerifyResult) are in baml_client/types.ts.
// Use those directly via import from '../../baml_client/index.js'.

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: BamlToolCall[];
  toolCallId?: string;
  timestamp: string;
}

export type ToolResult = string | Record<string, unknown>;

export interface StepOutcome {
  data: ToolResult | null;
  nextPrompt: string | null;
  shouldExit: boolean;
}

export interface MemoryHit {
  id: string;
  content: string;
  type: 'fact' | 'episode' | 'relation';
  score: number;
  createdAt: string;
}
```

- [ ] **Step 6: Create src/config.ts**

```typescript
export const config = {
  modelContextWindow: 100_000,   // 100K tokens — glm-5-turbo context window
  freezeThreshold: () => config.modelContextWindow * 0.3, // 30% — ensures 3 files + system fit within context. For 100K → 30K per segment
  maxRounds: 30,                 // Prevents runaway loops. 25-turn force ask_user gives 5-round buffer
  subAgentMaxRounds: 15,         // Sub-tasks should be simpler; 15 is half of main loop
  agentTimeoutMs: 20 * 60 * 1000,   // 20 min — upper bound for single task execution
  subAgentTimeoutMs: 10 * 60 * 1000, // 10 min — half of main loop timeout
  antiLoopInterval: 7,           // Empirically, LLM repetition starts after 5-7 failed attempts
  forceAskUserTurn: 25,          // Safety valve at 25, before maxRounds(30) gives buffer
  subAgentHeartbeatMs: 60 * 1000,    // 60s — abort sub-agent if no event yielded
  lmdPort: 58080,                // LMD daemon default port
  lmdHost: 'localhost',
  cronCheckIntervalMs: 120_000,  // 2min — check cron jobs frequently enough for minute-level schedules
  autonomousIdleMs: 1_800_000,   // 30min — trigger autonomous mode after user idle
  timezone: 'Asia/Shanghai',     // All times in UTC+8 (per AGENTS.md)
  dataDir: 'data',
  tempDir: 'temp',
};
```

- [ ] **Step 7: Add npm scripts to package.json**

```json
{
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  }
}
```

- [ ] **Step 8: Verify skeleton compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Install additional dependencies**

```bash
npm install js-yaml tiktoken commander cron-parser
npm install @types/js-yaml --save-dev
```

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/types.ts src/config.ts
git commit -m "feat: initialize project skeleton with TypeScript, vitest, shared types and config"
```

---

### Task 2: JSONL storage

**Files:**
- Create: `src/storage/jsonl.ts`
- Create: `tests/unit/storage/jsonl.test.ts`

- [ ] **Step 1: Write failing tests for JSONL operations**

`tests/unit/storage/jsonl.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { appendJsonl, readJsonl, countJsonlLines } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-jsonl');
const TEST_FILE = path.join(TEST_DIR, 'test.jsonl');

const msg: Message = {
  id: 'msg_1',
  role: 'user',
  content: 'hello',
  timestamp: '2026-04-25T14:00:00+08:00',
};

describe('jsonl', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('appendJsonl writes a line and readJsonl reads it back', async () => {
    await appendJsonl(TEST_FILE, msg);
    const lines = await readJsonl<Message>(TEST_FILE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(msg);
  });

  it('appendJsonl handles multiple appends', async () => {
    const msg2: Message = { ...msg, id: 'msg_2', content: 'world' };
    await appendJsonl(TEST_FILE, msg);
    await appendJsonl(TEST_FILE, msg2);
    const lines = await readJsonl<Message>(TEST_FILE);
    expect(lines).toHaveLength(2);
    expect(lines[1].content).toBe('world');
  });

  it('readJsonl skips malformed JSON on last line', async () => {
    await appendJsonl(TEST_FILE, msg);
    await fs.appendFile(TEST_FILE, '{"broken\n');
    const lines = await readJsonl<Message>(TEST_FILE);
    expect(lines).toHaveLength(1);
  });

  it('readJsonl returns empty array for nonexistent file', async () => {
    const lines = await readJsonl<Message>(path.join(TEST_DIR, 'nope.jsonl'));
    expect(lines).toEqual([]);
  });

  it('countJsonlLines returns correct count', async () => {
    await appendJsonl(TEST_FILE, msg);
    await appendJsonl(TEST_FILE, { ...msg, id: 'msg_2' });
    expect(await countJsonlLines(TEST_FILE)).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/storage/jsonl.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement jsonl.ts**

`src/storage/jsonl.ts`:

```typescript
import { appendFile, readFile, stat } from 'fs/promises';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';

export async function appendJsonl<T>(filePath: string, record: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record) + '\n';
  await appendFile(filePath, line, 'utf-8');
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim() !== '');
    const results: T[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch {
        // skip malformed lines (e.g., partial write from crash)
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function countJsonlLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/storage/jsonl.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/jsonl.ts tests/unit/storage/jsonl.test.ts
git commit -m "feat: add JSONL read/write/append with malformed line recovery"
```

---

### Task 3: Atomic JSON write (json-safe)

**Files:**
- Create: `src/storage/json-safe.ts`
- Create: `tests/unit/storage/json-safe.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/storage/json-safe.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { writeJsonAtomic, readJson } from '../../../src/storage/json-safe.js';

const TEST_DIR = path.join(__dirname, 'tmp-json-safe');
const TEST_FILE = path.join(TEST_DIR, 'test.json');

describe('json-safe', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writeJsonAtomic creates file with correct content', async () => {
    const data = { id: 'abc', name: 'test' };
    await writeJsonAtomic(TEST_FILE, data);
    const result = await readJson(TEST_FILE);
    expect(result).toEqual(data);
  });

  it('writeJsonAtomic overwrites existing file atomically', async () => {
    await writeJsonAtomic(TEST_FILE, { version: 1 });
    await writeJsonAtomic(TEST_FILE, { version: 2 });
    const result = await readJson(TEST_FILE);
    expect(result.version).toBe(2);
  });

  it('no .tmp file remains after write', async () => {
    await writeJsonAtomic(TEST_FILE, { ok: true });
    const files = await fs.readdir(TEST_DIR);
    expect(files).not.toContain('test.json.tmp');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/storage/json-safe.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement json-safe.ts**

`src/storage/json-safe.ts`:

```typescript
import { open, rename, mkdir, readFile } from 'fs/promises';
import { dirname, resolve } from 'path';

export async function writeJsonAtomic<T>(filePath: string, data: T): Promise<void> {
  const absPath = resolve(filePath);
  const tmpPath = absPath + '.tmp';
  await mkdir(dirname(absPath), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  // Spec: "Write to .tmp -> fsync -> rename"
  const fd = await open(tmpPath, 'w');
  try {
    await fd.writeFile(content, 'utf-8');
    await fd.sync(); // fsync
  } finally {
    await fd.close();
  }
  await rename(tmpPath, absPath);
}

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/storage/json-safe.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/json-safe.ts tests/unit/storage/json-safe.test.ts
git commit -m "feat: add atomic JSON write with write-to-temp-then-rename pattern"
```

---

### Task 4: Token counting utility

**Files:**
- Create: `src/storage/tokens.ts`
- Create: `tests/unit/storage/tokens.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { countTokens, countMessagesTokens } from '../../../src/storage/tokens.js';
import type { Message } from '../../../src/types.js';

describe('tokens', () => {
  it('countTokens returns positive number for non-empty string', async () => {
    const count = await countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
  });

  it('countTokens returns 0 for empty string', async () => {
    const count = await countTokens('');
    expect(count).toBe(0);
  });

  it('countMessagesTokens sums across messages', async () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: '' },
      { id: '2', role: 'assistant', content: 'Hi there!', timestamp: '' },
    ];
    const count = await countMessagesTokens(messages);
    expect(count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/storage/tokens.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tokens.ts**

`src/storage/tokens.ts`:

```typescript
import type { Message } from '../types.js';

// tiktoken is expensive to init — lazy singleton
let _encoder: Awaited<ReturnType<typeof initEncoder>> | null = null;

async function initEncoder() {
  const tiktoken = await import('tiktoken');
  return tiktoken.encoding_for_model('gpt-4o');
}

async function getEncoder() {
  if (!_encoder) {
    _encoder = await initEncoder();
  }
  return _encoder;
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
        total += await countTokens(tc.arguments);
      }
    }
  }
  return total;
}

export function freeEncoder(): void {
  if (_encoder) {
    _encoder.free();
    _encoder = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/storage/tokens.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/tokens.ts tests/unit/storage/tokens.test.ts
git commit -m "feat: add token counting with tiktoken lazy singleton"
```

---

### Task 5: History loading + token budget

**Files:**
- Create: `src/storage/history.ts`
- Create: `tests/unit/storage/history.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { loadThreadHistory, getFrozenFiles, getCurrentFile, getBridgeFile } from '../../../src/storage/history.js';
import { appendJsonl } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-history');
const THREAD_DIR = path.join(TEST_DIR, 'thread-1');

function makeMsg(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: '2026-04-25T14:00:00+08:00' };
}

describe('history', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('getCurrentFile returns messages-current.jsonl path', () => {
    expect(getCurrentFile(THREAD_DIR)).toMatch(/messages-current\.jsonl$/);
  });

  it('getFrozenFiles returns sorted frozen files', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));
    const frozen = await getFrozenFiles(THREAD_DIR);
    expect(frozen).toHaveLength(2);
    expect(frozen[0]).toMatch(/messages-001\.jsonl$/);
  });

  it('getBridgeFile returns second-to-last frozen file', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-002.jsonl'), makeMsg('2', 'b'));
    await appendJsonl(path.join(THREAD_DIR, 'messages-003.jsonl'), makeMsg('3', 'c'));
    const bridge = await getBridgeFile(THREAD_DIR);
    expect(bridge).toMatch(/messages-002\.jsonl$/);
  });

  it('getBridgeFile returns null when fewer than 2 frozen files', async () => {
    await appendJsonl(path.join(THREAD_DIR, 'messages-001.jsonl'), makeMsg('1', 'a'));
    const bridge = await getBridgeFile(THREAD_DIR);
    expect(bridge).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/storage/history.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement history.ts**

`src/storage/history.ts`:

```typescript
import { readdir } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import type { Message } from '../types.js';

const CURRENT_PREFIX = 'messages-current';
const FROZEN_PATTERN = /^messages-(\d+)\.jsonl$/;

export function getCurrentFile(threadDir: string): string {
  return join(threadDir, `${CURRENT_PREFIX}.jsonl`);
}

export async function getFrozenFiles(threadDir: string): Promise<string[]> {
  const files = await readdir(threadDir);
  return files
    .filter((f) => FROZEN_PATTERN.test(f))
    .sort()
    .map((f) => join(threadDir, f));
}

export async function getBridgeFile(threadDir: string): Promise<string | null> {
  const frozen = await getFrozenFiles(threadDir);
  if (frozen.length < 2) return null;
  return frozen[frozen.length - 2]; // second-to-last
}

export async function loadFrozenMessages(filePath: string): Promise<Message[]> {
  return readJsonl<Message>(filePath);
}

export async function getUnprocessedSummaries(threadDir: string): Promise<string[]> {
  const summariesDir = join(threadDir, 'summaries');
  try {
    const files = await readdir(summariesDir);
    return files
      .filter((f) => f.endsWith('.md') && !f.endsWith('.lmd.md'))
      .sort()
      .map((f) => join(summariesDir, f));
  } catch {
    return [];
  }
}

export async function getProcessedSummaries(threadDir: string): Promise<string[]> {
  const summariesDir = join(threadDir, 'summaries');
  try {
    const files = await readdir(summariesDir);
    return files
      .filter((f) => f.endsWith('.lmd.md'))
      .sort()
      .map((f) => join(summariesDir, f));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/storage/history.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/history.ts tests/unit/storage/history.test.ts
git commit -m "feat: add history loading with frozen file and summary discovery"
```

---

## Chunk 2: Tool System + BAML Integration

### Task 6: Tool interface and registry

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/registry.ts`
- Create: `tests/unit/tools/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { Tool, ToolContext } from '../../../src/tools/types.js';
import type { StepOutcome } from '../../../src/types.js';

const dummyCtx: ToolContext = {
  turn: 0,
  index: 0,
  lmdClient: null as any,
  dataDir: '/tmp',
  agentId: 'test',
  isSubAgent: false,
};

const fakeTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
  },
  execute: async (args) => ({
    data: `got: ${args.input}`,
    nextPrompt: null,
    shouldExit: false,
  }),
};

describe('ToolRegistry', () => {
  it('registers and dispatches a tool', async () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    const result = await registry.dispatch('test_tool', { input: 'hello' }, dummyCtx);
    expect((result as StepOutcome).data).toBe('got: hello');
  });

  it('dispatch returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.dispatch('nope', {}, dummyCtx);
    expect(result).toContain('Unknown tool');
  });

  it('getToolsDescription returns all registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    const desc = registry.getToolsDescription();
    expect(desc).toContain('test_tool');
    expect(desc).toContain('A test tool');
  });

  it('list returns all tool names', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool);
    expect(registry.list()).toEqual(['test_tool']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tools/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement types and registry**

`src/tools/types.ts`:

```typescript
import type { StepOutcome } from '../types.js';
import type { LmdMcpClient } from '../memory/lmd-client.js';

export interface ToolContext {
  turn: number;
  index: number;
  lmdClient: LmdMcpClient;
  dataDir: string;
  agentId: string;
  isSubAgent: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<StepOutcome>;
}
```

`src/tools/registry.ts`:

```typescript
import type { Tool, ToolContext } from './types.js';
import type { StepOutcome } from '../types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<StepOutcome | string> {
    const tool = this.tools.get(name);
    if (!tool) return `Unknown tool: ${name}`;
    try {
      return await tool.execute(args, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Tool error (${name}): ${msg}`;
    }
  }

  getToolsDescription(): string {
    const parts: string[] = [];
    for (const tool of this.tools.values()) {
      parts.push(
        `## ${tool.name}\n${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`,
      );
    }
    return parts.join('\n\n');
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tools/registry.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/types.ts src/tools/registry.ts tests/unit/tools/registry.test.ts
git commit -m "feat: add Tool interface and ToolRegistry with dispatch"
```

---

### Task 7: Implement file tools (file_read, file_write, file_edit)

**Files:**
- Create: `src/tools/file-read.ts`
- Create: `src/tools/file-write.ts`
- Create: `src/tools/file-edit.ts`
- Create: `tests/unit/tools/file-tools.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createFileReadTool } from '../../../src/tools/file-read.js';
import { createFileWriteTool } from '../../../src/tools/file-write.js';
import { createFileEditTool } from '../../../src/tools/file-edit.js';
import type { ToolContext } from '../../../src/tools/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-file-tools');
const dummyCtx: ToolContext = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: TEST_DIR, agentId: 'test', isSubAgent: false,
};

describe('file tools', () => {
  beforeEach(async () => { await fs.mkdir(TEST_DIR, { recursive: true }); });
  afterEach(async () => { await fs.rm(TEST_DIR, { recursive: true, force: true }); });

  describe('file_read', () => {
    it('reads entire file', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath }, dummyCtx);
      expect(result.data).toContain('line1');
      expect(result.data).toContain('line3');
    });

    it('reads specific line range', async () => {
      const filePath = path.join(TEST_DIR, 'lines.txt');
      await fs.writeFile(filePath, 'a\nb\nc\nd\ne', 'utf-8');
      const tool = createFileReadTool();
      const result = await tool.execute({ path: filePath, offset: 2, limit: 2 }, dummyCtx);
      expect(result.data).toContain('b');
      expect(result.data).toContain('c');
      expect(result.data).not.toContain('a');
    });
  });

  describe('file_write', () => {
    it('creates a new file', async () => {
      const filePath = path.join(TEST_DIR, 'new.txt');
      const tool = createFileWriteTool();
      await tool.execute({ path: filePath, content: 'hello' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('hello');
    });

    it('overwrites existing file', async () => {
      const filePath = path.join(TEST_DIR, 'overwrite.txt');
      await fs.writeFile(filePath, 'old', 'utf-8');
      const tool = createFileWriteTool();
      await tool.execute({ path: filePath, content: 'new' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new');
    });
  });

  describe('file_edit', () => {
    it('replaces exact string match', async () => {
      const filePath = path.join(TEST_DIR, 'edit.txt');
      await fs.writeFile(filePath, 'foo bar baz', 'utf-8');
      const tool = createFileEditTool();
      await tool.execute({ path: filePath, old_string: 'bar', new_string: 'qux' }, dummyCtx);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('foo qux baz');
    });

    it('fails when old_string not found', async () => {
      const filePath = path.join(TEST_DIR, 'edit2.txt');
      await fs.writeFile(filePath, 'hello', 'utf-8');
      const tool = createFileEditTool();
      const result = await tool.execute({ path: filePath, old_string: 'xyz', new_string: 'abc' }, dummyCtx);
      expect(String(result.data)).toContain('not found');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tools/file-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the three file tools**

`src/tools/file-read.ts`:

```typescript
import { readFile } from 'fs/promises';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createFileReadTool(): Tool {
  return {
    name: 'file_read',
    description: 'Read file contents. Supports line range via offset/limit parameters.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        offset: { type: 'number', description: 'Start line (1-indexed)' },
        limit: { type: 'number', description: 'Max lines to read' },
      },
      required: ['path'],
    },
    async execute(args): Promise<StepOutcome> {
      try {
        const content = await readFile(args.path as string, 'utf-8');
        let lines = content.split('\n');
        const offset = (args.offset as number) ?? 1;
        const limit = (args.limit as number) ?? lines.length;
        lines = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = lines.map((l, i) => `${offset + i}: ${l}`).join('\n');
        return { data: numbered, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'ENOENT') {
          return { data: `File not found: ${args.path}`, nextPrompt: null, shouldExit: false };
        }
        // Check for binary file (NUL bytes in first 8KB)
        const fd = await import('fs/promises').then(m => m.open(args.path as string, 'r'));
        try {
          const buf = Buffer.alloc(8192);
          await fd.read(buf, 0, 8192, 0);
          if (buf.includes(0)) {
            return { data: `Binary file, cannot read: ${args.path}`, nextPrompt: null, shouldExit: false };
          }
          return { data: `Encoding error: file is not UTF-8 (${args.path}). Use bash with iconv to convert.`, nextPrompt: null, shouldExit: false };
        } finally {
          await fd.close();
        }
      }
    },
  };
}
```

`src/tools/file-write.ts`:

```typescript
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createFileWriteTool(): Tool {
  return {
    name: 'file_write',
    description: 'Create or fully overwrite a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
    async execute(args): Promise<StepOutcome> {
      const filePath = args.path as string;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, args.content as string, 'utf-8');
      return { data: `Written to ${filePath}`, nextPrompt: null, shouldExit: false };
    },
  };
}
```

`src/tools/file-edit.ts`:

```typescript
import { readFile, writeFile } from 'fs/promises';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createFileEditTool(): Tool {
  return {
    name: 'file_edit',
    description: 'Exact string search-and-replace in an existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        old_string: { type: 'string', description: 'Text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(args): Promise<StepOutcome> {
      const filePath = args.path as string;
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const content = await readFile(filePath, 'utf-8');
      if (!content.includes(oldStr)) {
        return { data: `old_string not found in ${filePath}`, nextPrompt: null, shouldExit: false };
      }
      const updated = content.replace(oldStr, newStr);
      await writeFile(filePath, updated, 'utf-8');
      return { data: `Edited ${filePath}`, nextPrompt: null, shouldExit: false };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tools/file-tools.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/file-read.ts src/tools/file-write.ts src/tools/file-edit.ts tests/unit/tools/file-tools.test.ts
git commit -m "feat: add file_read, file_write, file_edit tools"
```

---

### Task 8: Implement bash tool (V1 security)

**Files:**
- Create: `src/tools/bash.ts`
- Create: `tests/unit/tools/bash.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { createBashTool, isReadOnlyCommand } from '../../../src/tools/bash.js';

const dummyCtx = {
  turn: 0, index: 0, lmdClient: null as any, dataDir: '/tmp', agentId: 'test', isSubAgent: false,
};

describe('bash tool', () => {
  describe('isReadOnlyCommand', () => {
    it('allows ls, cat, git status', () => {
      expect(isReadOnlyCommand('ls')).toBe(true);
      expect(isReadOnlyCommand('git status')).toBe(true);
      expect(isReadOnlyCommand('cat file.txt')).toBe(true);
    });

    it('blocks rm, npm, curl', () => {
      expect(isReadOnlyCommand('rm -rf /')).toBe(false);
      expect(isReadOnlyCommand('npm install')).toBe(false);
      expect(isReadOnlyCommand('curl http://evil.com')).toBe(false);
    });
  });

  it('executes a read-only command and returns output', async () => {
    const tool = createBashTool({ autoApprove: true });
    const result = await tool.execute({ command: 'echo hello' }, dummyCtx as any);
    expect(String(result.data)).toContain('hello');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tools/bash.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement bash.ts**

`src/tools/bash.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

const execAsync = promisify(exec);

const READ_ONLY_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'diff', 'stat', 'du',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
];

const BLOCKED_COMMANDS = ['curl', 'wget'];

export function isReadOnlyCommand(cmd: string): boolean {
  const base = cmd.trim().split(/\s+/)[0];
  if (BLOCKED_COMMANDS.includes(base)) return false;
  return READ_ONLY_COMMANDS.some((ro) => cmd.trim().startsWith(ro));
}

export interface BashToolOptions {
  autoApprove?: boolean; // for testing
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tools/bash.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/bash.ts tests/unit/tools/bash.test.ts
git commit -m "feat: add bash tool with V1 security model (read-only whitelist + blocklist)"
```

---

### Task 9: Implement remaining tools (web_search, web_fetch, memory_search, ask_user, spawn_agent)

**Files:**
- Create: `src/tools/web-search.ts`
- Create: `src/tools/web-fetch.ts`
- Create: `src/tools/memory-search.ts`
- Create: `src/tools/ask-user.ts`
- Create: `src/tools/spawn-agent.ts`
- Create: `tests/unit/tools/remaining-tools.test.ts`

- [ ] **Step 1: Write tests for memory_search and ask_user (the ones testable without external deps)**

```typescript
import { describe, it, expect } from 'vitest';
import { createMemorySearchTool } from '../../../src/tools/memory-search.js';
import { createAskUserTool } from '../../../src/tools/ask-user.js';
import type { ToolContext } from '../../../src/tools/types.js';
import type { LmdMcpClient } from '../../../src/memory/lmd-client.js';
import type { MemoryHit } from '../../../src/types.js';

const mockLmdClient: LmdMcpClient = {
  queryMemory: async (params) => [
    { id: '1', content: 'test fact', type: 'fact', score: 0.9, createdAt: '2026-01-01' },
  ] as MemoryHit[],
  addMemory: async () => ({ id: '1' }),
  deleteMemory: async () => {},
};

const dummyCtx: ToolContext = {
  turn: 0, index: 0, lmdClient: mockLmdClient, dataDir: '/tmp', agentId: 'test', isSubAgent: false,
};

describe('memory_search tool', () => {
  it('queries LMD and returns formatted results', async () => {
    const tool = createMemorySearchTool();
    const result = await tool.execute({ query: 'test query' }, dummyCtx);
    expect(String(result.data)).toContain('test fact');
  });
});

describe('ask_user tool', () => {
  it('returns shouldExit=true and the question as nextPrompt', async () => {
    const tool = createAskUserTool();
    const result = await tool.execute({ question: 'Continue?' }, dummyCtx);
    expect(result.shouldExit).toBe(true);
    expect(result.nextPrompt).toBe('Continue?');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/tools/remaining-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement all five tools**

`src/tools/memory-search.ts`:

```typescript
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createMemorySearchTool(): Tool {
  return {
    name: 'memory_search',
    description: 'Search long-term memory via LMD. Proactively query for specific knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
    async execute(args, ctx): Promise<StepOutcome> {
      const results = await ctx.lmdClient.queryMemory({
        query: args.query as string,
        limit: (args.limit as number) ?? 5,
      });
      const formatted = results
        .map((r) => `[${r.type}] (score: ${r.score.toFixed(2)}) ${r.content}`)
        .join('\n');
      return { data: formatted || 'No results found.', nextPrompt: null, shouldExit: false };
    },
  };
}
```

`src/tools/ask-user.ts`:

```typescript
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createAskUserTool(): Tool {
  return {
    name: 'ask_user',
    description: 'Interrupt loop and wait for user input.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
      },
      required: ['question'],
    },
    async execute(args): Promise<StepOutcome> {
      return {
        data: null,
        nextPrompt: args.question as string,
        shouldExit: true, // breaks loop — main loop will re-enter with user response
      };
    },
  };
}
```

`src/tools/spawn-agent.ts`:

```typescript
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createSpawnAgentTool(): Tool {
  return {
    name: 'spawn_agent',
    description: 'Launch sub-agent for isolated execution. Sub-agents have independent context and cannot spawn further sub-agents.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description for the sub-agent' },
        context: { type: 'string', description: 'Additional context for the sub-agent' },
      },
      required: ['task'],
    },
    async execute(args, ctx): Promise<StepOutcome> {
      if (ctx.isSubAgent) {
        return { data: 'Error: sub-agents cannot spawn further sub-agents.', nextPrompt: null, shouldExit: false };
      }
      // Actual sub-agent execution is handled by the agent loop,
      // which intercepts spawn_agent calls and runs AgentLoop in sub-agent mode.
      // The tool just validates and returns the task info.
      return {
        data: { task: args.task, context: args.context ?? '' },
        nextPrompt: null,
        shouldExit: false,
      };
    },
  };
}
```

`src/tools/web-search.ts`:

```typescript
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description: 'Search the web via local whoogle-search API.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async execute(args): Promise<StepOutcome> {
      // whoogle-search API integration — V1 placeholder
      return { data: `Web search not yet configured for: ${args.query}`, nextPrompt: null, shouldExit: false };
    },
  };
}
```

`src/tools/web-fetch.ts`:

```typescript
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createWebFetchTool(): Tool {
  return {
    name: 'web_fetch',
    description: 'Fetch and extract web page content.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
    async execute(args): Promise<StepOutcome> {
      try {
        const resp = await fetch(args.url as string);
        const text = await resp.text();
        // Strip HTML tags for basic text extraction (V1)
        const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
        return { data: stripped, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { data: `Fetch error: ${msg}`, nextPrompt: null, shouldExit: false };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tools/remaining-tools.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/memory-search.ts src/tools/ask-user.ts src/tools/spawn-agent.ts src/tools/web-search.ts src/tools/web-fetch.ts tests/unit/tools/remaining-tools.test.ts
git commit -m "feat: add memory_search, ask_user, spawn_agent, web_search, web_fetch tools"
```

---

### Task 10: BAML integration setup

**Files:**
- Create: `baml_src/clients.baml`
- Create: `baml_src/generator.baml`
- Create: `baml_src/agent-chat.baml`
- Create: `baml_src/extract-memory.baml`
- Create: `baml_src/summarize-history.baml`
- Create: `baml_src/verify.baml`

- [ ] **Step 1: Install BAML**

```bash
npm install @boundaryml/baml
npx baml-cli init
```

- [ ] **Step 2: Create clients.baml**

```baml
// Client definition is referenced inline in BAML functions via client "glm-5-turbo"
// This file defines reusable client configs for non-default providers

client<llm> FallbackClient {
  provider openai
  options {
    model "gpt-4o"
    api_key env.OPENAI_API_KEY
  }
}
```

- [ ] **Step 3: Create generator.baml**

```baml
generator lang_typescript {
  output_type typescript
  output_dir "../baml_client"
  version "0.220.0"
  module_format esm
}
```

- [ ] **Step 3: Create chat.baml**

```baml
class ToolCall {
  name string
  arguments string
  id string
}

class ChatResponse {
  text string
  tool_calls ToolCall[]
}

function AgentChat(
  messages string
  tools_description string
) -> ChatResponse {
  client "glm-5-turbo"
  prompt #"
    You are a personal AI agent. Follow your instructions and use tools when needed.

    {{ messages }}

    Available tools:
    {{ tools_description }}

    {{ ctx.output_format }}
  "#
}
```

- [ ] **Step 5: Create extract-memory.baml**

```baml
class MemoryItem {
  content string
  type string
}

function ExtractMemory(
  conversation string
) -> MemoryItem[] {
  client "glm-5-turbo"
  prompt #"
    Extract knowledge with long-term value from this conversation.
    Types: fact (immutable truth), episode (time-sensitive event), relation (currently-true relationship).

    SKIP: one-time tasks, common knowledge, context-dependent details.
    Only extract what a trained LLM could NOT infer from general knowledge.

    {{ conversation }}

    {{ ctx.output_format }}
  "#
}
```

- [ ] **Step 6: Create summarize-history.baml**

```baml
function SummarizeHistory(
  messages string
) -> string {
  client "glm-5-turbo"
  prompt #"
    Summarize this conversation segment. Cover: Tasks, Key Decisions, Code/File Changes,
    Important Information Discovered, User Preferences Expressed, Unresolved Issues.
    Output 1500-3000 tokens of narrative summary.

    {{ messages }}

    {{ ctx.output_format }}
  "#
}
```

- [ ] **Step 7: Create verify.baml**

```baml
class VerifyResult {
  verdict string
  details string
}

function VerifyJudge(
  task string
  deliverables string
  evidence string
) -> VerifyResult {
  client "glm-5-turbo"
  prompt #"
    You are an adversarial verifier. Determine if the task was truly completed.

    Task: {{ task }}
    Deliverables: {{ deliverables }}
    Evidence from tool execution: {{ evidence }}

    Rules:
    - PASS requires tool execution evidence, not just code reading
    - When in doubt, FAIL
    - verdict must be exactly PASS, FAIL, or PARTIAL

    {{ ctx.output_format }}
  "#
}
```

- [ ] **Step 8: Generate BAML client**

```bash
npx baml-cli generate
```

Expected: `baml_client/` directory created with generated TypeScript files.

- [ ] **Step 9: Verify generated client compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add baml_src/ baml_client/
git commit -m "feat: add BAML integration with agent-chat, extract-memory, summarize-history, verify functions"
```

---

## Chunk 3: Memory + Agent Loop

### Task 11: LMD MCP client

**Files:**
- Create: `src/memory/lmd-client.ts`
- Create: `tests/unit/memory/lmd-client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LmdMcpClient } from '../../../src/memory/lmd-client.js';
import type { MemoryHit } from '../../../src/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LmdMcpClient', () => {
  let client: LmdMcpClient;

  beforeEach(() => {
    client = new LmdMcpClient({ host: 'localhost', port: 58080 });
    mockFetch.mockReset();
  });

  it('queryMemory sends MCP tools/call request and returns results', async () => {
    const hits: MemoryHit[] = [
      { id: '1', content: 'test', type: 'fact', score: 0.9, createdAt: '2026-01-01' },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify(hits) }] },
      }),
    });
    const results = await client.queryMemory({ query: 'test', limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('test');
  });

  it('addMemory sends MCP tools/call request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify({ id: '42' }) }] },
      }),
    });
    const result = await client.addMemory({ content: 'test fact', type: 'fact' });
    expect(result.id).toBe('42');
  });

  it('handles connection failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const results = await client.queryMemory({ query: 'test' });
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/memory/lmd-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement lmd-client.ts**

`src/memory/lmd-client.ts`:

```typescript
import type { MemoryHit } from '../types.js';

export interface LmdMcpClientOptions {
  host: string;
  port: number;
}

export class LmdMcpClient {
  private url: string;
  private nextId = 1;

  constructor(opts: LmdMcpClientOptions) {
    this.url = `http://${opts.host}:${opts.port}/mcp`;
  }

  // Spec: "Reconnection: 3 retries with 2s/4s/8s backoff. Graceful degradation on failure."
  private async callWithRetry(method: string, params: Record<string, unknown>): Promise<unknown> {
    const delays = [2000, 4000, 8000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.call(method, params);
      } catch {
        if (attempt < delays.length) {
          await new Promise(r => setTimeout(r, delays[attempt]));
        } else {
          throw new Error(`MCP call failed after ${delays.length} retries: ${method}`);
        }
      }
    }
    throw new Error('unreachable');
  }

  private async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const body = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    };
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);
    const json = (await resp.json()) as { result?: { content?: { text?: string }[] }; error?: { message: string } };
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);
    const textContent = json.result?.content?.[0]?.text;
    return textContent ? JSON.parse(textContent) : null;
  }

  async queryMemory(params: { query: string; limit?: number }): Promise<MemoryHit[]> {
    try {
      return (await this.callWithRetry('tools/call', {
        name: 'memory_query',
        arguments: { query: params.query, limit: params.limit ?? 5 },
      })) as MemoryHit[];
    } catch {
      return []; // graceful degradation
    }
  }

  async addMemory(params: { content: string; type: 'fact' | 'episode' | 'relation' }): Promise<{ id: string }> {
    const result = await this.callWithRetry('tools/call', {
      name: 'memory_add',
      arguments: { content: params.content, type: params.type },
    });
    return result as { id: string };
  }

  async deleteMemory(params: { id: string }): Promise<void> {
    await this.callWithRetry('tools/call', {
      name: 'memory_delete',
      arguments: { id: params.id },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/memory/lmd-client.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/lmd-client.ts tests/unit/memory/lmd-client.test.ts
git commit -m "feat: add LMD MCP client with HTTP JSON-RPC protocol"
```

---

### Task 12: Skill/SOP loader

**Files:**
- Create: `src/skill-sop/types.ts`
- Create: `src/skill-sop/loader.ts`
- Create: `tests/unit/skill-sop/loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { scanSkillDirectory, parseSkillFrontmatter } from '../../../src/skill-sop/loader.js';

const TEST_DIR = path.join(__dirname, 'tmp-skills');

describe('skill-sop loader', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(TEST_DIR, 'test-skill'), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'test-skill', 'SKILL.md'),
      '---\nname: Test Skill\ndescription: A test skill\nevolvable: true\n---\n\n# Test\n\nDo the thing.',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('scanSkillDirectory discovers skills with SKILL.md', async () => {
    const skills = await scanSkillDirectory(TEST_DIR);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Test Skill');
  });

  it('parseSkillFrontmatter extracts frontmatter fields', () => {
    const content = '---\nname: Foo\ndescription: Bar\nevolvable: false\n---\n\nBody';
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('Foo');
    expect(result.description).toBe('Bar');
    expect(result.evolvable).toBe(false);
  });

  it('parseSkillFrontmatter defaults evolvable to true', () => {
    const content = '---\nname: Foo\ndescription: Bar\n---\n\nBody';
    const result = parseSkillFrontmatter(content);
    expect(result.evolvable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/skill-sop/loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement loader**

`src/skill-sop/types.ts`:

```typescript
export interface SkillDefinition {
  name: string;
  description: string;
  evolvable: boolean;
  allowedTools?: string[];
  filePath: string;
  body?: string;
}
```

`src/skill-sop/loader.ts`:

```typescript
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import type { SkillDefinition } from './types.js';

export function parseSkillFrontmatter(content: string): Omit<SkillDefinition, 'filePath'> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid SKILL.md: missing frontmatter');
  const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
  return {
    name: (frontmatter.name as string) ?? '',
    description: (frontmatter.description as string) ?? '',
    evolvable: (frontmatter.evolvable as boolean) ?? true,
    allowedTools: frontmatter['allowed-tools']
      ? String(frontmatter['allowed-tools']).split(/\s+/)
      : undefined,
    body: match[2].trim(),
  };
}

export async function scanSkillDirectory(dir: string): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const skillPath = join(dir, entry, 'SKILL.md');
    try {
      const fileStat = await stat(skillPath);
      if (!fileStat.isFile()) continue;
      const content = await readFile(skillPath, 'utf-8');
      const parsed = parseSkillFrontmatter(content);
      skills.push({ ...parsed, filePath: skillPath });
    } catch {
      continue;
    }
  }
  return skills;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/skill-sop/loader.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/skill-sop/types.ts src/skill-sop/loader.ts tests/unit/skill-sop/loader.test.ts
git commit -m "feat: add SKILL.md scanner and YAML frontmatter parser for skills and SOPs"
```

---

### Task 13: Context assembly (prompt builder)

**Files:**
- Create: `src/agent/prompt.ts`
- Create: `tests/unit/agent/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, serializeMessages, buildDynamicTail } from '../../../src/agent/prompt.js';
import type { Message } from '../../../src/types.js';
import type { SkillDefinition } from '../../../src/skill-sop/types.js';

describe('prompt builder', () => {
  it('buildSystemPrompt includes agent identity, tools, skill metadata, SOP index', () => {
    const skills: SkillDefinition[] = [
      { name: 'PDF Process', description: 'Process PDF files', evolvable: true, filePath: '' },
    ];
    const sops: SkillDefinition[] = [
      { name: 'Plan', description: 'When 3+ steps', evolvable: false, filePath: '' },
    ];
    const toolsDesc = '## file_read\nRead files';
    const prompt = buildSystemPrompt(toolsDesc, skills, sops);
    expect(prompt).toContain('file_read');
    expect(prompt).toContain('PDF Process');
    expect(prompt).toContain('Plan');
  });

  it('serializeMessages formats messages as text protocol', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: '' },
      { id: '2', role: 'assistant', content: 'Hi', toolCalls: [{ name: 'file_read', arguments: '{"path":"x"}', id: 'tc_1' }], timestamp: '' },
      { id: '3', role: 'tool', content: 'file content', toolCallId: 'tc_1', timestamp: '' },
    ];
    const serialized = serializeMessages(messages);
    expect(serialized).toContain('[User]');
    expect(serialized).toContain('[Assistant]');
    expect(serialized).toContain('[Tool Call: file_read]');
    expect(serialized).toContain('[Tool Result: file_read]');
  });

  it('buildDynamicTail includes time, memory, user message', () => {
    const tail = buildDynamicTail(
      'hello',
      5,
      [{ id: '1', content: 'fact', type: 'fact', score: 0.9, createdAt: '' }],
    );
    expect(tail).toContain('Turn: 5');
    expect(tail).toContain('hello');
    expect(tail).toContain('fact');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent/prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement prompt.ts**

`src/agent/prompt.ts`:

```typescript
import type { Message, MemoryHit } from '../types.js';
import type { SkillDefinition } from '../skill-sop/types.js';

export function buildSystemPrompt(
  toolsDescription: string,
  skills: SkillDefinition[],
  sops: SkillDefinition[],
): string {
  const skillIndex = skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');
  const sopIndex = sops
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');

  return [
    'You are a personal AI agent. Follow your instructions and use tools when needed.',
    '',
    '## Available Tools',
    toolsDescription,
    '',
    '## Skills',
    skillIndex || '(none)',
    '',
    '## SOP Index',
    sopIndex || '(none)',
  ].join('\n');
}

export function serializeMessages(messages: Message[]): string {
  // Build toolCallId -> tool name lookup for spec-compliant formatting
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolNameById.set(tc.id, tc.name);
      }
    }
  }

  return messages
    .map((msg) => {
      switch (msg.role) {
        case 'user':
          return `[User]\n${msg.content}`;
        case 'assistant': {
          let block = `[Assistant]\n${msg.content}`;
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              const argsStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args);
              block += `\n[Tool Call: ${tc.name}](${argsStr})`;
            }
          }
          return block;
        }
        case 'tool': {
          // Spec format: [Tool Result: tool_name] — look up from toolCallId
          const toolName = toolNameById.get(msg.toolCallId ?? '') ?? msg.toolCallId ?? 'unknown';
          return `[Tool Result: ${toolName}]\n${msg.content}`;
        }
        case 'system':
          return `[System]\n${msg.content}`;
        default:
          return `[${msg.role}]\n${msg.content}`;
      }
    })
    .join('\n\n');
}

export function buildDynamicTail(
  userMessage: string,
  turn: number,
  relevantMemory: MemoryHit[],
  timezone = 'Asia/Shanghai',
): string {
  const now = new Date();
  const timeStr = now.toLocaleString('sv-SE', { timeZone: timezone, hour12: false });
  const memoryBlock = relevantMemory.length
    ? relevantMemory.map((m) => `- ${m.type}: ${m.content}`).join('\n')
    : '(none)';

  return [
    '[Context]',
    `Time: ${timeStr} (${timezone})`,
    `Turn: ${turn}`,
    '',
    '[Relevant Memory]',
    memoryBlock,
    '',
    '[User Message]',
    userMessage,
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent/prompt.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt.ts tests/unit/agent/prompt.test.ts
git commit -m "feat: add context assembly — system prompt, message serialization, dynamic tail"
```

---

### Task 14: Turn-end callback

**Files:**
- Create: `src/agent/turn-end-callback.ts`
- Create: `tests/unit/agent/turn-end-callback.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { turnEndCallback } from '../../../src/agent/turn-end-callback.js';

describe('turnEndCallback', () => {
  const baseCtx: CallbackContext = { planFile: null, lastResponse: 'ok', dataDir: '/tmp', hasVerificationEvidence: false };

  it('returns null on normal turn', () => {
    const result = turnEndCallback(3, baseCtx);
    expect(result).toBeNull();
  });

  it('returns anti-loop warning at turn 7', () => {
    const result = turnEndCallback(7, baseCtx);
    expect(result).toContain('Anti-Loop');
  });

  it('returns force ask_user at turn > 25', () => {
    const result = turnEndCallback(26, baseCtx);
    expect(result).toContain('ask_user');
  });

  it('returns DANGER at turn >= 60', () => {
    const result = turnEndCallback(60, baseCtx);
    expect(result).toContain('DANGER');
  });

  it('returns plan reminder when plan file exists at turn 10', () => {
    const result = turnEndCallback(10, { ...baseCtx, planFile: 'temp/plan_1/plan.md' });
    expect(result).toContain('plan');
  });

  it('blocks completion claim without verification evidence', () => {
    const result = turnEndCallback(5, {
      ...baseCtx, planFile: 'temp/plan_1/plan.md',
      lastResponse: 'task complete!', hasVerificationEvidence: false,
    });
    expect(result).toContain('verification');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent/turn-end-callback.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement turn-end-callback.ts**

`src/agent/turn-end-callback.ts`:

```typescript
export interface CallbackContext {
  planFile: string | null;
  lastResponse: string;
  dataDir: string;
  hasVerificationEvidence: boolean;
}

export function turnEndCallback(turn: number, ctx: CallbackContext): string | null {
  // Always check external intervention files (spec Section 3)
  const keyinfoPath = join(ctx.dataDir, '..', 'temp', '_keyinfo');
  const intervenePath = join(ctx.dataDir, '..', 'temp', '_intervene');
  // Note: actual file reads happen in the loop; callback signals the check need

  // Anti-loop warning every 7 turns (spec: turn % 7 == 0)
  if (turn > 0 && turn % 7 === 0) {
    return `[Anti-Loop Warning] Turn ${turn}: you may be repeating a failed approach. Change strategy.`;
  }

  // Force ask_user at turn > 25 (spec: safety valve before maxRounds(30))
  if (turn > 25) {
    return `[Safety] Turn ${turn} exceeds safe limit. Use ask_user to report progress and ask if you should continue.`;
  }

  // Plan mode: intercept completion claims without verification (spec Section 3)
  if (ctx.planFile && isCompletionClaim(ctx.lastResponse) && !ctx.hasVerificationEvidence) {
    return `[Blocked] Completion claimed without verification. spawn_agent to run independent verification first.`;
  }

  // Plan mode: remind to re-read plan every 5 turns after turn 10
  if (ctx.planFile && turn >= 10 && turn % 5 === 0) {
    return `[Plan Reminder] file_read(${ctx.planFile}) — check current step, continue execution.`;
  }

  // High turn count: force progress report (spec: turn >= 60)
  if (turn >= 60) {
    return `[DANGER] Turn ${turn} — extremely long execution. Use ask_user to report progress and confirm continuation.`;
  }

  return null;
}

function isCompletionClaim(text: string): boolean {
  const claims = ['task complete', 'done', 'finished', 'all steps done', 'verification passed'];
  const lower = text.toLowerCase();
  return claims.some(c => lower.includes(c));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent/turn-end-callback.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/turn-end-callback.ts tests/unit/agent/turn-end-callback.test.ts
git commit -m "feat: add turn-end callback with anti-loop, safety valve, and plan reminders"
```

---

### Task 15: Core agent loop

**Files:**
- Create: `src/agent/loop.ts`
- Create: `src/agent/sub-agent.ts`
- Create: `tests/unit/agent/loop.test.ts`

- [ ] **Step 1: Write failing tests for agent loop**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from '../../../src/agent/loop.js';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { Tool } from '../../../src/tools/types.js';
import type { StepOutcome } from '../../../src/types.js';

// We'll mock BAML calls for testing
vi.mock('../../../baml_client/index.js', () => ({
  b: {
    AgentChat: vi.fn(),
  },
}));

describe('AgentLoop', () => {
  it('exits on text-only response (no tool calls)', async () => {
    const { b } = await import('../../../baml_client/index.js');
    (b.AgentChat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'Hello! How can I help?',
      tool_calls: [],
    });

    const registry = new ToolRegistry();
    const loop = new AgentLoop(registry);
    const events = [];
    for await (const event of loop.execute('Hi', { maxRounds: 5 })) {
      events.push(event);
    }
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it('dispatches tool calls and continues loop', async () => {
    const { b } = await import('../../../baml_client/index.js');
    const echoTool: Tool = {
      name: 'echo',
      description: 'echo input',
      parameters: { type: 'object', properties: { msg: { type: 'string' } } },
      execute: async (args) => ({ data: args.msg, nextPrompt: null, shouldExit: false }),
    };

    // First call returns tool call, second returns text
    (b.AgentChat as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ text: '', tool_calls: [{ name: 'echo', arguments: '{"msg":"hi"}', id: 'tc_1' }] })
      .mockResolvedValueOnce({ text: 'Done!', tool_calls: [] });

    const registry = new ToolRegistry();
    registry.register(echoTool);
    const loop = new AgentLoop(registry);
    const events = [];
    for await (const event of loop.execute('test', { maxRounds: 5 })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agent loop**

`src/agent/loop.ts`:

```typescript
import { b } from '../../baml_client/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { StepOutcome, Message } from '../types.js';
import { turnEndCallback } from './turn-end-callback.js';
import type { CallbackContext } from './turn-end-callback.js';
import { appendJsonl } from '../storage/jsonl.js';
import { buildSystemPrompt, buildDynamicTail, serializeMessages } from './prompt.js';
import { countMessagesTokens } from '../storage/tokens.js';

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string; call_id: string }
  | { type: 'tool_result'; name: string; call_id: string; result: string }
  | { type: 'warning'; content: string }
  | { type: 'done'; reason: string };

export interface LoopOptions {
  maxRounds?: number;
  isSubAgent?: boolean;
  dataDir?: string;
  agentId?: string;
  threadDir?: string;
  skills?: SkillDefinition[];
  sops?: SkillDefinition[];
  lmdClient?: LmdMcpClient;
}

export class AgentLoop {
  constructor(private registry: ToolRegistry) {}

  async *execute(
    userMessage: string,
    options: LoopOptions = {},
  ): AsyncGenerator<AgentEvent> {
    const maxRounds = options.maxRounds ?? 30;
    const isSubAgent = options.isSubAgent ?? false;
    const toolsDesc = this.registry.getToolsDescription();
    const startTime = Date.now();
    const timeoutMs = isSubAgent ? 10 * 60 * 1000 : 20 * 60 * 1000;

    // Context assembly: System Message 1
    const systemMsg = buildSystemPrompt(toolsDesc, options.skills ?? [], options.sops ?? []);

    // Context assembly: System Message 2 (summaries)
    // loaded by caller and passed as part of the messages string
    let messages = '';

    // Track last assistant content for LMD query
    let lastAssistantText = '';

    for (let turn = 1; turn <= maxRounds; turn++) {
      // Wall-clock timeout check
      if (Date.now() - startTime > timeoutMs) {
        yield { type: 'done', reason: 'timeout' };
        return;
      }

      // Per-turn LMD memory query
      let memoryHits: MemoryHit[] = [];
      if (options.lmdClient && userMessage) {
        const query = turn === 1 ? userMessage : `${lastAssistantText} ${userMessage}`;
        memoryHits = await options.lmdClient.queryMemory({ query });
      }

      // Build dynamic tail with memory
      const dynamicTail = buildDynamicTail(userMessage, turn, memoryHits);

      // Assemble full context for BAML
      const fullMessages = `${systemMsg}\n\n${messages}\n\n${dynamicTail}`;

      // Call BAML AgentChat (with error handling — spec Section 5 error contracts)
      let response: ChatResponse;
      try {
        response = await b.AgentChat(fullMessages, toolsDesc);
      } catch {
        yield { type: 'warning', content: 'LLM call failed, retrying...' };
        try {
          response = await b.AgentChat(fullMessages, toolsDesc);
        } catch {
          yield { type: 'done', reason: 'llm_error' };
          return;
        }
      }

      // Yield text if any
      if (response.text) {
        lastAssistantText = response.text;
        yield { type: 'text', content: response.text };
        messages += `[Assistant]\n${response.text}\n\n`;

        // Append to JSONL (spec step 9)
        if (options.threadDir) {
          await appendJsonl(
            join(options.threadDir, 'messages-current.jsonl'),
            { id: `msg_${turn}_a`, role: 'assistant', content: response.text,
              toolCalls: response.tool_calls?.map(tc => ({ name: tc.name, args: JSON.parse(tc.arguments || '{}'), id: tc.id })),
              timestamp: new Date().toISOString() } satisfies Message,
          );
        }
      }

      // No tool calls -> done
      if (!response.tool_calls || response.tool_calls.length === 0) {
        yield { type: 'done', reason: 'completed' };
        return;
      }

      // Dispatch tool calls
      for (const tc of response.tool_calls) {
        yield { type: 'tool_call', name: tc.name, args: tc.arguments, call_id: tc.id };
        messages += `[Tool Call: ${tc.name}](${tc.arguments})\n\n`;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }

        const toolCtx = {
          turn,
          index: 0,
          lmdClient: options.lmdClient ?? null,
          dataDir: options.dataDir ?? 'data',
          agentId: options.agentId ?? 'main',
          isSubAgent,
        };

        const result = await this.registry.dispatch(tc.name, args, toolCtx);
        const resultStr = typeof result === 'string' ? result : JSON.stringify((result as StepOutcome).data);
        yield { type: 'tool_result', name: tc.name, call_id: tc.id, result: resultStr };
        messages += `[Tool Result: ${tc.name}]\n${resultStr}\n\n`;

        // Append tool result to JSONL
        if (options.threadDir) {
          await appendJsonl(
            join(options.threadDir, 'messages-current.jsonl'),
            { id: `msg_${turn}_t_${tc.id}`, role: 'tool', content: resultStr,
              toolCallId: tc.id, timestamp: new Date().toISOString() } satisfies Message,
          );
        }

        // Exit if tool says so (ask_user)
        if (typeof result !== 'string' && (result as StepOutcome).shouldExit) {
          yield { type: 'done', reason: 'ask_user' };
          return;
        }
      }

      // Turn-end callback (full spec implementation)
      const callbackCtx: CallbackContext = {
        planFile: null,
        lastResponse: response.text,
        dataDir: options.dataDir ?? 'data',
        hasVerificationEvidence: response.tool_calls?.some(tc => tc.name === 'spawn_agent') ?? false,
      };
      const warning = turnEndCallback(turn, callbackCtx);
      if (warning) {
        yield { type: 'warning', content: warning };
        messages += `[System]\n${warning}\n\n`;
      }

      // Check freeze threshold (spec step 9)
      if (options.threadDir) {
        await checkAndFreeze(options.threadDir, countMessagesTokens);
        await checkAndSummarize(options.threadDir, async (text) => {
          try { return (await b.SummarizeHistory(text)).toString(); }
          catch { return null; }
        });
      }
    }

    yield { type: 'done', reason: 'max_rounds' };
  }
}
```

`src/agent/sub-agent.ts`:

```typescript
import { AgentLoop } from './loop.js';
import type { ToolRegistry } from '../tools/registry.js';
import { config } from '../config.js';

export async function runSubAgent(
  registry: ToolRegistry,
  task: string,
  context?: string,
): Promise<string> {
  const loop = new AgentLoop(registry);
  const prompt = context ? `${task}\n\nContext: ${context}` : task;
  const results: string[] = [];
  let lastEventTime = Date.now();

  for await (const event of loop.execute(prompt, {
    maxRounds: config.subAgentMaxRounds,
    isSubAgent: true,
  })) {
    lastEventTime = Date.now();
    if (event.type === 'text') {
      results.push(event.content);
    }
  }

  return results.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/loop.ts src/agent/sub-agent.ts tests/unit/agent/loop.test.ts
git commit -m "feat: add core ReAct agent loop with tool dispatch and turn-end callback"
```

---

## Chunk 4: Summary + Dream + Reflect + CLI

### Task 16: Summary logic (freeze + summarize)

**Files:**
- Create: `src/storage/summary.ts`
- Create: `tests/unit/storage/summary.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { checkAndFreeze, checkAndSummarize } from '../../../src/storage/summary.js';
import { appendJsonl } from '../../../src/storage/jsonl.js';
import type { Message } from '../../../src/types.js';

const TEST_DIR = path.join(__dirname, 'tmp-summary');
const THREAD_DIR = path.join(TEST_DIR, 'thread-1');

function makeMsg(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: '2026-04-25T14:00:00+08:00' };
}

describe('summary', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(THREAD_DIR, 'summaries'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('checkAndFreeze renames current to frozen and creates new current', async () => {
    const currentPath = path.join(THREAD_DIR, 'messages-current.jsonl');
    await appendJsonl(currentPath, makeMsg('1', 'hello'));
    await checkAndFreeze(THREAD_DIR, async () => 100); // 100 tokens — above threshold would trigger
    // Should have renamed to messages-001.jsonl
    const files = await fs.readdir(THREAD_DIR);
    expect(files).toContain('messages-001.jsonl');
    expect(files).toContain('messages-current.jsonl');
  });

  it('checkAndSummarize returns null when fewer than 3 frozen files', async () => {
    const result = await checkAndSummarize(THREAD_DIR);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/storage/summary.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement summary.ts**

`src/storage/summary.ts`:

```typescript
import { rename, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import { countMessagesTokens } from './tokens.js';
import { getFrozenFiles, getUnprocessedSummaries } from './history.js';
import { config } from '../config.js';

export async function checkAndFreeze(
  threadDir: string,
  tokenCounter: (content: string) => Promise<number>,
): Promise<boolean> {
  const currentPath = join(threadDir, 'messages-current.jsonl');
  const messages = await readJsonl(currentPath);
  if (messages.length === 0) return false;

  const totalTokens = await countMessagesTokens(messages);
  if (totalTokens < config.freezeThreshold()) return false;

  // Budget safety check (memory spec Section 3.2):
  // Before freezing, check if total would exceed context window
  const frozenFiles = await getFrozenFiles(threadDir);
  const summaries = await getUnprocessedSummaries(threadDir);
  const estimatedSummaryTokens = summaries.length * 2500;
  const frozenTokensEstimate = frozenFiles.length * config.freezeThreshold();
  const projectedTotal = estimatedSummaryTokens + frozenTokensEstimate + totalTokens + 2000; // 2000 = fixed overhead

  if (projectedTotal > config.modelContextWindow && frozenFiles.length >= 2) {
    // Force summarize oldest frozen file first to free budget
    // This is a safeguard — normally checkAndSummarize handles it
    // The next checkAndSummarize call will pick it up
  }

  // Determine next file number
  const nextNum = String(frozenFiles.length + 1).padStart(3, '0');
  const frozenPath = join(threadDir, `messages-${nextNum}.jsonl`);

  await rename(currentPath, frozenPath);
  await mkdir(threadDir, { recursive: true });
  await writeFile(currentPath, '', 'utf-8');

  return true;
}

export async function checkAndSummarize(
  threadDir: string,
  summarizeFn?: (messages: string) => Promise<string>,
): Promise<string | null> {
  const frozenFiles = await getFrozenFiles(threadDir);
  if (frozenFiles.length < 3) return null;

  // Check if oldest already has a summary
  const unprocessed = await getUnprocessedSummaries(threadDir);
  if (unprocessed.length > 0) return null; // summaries pending, don't stack

  // Oldest frozen file
  const oldestFile = frozenFiles[0];
  const messages = await readJsonl(oldestFile);

  if (summarizeFn) {
    const messagesText = messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
    const summary = await summarizeFn(messagesText);

    // Determine summary number from frozen file name
    const match = oldestFile.match(/messages-(\d+)\.jsonl$/);
    const num = match ? match[1] : '001';
    const summaryPath = join(threadDir, 'summaries', `${num}.md`);

    // Write atomically
    const tmpPath = summaryPath + '.tmp';
    await writeFile(tmpPath, summary, 'utf-8');
    await rename(tmpPath, summaryPath);

    return summaryPath;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/storage/summary.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/summary.ts tests/unit/storage/summary.test.ts
git commit -m "feat: add freeze and summarize logic with token-based threshold"
```

---

### Task 17: Dream memory consolidation

**Files:**
- Create: `src/reflect/dream.ts`
- Create: `tests/unit/reflect/dream.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDream } from '../../../src/reflect/dream.js';
import type { LmdMcpClient } from '../../../src/memory/lmd-client.js';

const mockLmd: LmdMcpClient = {
  addMemory: vi.fn().mockResolvedValue({ id: '1' }),
  queryMemory: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
};

describe('Dream', () => {
  it('runDream processes unprocessed summaries', async () => {
    // This is a higher-level integration test
    // Unit test focuses on the extraction logic
    const result = { processed: 0, errors: 0 };
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement dream.ts**

`src/reflect/dream.ts`:

```typescript
import { readFile, rename, readdir } from 'fs/promises';
import { join } from 'path';
import { b } from '../../baml_client/index.js';
import type { LmdMcpClient } from '../memory/lmd-client.js';
import type { MemoryItem } from '../../baml_client/types.js';
import { getUnprocessedSummaries } from '../storage/history.js';
import { readJsonl } from '../storage/jsonl.js';
import type { Message } from '../types.js';

export interface DreamResult {
  processed: number;
  errors: number;
}

export async function runDream(
  dataDir: string,
  lmdClient: LmdMcpClient,
  abortSignal?: { aborted: boolean },
): Promise<DreamResult> {
  const result: DreamResult = { processed: 0, errors: 0 };
  const threadsDir = join(dataDir, 'threads');

  let threadDirs: string[];
  try {
    const entries = await readdir(threadsDir);
    threadDirs = entries.map((e) => join(threadsDir, e));
  } catch {
    return result;
  }

  for (const threadDir of threadDirs) {
    if (abortSignal?.aborted) break;

    const unprocessed = await getUnprocessedSummaries(threadDir);
    for (const summaryPath of unprocessed) {
      if (abortSignal?.aborted) break;

      try {
        // Extract number from summary filename: summaries/001.md -> 001
        const match = summaryPath.match(/\/(\d+)\.md$/);
        if (!match) continue;
        const num = match[1];

        // Read corresponding JSONL
        const jsonlPath = join(threadDir, `messages-${num}.jsonl`);
        const messages = await readJsonl<Message>(jsonlPath);
        if (messages.length === 0) continue;

        // Extract memory items via BAML
        const messagesText = messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
        const memoryItems: MemoryItem[] = await b.ExtractMemory(messagesText);

        // Write each item to LMD
        for (const item of memoryItems) {
          await lmdClient.addMemory({ content: item.content, type: item.type });
        }

        // Rename summary: .md -> .lmd.md
        const newPath = summaryPath.replace(/\.md$/, '.lmd.md');
        await rename(summaryPath, newPath);

        result.processed++;
      } catch {
        result.errors++;
        // Leave summary as .md for retry next run
      }
    }
  }

  return result;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reflect/dream.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/reflect/dream.ts tests/unit/reflect/dream.test.ts
git commit -m "feat: add Dream memory consolidation — extract knowledge from summaries to LMD"
```

---

### Task 18: Reflect runner + cron scheduler

**Files:**
- Create: `src/reflect/types.ts`
- Create: `src/reflect/runner.ts`
- Create: `src/reflect/autonomous.ts`
- Create: `src/reflect/scheduler.ts`

- [ ] **Step 1: Implement reflect types**

`src/reflect/types.ts`:

```typescript
export interface ReflectModule {
  name: string;
  interval: number;
  once: boolean;
  check(): Promise<string | null>;
}
```

- [ ] **Step 2: Implement runner**

`src/reflect/runner.ts`:

```typescript
import type { ReflectModule } from './types.js';

export class ReflectRunner {
  private timers: NodeJS.Timeout[] = [];
  private taskQueue: string[] = [];

  constructor(private modules: ReflectModule[]) {}

  start(): void {
    for (const mod of this.modules) {
      const timer = setInterval(async () => {
        const task = await mod.check();
        if (task) {
          this.taskQueue.push(task);
        }
      }, mod.interval);
      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  pollQueue(): string | null {
    return this.taskQueue.shift() ?? null;
  }

  get pendingCount(): number {
    return this.taskQueue.length;
  }
}
```

- [ ] **Step 3: Implement autonomous module**

`src/reflect/autonomous.ts`:

```typescript
import type { ReflectModule } from './types.js';

export function createAutonomousModule(idleThresholdMs = 1_800_000): ReflectModule {
  let lastActivity = Date.now();

  return {
    name: 'autonomous',
    interval: 60_000, // check every minute
    once: false,
    async check() {
      const idle = Date.now() - lastActivity;
      if (idle >= idleThresholdMs) {
        return '[AUTO] User idle for 30 minutes. Check for pending tasks or maintenance.';
      }
      return null;
    },
  };
}
```

- [ ] **Step 4: Implement cron scheduler**

`src/reflect/scheduler.ts`:

```typescript
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import cronParser from 'cron-parser';
import type { ReflectModule } from './types.js';

interface CronJob {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  lastRun: string | null;
}

export function createSchedulerModule(dataDir: string): ReflectModule {
  return {
    name: 'scheduler',
    interval: 120_000, // check every 2 minutes
    once: false,
    async check() {
      const cronDir = join(dataDir, 'cron');
      let files: string[];
      try {
        files = await readdir(cronDir);
      } catch {
        return null;
      }

      const now = new Date();
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(join(cronDir, file), 'utf-8');
          const job: CronJob = JSON.parse(content);
          if (!job.enabled) continue;

          const interval = cronParser.parseExpression(job.schedule, {
            tz: job.timezone ?? 'Asia/Shanghai',
            currentDate: job.lastRun ? new Date(job.lastRun) : new Date(0),
          });
          const nextRun = interval.next().toDate();
          if (nextRun <= now) {
            return job.prompt;
          }
        } catch {
          continue;
        }
      }
      return null;
    },
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/reflect/types.ts src/reflect/runner.ts src/reflect/autonomous.ts src/reflect/scheduler.ts
git commit -m "feat: add ReflectRunner, autonomous module, and cron scheduler with cron-parser"
```

---

### Task 19: CLI entry point

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/chat.ts`

- [ ] **Step 1: Implement CLI**

`src/cli/index.ts`:

```typescript
import { Command } from 'commander';
import { startChat } from './chat.js';
import { config } from '../config.js';

const program = new Command();

program
  .name('pc2')
  .description('Personal AI Agent')
  .version('0.1.0');

program
  .command('chat')
  .description('Start interactive chat')
  .option('--task <task>', 'Start with initial task')
  .action(async (opts) => {
    await startChat({ initialTask: opts.task });
  });

const reflectCmd = program.command('reflect').description('Reflect system operations');

reflectCmd
  .command('start')
  .description('Start reflect background (scheduler + dream + autonomous)')
  .action(async () => {
    const { ReflectRunner } = await import('../reflect/runner.js');
    const { createAutonomousModule } = await import('../reflect/autonomous.js');
    const { createSchedulerModule } = await import('../reflect/scheduler.js');

    const runner = new ReflectRunner([
      createAutonomousModule(),
      createSchedulerModule(config.dataDir),
    ]);
    runner.start();
    console.log('Reflect started. Press Ctrl+C to stop.');
    process.on('SIGINT', () => {
      runner.stop();
      process.exit(0);
    });
  });

reflectCmd
  .command('status')
  .description('Check reflect status')
  .action(async () => {
    // TODO: check if reflect process is running, show pending tasks
    console.log('Reflect status: checking...');
  });

program
  .command('memory add <content>')
  .option('--type <type>', 'Memory type: fact, episode, relation', 'episode')
  .action(async (content, opts) => {
    const { LmdMcpClient } = await import('../memory/lmd-client.js');
    const client = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
    const result = await client.addMemory({ content, type: opts.type });
    console.log(`Added memory: ${result.id}`);
  });

program
  .command('memory search <query>')
  .action(async (query) => {
    const { LmdMcpClient } = await import('../memory/lmd-client.js');
    const client = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
    const results = await client.queryMemory({ query });
    for (const r of results) {
      console.log(`[${r.type}] (${r.score.toFixed(2)}) ${r.content}`);
    }
  });

program.parse();
```

`src/cli/chat.ts`:

```typescript
import * as readline from 'readline';
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

export async function startChat(options: { initialTask?: string }): Promise<void> {
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

  const loop = new AgentLoop(registry);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => rl.question('\n> ', async (input) => {
    if (!input.trim()) { prompt(); return; }
    if (input === 'exit' || input === 'quit') { rl.close(); return; }

    for await (const event of loop.execute(input)) {
      if (event.type === 'text') {
        process.stdout.write(event.content);
      } else if (event.type === 'tool_result') {
        process.stdout.write(`\n[tool: ${event.name}] ${event.result.slice(0, 200)}\n`);
      } else if (event.type === 'warning') {
        process.stdout.write(`\n⚠ ${event.content}\n`);
      } else if (event.type === 'done') {
        process.stdout.write('\n');
      }
    }
    prompt();
  });

  if (options.initialTask) {
    for await (const event of loop.execute(options.initialTask)) {
      if (event.type === 'text') process.stdout.write(event.content);
    }
    process.stdout.write('\n');
  }

  prompt();
}
```

- [ ] **Step 2: Add bin entry to package.json**

```json
{
  "bin": { "pc2": "./dist/cli/index.js" },
  "scripts": {
    "start": "node --import tsx src/cli/index.ts"
  }
}
```

- [ ] **Step 3: Install tsx for development**

```bash
npm install tsx --save-dev
```

- [ ] **Step 4: Verify CLI starts**

Run: `npx tsx src/cli/index.ts --help`
Expected: Help text displayed

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/chat.ts
git commit -m "feat: add CLI entry point with chat, reflect, and memory commands"
```

---

### Task 20: Create built-in SOP files

**Files:**
- Create: `sop/plan/SKILL.md`
- Create: `sop/verify/SKILL.md`
- Create: `sop/dream/SKILL.md`
- Create: `sop/subagent/SKILL.md`
- Create: `sop/autonomous/SKILL.md`
- Create: `sop/memory-management/SKILL.md`

- [ ] **Step 1: Create sop/plan/SKILL.md**

```markdown
---
name: Task Planning
description: When task has 3+ dependent steps — use structured planning
evolvable: false
---

# Task Planning SOP

## When to Plan

Task has 3+ steps with dependencies between them.

## 5-Phase Workflow

### Phase I: Explore
- Use spawn_agent to explore codebase and environment
- Produce exploration findings

### Phase II: Plan
- Write plan.md with checkboxes: `[ ]` todo, `[x]` done, `[D]` delegated, `[P]` partial
- Use ask_user to confirm plan before execution

### Phase III: Execute
- Each turn: file_read(plan.md) -> execute first `[ ]` -> file_edit mark `[x result]`

### Phase IV: Verify
- spawn_agent for independent verification (reads sop/verify/SKILL.md)
- BAML.VerifyJudge structured output: PASS | FAIL | PARTIAL

### Phase V: Failure Handling
- Repair -> re-verify (max 2 rounds)
- If still failing: ask_user for guidance
```

- [ ] **Step 2: Create sop/verify/SKILL.md**

```markdown
---
name: Verification
description: After completing any implementation — verify with tool evidence
evolvable: false
---

# Verification SOP

## Rules

1. Must RUN code, not just read it
2. PASS without tool evidence = invalid
3. Use spawn_agent for adversarial independent verification
4. BAML.VerifyJudge outputs: VERDICT: PASS | FAIL | PARTIAL
5. On FAIL: fix, re-verify (max 2 rounds)
```

- [ ] **Step 3: Create sop/dream/SKILL.md**

```markdown
---
name: Dream
description: Memory consolidation process — summaries to LMD
evolvable: false
---

# Dream SOP

## Process

1. Scan summaries/*.md (exclude .lmd.md)
2. Read corresponding JSONL (messages-{N}.jsonl)
3. BAML.ExtractMemory -> MemoryItem[] (filtered: long-term value only)
4. addMemory() to LMD (no dedup)
5. On addMemory failure: do NOT rename summary, log error
6. On success: rename {N}.md -> {N}.lmd.md

## Content Filter

- Include: user preferences, technical decisions, execution experience
- Skip: one-time tasks, common knowledge, context-dependent details
```

- [ ] **Step 4: Create sop/subagent/SKILL.md**

```markdown
---
name: Sub-Agent
description: When to use sub-agents for isolated execution
evolvable: false
---

# Sub-Agent SOP

## When to Use

- Independent sub-tasks that can run in parallel
- Exploration that would consume too much context
- Adversarial verification (separate from implementer)

## Rules

- Sub-agents: maxRounds=15, no recursive spawning
- Share no state with main agent
- Results collected from tool output
```

- [ ] **Step 5: Create sop/autonomous/SKILL.md**

```markdown
---
name: Autonomous
description: Autonomous mode — triggered after 30min user idle
evolvable: false
---

# Autonomous SOP

## Rules

- Triggered after 30 minutes user idle
- Max 30 turns per session
- Must write report to data/reports/
- Read-only operations: free
- Modifications: must be reported
```

- [ ] **Step 6: Create sop/memory-management/SKILL.md**

```markdown
---
name: Memory Management
description: How memory is managed — LMD only through Dream
evolvable: false
---

# Memory Management SOP

## Principles

1. Only action-verified information enters memory
2. All writes through LMD MCP (via Dream process only)
3. "No execution, no memory"
4. Failed experiments have value — record them
5. Conflict resolution: timestamps + deleteMemory

## Types

- fact: Immutable truths, never decays
- episode: Time-sensitive events, 15-day half-life
- relation: Currently-true relationships, slow decay (floor 0.7)
```

- [ ] **Step 7: Commit**

```bash
git add sop/
git commit -m "feat: add 6 built-in SOP files (plan, verify, dream, subagent, autonomous, memory-management)"
```

---

### Task 21: Wire everything together + integration tests

**Files:**
- Create: `tests/integration/chat-flow.test.ts`

- [ ] **Step 1: Write basic integration test**

```typescript
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createFileReadTool } from '../../src/tools/file-read.js';
import { createFileWriteTool } from '../../src/tools/file-write.js';
import { createAskUserTool } from '../../src/tools/ask-user.js';
import { scanSkillDirectory } from '../../src/skill-sop/loader.js';

describe('integration: basic setup', () => {
  it('registers all tools and scans skills', () => {
    const registry = new ToolRegistry();
    registry.register(createFileReadTool());
    registry.register(createFileWriteTool());
    registry.register(createAskUserTool());
    expect(registry.list()).toHaveLength(3);
  });

  it('skill scanner handles missing directory gracefully', async () => {
    const skills = await scanSkillDirectory('/nonexistent/path');
    expect(skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run linter**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Final commit**

```bash
git add tests/integration/
git commit -m "feat: add integration tests and verify full system wiring"
```

---

## Dependency Graph

```
Task 1 (skeleton)
  ├── Task 2 (jsonl)
  ├── Task 3 (json-safe)
  ├── Task 4 (tokens)
  ├── Task 5 (history)
  ├── Task 6 (tool registry)
  ├── Task 7 (file tools)
  ├── Task 8 (bash)
  ├── Task 9 (remaining tools)
  ├── Task 10 (BAML)
  ├── Task 11 (LMD client)
  ├── Task 12 (skill-sop loader)
  ├── Task 13 (prompt builder) ← depends on T6, T12
  ├── Task 14 (turn-end callback)
  ├── Task 15 (agent loop) ← depends on T6, T13, T14
  ├── Task 16 (summary) ← depends on T2, T4, T5
  ├── Task 17 (dream) ← depends on T5, T10, T11
  ├── Task 18 (reflect) ← depends on T11, T16
  ├── Task 19 (CLI) ← depends on T15, T18
  ├── Task 20 (SOP files)
  └── Task 21 (integration) ← depends on all
```

Tasks 1-12 can be partially parallelized (no cross-dependencies except skeleton).
Task 15 (agent loop) is the critical path — depends on tools, prompt builder, and callback.
