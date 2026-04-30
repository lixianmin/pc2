# Context Assembly Fix — 修复 "Context truncated" 警告

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 spec 定义的三层上下文组装逻辑，消除运行时暴力截断。

**Architecture:** 在 `loop.ts` 的 `execute()` 中，每轮从磁盘加载 summary + bridge + current 组装 messages，替代当前纯内存 append 模式。新增 `src/storage/context.ts` 封装组装逻辑。

**Tech Stack:** TypeScript, vitest

---

## 0. 问题分析

### 现象

运行 agent 时出现 `[warning] Context truncated: removed 548 lines to stay within token budget`。

### 根因

`loop.ts:224` 中 `messages` 字符串在整个 `execute()` 生命周期中只增不减：

```typescript
// loop.ts:224 — 每次 execute() 开始
let messages = this.conversationHistory + `[User]\n${userMessage}\n\n`;

// loop.ts:262 — 每个 assistant 回复追加
messages += `[Assistant]\n${response.text}\n\n`;

// loop.ts:274-276 — 每个 tool call 追加
messages += `[Tool Call: ${tc.name}](${tc.arguments})\n\n`;
messages += `[Tool Result: ${tc.name}]\n${resultStr}\n\n`;
```

当 token 数超过 context window 的 60%（`loop.ts:199-200`），触发暴力截断：

```typescript
// loop.ts:200-206
if (msgTokens > budget) {
  const lines = messages.split('\n');
  const keepCount = Math.max(20, Math.floor(lines.length * 0.3));
  messages = '[...earlier context truncated...]\n\n' + lines.slice(-keepCount).join('\n');
}
```

这是**按行截断**，丢失最早 70% 的上下文，没有语义感知。

### Spec 设计 vs 实际实现的差距

Spec（`memory-and-context.md` Section 4）定义了三层上下文组装：

```
System Message 1 (~1500 tokens) — 身份+指令+工具
System Message 2 — 仅未处理的 summary (.md 文件)
Recent Messages — bridge 冻结文件(完整) + current 文件(完整)
Dynamic Tail (~500 tokens) — 时间+memory query+用户输入
```

**关键设计点：Summary 替代 frozen history。** 当冻结文件被 summarize 后：
- 原始冻结文件不再进入 context（由 summary 覆盖）
- bridge 冻结文件保证 summary 和 current 之间零语义断裂
- 预算安全检查确保 summary + bridge + current 永远不超预算

**当前实现完全缺失的部分：**

| Spec 要求 | 实现状态 |
|----------|---------|
| Summary 加载到 System Message 2 | ❌ `checkAndSummarize` 只写磁盘，运行时不读回 |
| Bridge 冻结文件加载为 Recent Messages | ❌ 概念存在但不参与运行时 messages |
| 每轮从磁盘重新组装 | ❌ messages 在内存中纯 append |
| 预算安全检查（冻结前检查） | ❌ 只有事后截断，没有事前预算检查 |

### 另一个缺陷：`loadThreadHistory` 加载全量

`thread.ts:62-76` 的 `loadThreadHistory` 在 resume 时加载**所有**冻结文件 + current：

```typescript
for (const f of frozenFiles) {
  const msgs = await readJsonl<Message>(f);
  allMessages.push(...msgs);
}
```

如果 thread 有 5 个冻结文件 + summary，它把 5 个冻结文件全部加载。而 spec 设计是只加载 bridge + current，summary 通过 System Message 2 提供。

### 问题产生的根本原因

1. **实现顺序问题**：先实现了 freeze/summarize 的磁盘操作（storage 层），但没有实现运行时的上下文组装（agent loop 层）。两层之间缺少桥接。
2. **后备方案变成了常态**：暴力截断本来是兜底逻辑，但因为组装逻辑缺失，变成了每次长对话都会触发的"正常"路径。
3. **resume 时也有问题**：`loadThreadHistory` 加载全量 frozen 文件，意味着 resume 后的首次 execute 就可能超预算。

### 如何避免此类问题

1. **Spec 中每个写入操作必须对应一个读取操作**：freeze/summarize 是写入，需要有对应的读取（组装到 context）一起实现。
2. **数据流闭环验证**：实现后需要验证"写入的数据确实在正确的时机被读取"。
3. **后备逻辑不应该被触发**：如果兜底截断在正常使用中被触发，说明核心流程有问题。

---

## 1. 修复方案

### 核心思路

不在 `execute()` 中维护一个不断增长的 `messages` 字符串，而是**每轮从磁盘重新组装**：

1. 加载所有未处理的 summary 文件（`.md` 后缀，非 `.lmd.md`）→ System Message 2
2. 加载 bridge 冻结文件（倒数第二个冻结文件）+ current 文件 → Recent Messages
3. 加载本轮新的 tool call/result（仍在内存中，尚未落盘到 current）→ Recent Messages 尾部

每轮 turn 结束后：
- `postTurn` 中的 `checkAndFreeze` / `checkAndSummarize` 写磁盘
- 下一轮自动从磁盘重新组装（新 summary 生效，bridge 更新）
- **移除暴力截断逻辑**

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/storage/context.ts` | **Create** | 上下文组装：加载 summary + bridge + current + 内存中的增量 |
| `src/storage/history.ts` | **Modify** | 新增 `getBridgeFile()` 获取 bridge 冻结文件 |
| `src/agent/loop.ts` | **Modify** | 用 context.ts 替代内存 append，移除暴力截断 |
| `src/storage/thread.ts` | **Modify** | `loadThreadHistory` 改为只加载 bridge + current + summary |
| `tests/unit/storage/context.test.ts` | **Create** | context 组装的单元测试 |
| `tests/unit/storage/thread.test.ts` | **Modify** | 更新 loadThreadHistory 测试 |
| `tests/unit/agent/loop.test.ts` | **Modify** | 更新 loop 测试 |

---

## 2. Tasks

### Task 1: 在 `history.ts` 中新增 `getBridgeFile`

**Files:**
- Modify: `src/storage/history.ts`
- Test: `tests/unit/storage/history.test.ts`（如果存在）或新建

- [ ] **Step 1: 写失败测试**

在 `tests/unit/storage/history.test.ts` 中（如果没有则新建）：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { getFrozenFiles, getBridgeFile } from '../../../src/storage/history.js';

const TMP = join(process.cwd(), '.tmp-history-test');

describe('getBridgeFile', () => {
  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
  });
  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it('returns null when no frozen files', async () => {
    const result = await getBridgeFile(TMP);
    expect(result).toBeNull();
  });

  it('returns null when only one frozen file', async () => {
    await writeFile(join(TMP, 'messages-001.jsonl'), '', 'utf-8');
    const result = await getBridgeFile(TMP);
    expect(result).toBeNull();
  });

  it('returns second-to-last frozen file as bridge', async () => {
    await writeFile(join(TMP, 'messages-001.jsonl'), '', 'utf-8');
    await writeFile(join(TMP, 'messages-002.jsonl'), '', 'utf-8');
    await writeFile(join(TMP, 'messages-003.jsonl'), '', 'utf-8');
    const result = await getBridgeFile(TMP);
    expect(result).toBe(join(TMP, 'messages-002.jsonl'));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/storage/history.test.ts
```

- [ ] **Step 3: 实现 `getBridgeFile`**

在 `src/storage/history.ts` 中添加：

```typescript
export async function getBridgeFile(threadDir: string): Promise<string | null> {
  const frozen = await getFrozenFiles(threadDir);
  if (frozen.length < 2) return null;
  return frozen[frozen.length - 2];
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/storage/history.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/storage/history.ts tests/unit/storage/history.test.ts
git commit -m "feat: add getBridgeFile to identify bridge frozen file"
```

---

### Task 2: 创建 `src/storage/context.ts` — 上下文组装模块

**Files:**
- Create: `src/storage/context.ts`
- Create: `tests/unit/storage/context.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { assembleContext } from '../../../src/storage/context.js';

const TMP = join(process.cwd(), '.tmp-context-test');

describe('assembleContext', () => {
  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, 'summaries'), { recursive: true });
  });
  afterEach(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  it('returns empty string when no messages', async () => {
    const result = await assembleContext(TMP);
    expect(result).toBe('');
  });

  it('loads only current file when no frozen files', async () => {
    await writeFile(
      join(TMP, 'messages-current.jsonl'),
      JSON.stringify({ id: '1', role: 'user', content: 'hello', timestamp: '' }) + '\n',
      'utf-8',
    );
    const result = await assembleContext(TMP);
    expect(result).toContain('hello');
    expect(result).not.toContain('[Summary]');
  });

  it('loads bridge + current, skips summarized frozen files', async () => {
    // messages-001 已被 summarize
    await writeFile(join(TMP, 'messages-001.jsonl'), '', 'utf-8');
    // messages-002 是 bridge
    await writeFile(
      join(TMP, 'messages-002.jsonl'),
      JSON.stringify({ id: '2', role: 'user', content: 'bridge msg', timestamp: '' }) + '\n',
      'utf-8',
    );
    // messages-003 刚冻结
    await writeFile(
      join(TMP, 'messages-003.jsonl'),
      JSON.stringify({ id: '3', role: 'user', content: 'frozen msg', timestamp: '' }) + '\n',
      'utf-8',
    );
    // current
    await writeFile(
      join(TMP, 'messages-current.jsonl'),
      JSON.stringify({ id: '4', role: 'user', content: 'current msg', timestamp: '' }) + '\n',
      'utf-8',
    );
    // summary for messages-001
    await writeFile(join(TMP, 'summaries', '001.md'), 'summary of 001', 'utf-8');

    const result = await assembleContext(TMP);
    expect(result).toContain('[Summary]');
    expect(result).toContain('summary of 001');
    expect(result).toContain('bridge msg');
    expect(result).toContain('current msg');
    // messages-001 内容不直接出现（被 summary 替代）
    // messages-003 出现（最新的冻结文件，不在 bridge 之前的）
    expect(result).toContain('frozen msg');
  });

  it('appends inMemory messages after disk-loaded content', async () => {
    await writeFile(
      join(TMP, 'messages-current.jsonl'),
      JSON.stringify({ id: '1', role: 'user', content: 'disk msg', timestamp: '' }) + '\n',
      'utf-8',
    );
    const result = await assembleContext(TMP, '[Tool Result: bash]\noutput here\n\n');
    expect(result).toContain('disk msg');
    expect(result).toContain('output here');
    const diskIdx = result.indexOf('disk msg');
    const memIdx = result.indexOf('output here');
    expect(memIdx).toBeGreaterThan(diskIdx);
  });

  it('loads summaries as System Message 2', async () => {
    await writeFile(join(TMP, 'messages-001.jsonl'), '', 'utf-8');
    await writeFile(join(TMP, 'messages-002.jsonl'), '', 'utf-8');
    await writeFile(
      join(TMP, 'messages-current.jsonl'),
      JSON.stringify({ id: '1', role: 'user', content: 'hi', timestamp: '' }) + '\n',
      'utf-8',
    );
    await writeFile(join(TMP, 'summaries', '001.md'), 'first summary', 'utf-8');
    await writeFile(join(TMP, 'summaries', '002.lmd.md'), 'processed summary', 'utf-8');

    const result = await assembleContext(TMP);
    expect(result).toContain('first summary');
    expect(result).not.toContain('processed summary');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/storage/context.test.ts
```

- [ ] **Step 3: 实现 `assembleContext`**

创建 `src/storage/context.ts`：

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getFrozenFiles, getBridgeFile, getUnprocessedSummaries } from './history.js';
import { readJsonl } from './jsonl.js';
import { serializeMessages } from '../agent/prompt.js';
import type { Message } from '../types.js';

export async function assembleContext(
  threadDir: string,
  inMemorySuffix: string = '',
): Promise<string> {
  const frozen = await getFrozenFiles(threadDir);
  const unprocessedSummaries = await getUnprocessedSummaries(threadDir);

  // 找到已 summarize 的冻结文件编号（有对应 .md summary 文件）
  const summarizedNums = new Set<string>();
  for (const s of unprocessedSummaries) {
    const match = s.match(/(\d+)\.md$/);
    if (match) summarizedNums.add(match[1]);
  }

  // 加载 summaries 作为 System Message 2
  const summaryParts: string[] = [];
  for (const s of unprocessedSummaries) {
    const content = await readFile(s, 'utf-8');
    const match = s.match(/(\d+)\.md$/);
    const label = match ? match[1] : '?';
    summaryParts.push(`[Summary: ${label}]\n${content}`);
  }

  // 确定哪些冻结文件需要加载到 Recent Messages
  // 逻辑：从后往前，bridge 之后的所有冻结文件 + current
  // bridge 是倒数第二个冻结文件（保证 summary 和 current 之间零断裂）
  // bridge 之前的冻结文件如果有 summary 则不加载
  let recentMessages: Message[] = [];

  if (frozen.length >= 2) {
    const bridgeIdx = frozen.length - 2;
    // 加载 bridge 及之后的所有冻结文件
    for (let i = bridgeIdx; i < frozen.length; i++) {
      const msgs = await readJsonl<Message>(frozen[i]);
      recentMessages.push(...msgs);
    }
  } else if (frozen.length === 1) {
    // 只有一个冻结文件，没有 summary，全部加载
    const msgs = await readJsonl<Message>(frozen[0]);
    recentMessages.push(...msgs);
  }

  // 加载 current 文件
  const currentFile = join(threadDir, 'messages-current.jsonl');
  const currentMsgs = await readJsonl<Message>(currentFile);
  recentMessages.push(...currentMsgs);

  if (summaryParts.length === 0 && recentMessages.length === 0 && !inMemorySuffix) {
    return '';
  }

  // 组装：Summary → Recent Messages → 内存增量
  const parts: string[] = [];
  if (summaryParts.length > 0) {
    parts.push(summaryParts.join('\n\n'));
  }
  if (recentMessages.length > 0) {
    parts.push(serializeMessages(recentMessages));
  }
  if (inMemorySuffix) {
    parts.push(inMemorySuffix);
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/storage/context.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/storage/context.ts tests/unit/storage/context.test.ts
git commit -m "feat: add assembleContext for three-layer context loading"
```

---

### Task 3: 改造 `loadThreadHistory` 使用新组装逻辑

**Files:**
- Modify: `src/storage/thread.ts`
- Modify: `tests/unit/storage/thread.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/storage/thread.test.ts` 中添加：

```typescript
it('loadThreadHistory loads bridge + current, not all frozen files', async () => {
  // 创建 4 个冻结文件 + current，其中 001 和 002 有 summary
  // 应只加载 bridge(003) + 004 + current
  // ...
});
```

具体测试代码需要根据现有 `thread.test.ts` 的 fixture 模式编写。

- [ ] **Step 2: 修改 `loadThreadHistory`**

将 `thread.ts` 的 `loadThreadHistory` 改为调用 `assembleContext`：

```typescript
import { assembleContext } from './context.js';

export async function loadThreadHistory(threadDir: string): Promise<string> {
  return assembleContext(threadDir);
}
```

- [ ] **Step 3: 更新现有 thread 测试，运行全部通过**

```bash
npx vitest run tests/unit/storage/thread.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/storage/thread.ts tests/unit/storage/thread.test.ts
git commit -m "refactor: loadThreadHistory uses assembleContext for spec-compliant loading"
```

---

### Task 4: 改造 `loop.ts` 使用每轮从磁盘组装

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/unit/agent/loop.test.ts`

这是核心改动。当前 `execute()` 在内存中 append messages，改为每轮从磁盘组装。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/agent/loop.test.ts` 中添加：

```typescript
it('messages are assembled from disk each turn, not pure append', async () => {
  // 验证：当磁盘上有 frozen + summary 时，
  // 下一轮的 messages 包含 summary 而非原始 frozen 文件内容
});
```

- [ ] **Step 2: 修改 `execute()` 的 messages 构建逻辑**

核心改动点：

**Before（当前）：**
```typescript
let messages = this.conversationHistory + `[User]\n${userMessage}\n\n`;
// ... 不断 append
messages += `[Assistant]\n...`;
messages += `[Tool Call: ...]`;
messages += `[Tool Result: ...]`;
```

**After（改后）：**
```typescript
import { assembleContext } from '../storage/context.js';

// execute() 中：
let inMemory = ''; // 本轮尚未落盘的增量

for (let turn = 1; turn <= maxRounds; turn++) {
  // 每轮从磁盘组装 + 内存增量
  const diskContext = options.threadDir
    ? await assembleContext(options.threadDir, inMemory)
    : this.conversationHistory;
  const messages = diskContext + `[User]\n${userMessage}\n\n` + inMemory;

  // ... callLlm, handleResponse, executeToolCall ...

  // 追加到 inMemory（同时也落盘到 JSONL）
  if (response.text) {
    inMemory += `[Assistant]\n${response.text}\n\n`;
  }
  for (const tc of response.tool_calls!) {
    inMemory += `[Tool Call: ${tc.name}](${tc.arguments})\n\n`;
    const { resultStr } = ...;
    inMemory += `[Tool Result: ${tc.name}]\n${resultStr}\n\n`;
  }

  // postTurn 中 checkAndFreeze/checkAndSummarize 写磁盘
  // 下一轮 assembleContext 自动感知新的 frozen/summary
  inMemory = ''; // freeze 后清空内存增量（已落盘到 current）
}
```

- [ ] **Step 3: 移除 `postTurn` 中的暴力截断**

删除 `loop.ts:198-206` 的截断逻辑。因为 `assembleContext` 按 spec 加载 bridge + current，天然不超预算。

保留一个简化的安全检查：如果组装后仍超预算（极端边界情况），记录 warning 日志但不做截断，让 LLM 自己处理。

- [ ] **Step 4: 更新现有 loop 测试，运行全部通过**

```bash
npx vitest run tests/unit/agent/loop.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/loop.ts tests/unit/agent/loop.test.ts
git commit -m "refactor: loop assembles context from disk each turn per spec"
```

---

### Task 5: 集成测试验证

- [ ] **Step 1: 运行全量测试**

```bash
npx vitest run
```

确保所有 240+ 测试通过。

- [ ] **Step 2: 手动集成测试**

启动 `pc2 chat`，进行长对话（触发 freeze），验证：
1. `checkAndFreeze` 正常触发
2. `checkAndSummarize` 正常触发
3. 不再出现 `Context truncated` 警告
4. Summary 内容出现在后续对话中

- [ ] **Step 3: 最终 Commit**

```bash
git commit -m "fix: implement spec-compliant context assembly, eliminate runtime truncation"
```

---

## 3. 注意事项

1. **`inMemory` 增量的生命周期**：本轮 turn 中 appendMessage 写入 current.jsonl 后，inMemory 的内容在下一轮 assembleContext 时会通过 readJsonl(currentFile) 自动包含。所以 freeze 后需要清空 inMemory，避免重复。

2. **`resumeHistory` 的兼容性**：`loadThreadHistory` 改用 `assembleContext` 后，resume 行为自动符合 spec。

3. **无 threadDir 的情况**：sub-agent 没有 threadDir，仍使用内存 append 模式。这是合理的——sub-agent 生命周期短（15 rounds max），不会超预算。

4. **暴力截断的移除时机**：只有当 Task 2 的 `assembleContext` 和 Task 4 的 loop 改造都完成后，才能移除截断。不要提前移除。
