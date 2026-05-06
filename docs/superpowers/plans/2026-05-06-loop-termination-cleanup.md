# Loop Termination Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent loop 终止模型改动的三处遗留问题：删除死代码、调阈值、收紧类型

**Architecture:** 三个独立改动，无依赖关系，可并行执行。涉及 3 个源文件 + 测试。

**Tech Stack:** TypeScript, Vitest

---

### Task 1: 删除 turn-end-callback.ts Priority 1 死代码

**Files:**
- Modify: `src/agent/turn-end-callback.ts:29-33`

loop.ts 在 postTurn 之前就执行 anti-loop 检查并退出，所以 turnEndCallback 的 Priority 1 分支永不会触发。删除该分支。

- [ ] **Step 1: 删除 Priority 1 分支**

```typescript
// Replace lines 29-33:
export function turnEndCallback(turn: number, ctx: CallbackContext): string | null {
  // Priority 1: consecutive tool failures — most urgent anti-loop signal
  if (ctx.consecutiveFailures >= config.antiLoopThreshold && ctx.lastFailedTool) {
    return `[Anti-Loop] Tool "${ctx.lastFailedTool}" has failed ${ctx.consecutiveFailures} times consecutively. You MUST use a completely different approach or use ask_user to ask for guidance. Do NOT call ${ctx.lastFailedTool} again.`;
  }

  // Priority 2: periodic anti-loop check

// With:
export function turnEndCallback(turn: number, ctx: CallbackContext): string | null {
  // Priority 1: periodic anti-loop check (consecutive-failure exit handled in loop.ts)
```

- [ ] **Step 2: 运行 typecheck**

```bash
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 运行测试**

```bash
npx vitest run
```
Expected: 301 passed（1 pre-existing LMD error）

---

### Task 2: 调整 config.ts 阈值

**Files:**
- Modify: `src/config.ts:20,24`

`maxRounds=1000` 但 `forceAskUserTurn=25`（2.5%）和 `dangerTurnThreshold=60`（6%）过低。调整到 5% 和 20%。

- [ ] **Step 1: 修改阈值**

```typescript
// Line 19-20: Replace
  // Force ask_user injection after this many turns — prevents agent from running indefinitely
  forceAskUserTurn: 25,

// With:
  // Force ask_user injection after this many turns — prevents agent from running indefinitely
  // 5% of maxRounds — requires agent to report progress, 95% budget remaining
  forceAskUserTurn: 50,
```

```typescript
// Line 23-24: Replace
  // Danger turn threshold: hard stop with warning
  dangerTurnThreshold: 60,

// With:
  // Danger turn threshold: hard stop with warning
  // 20% of maxRounds — alerts the user, 80% budget remaining for continuation or abort
  dangerTurnThreshold: 200,
```

- [ ] **Step 2: 运行 typecheck**

```bash
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: 运行测试**

```bash
npx vitest run
```
Expected: 301 passed

---

### Task 3: 收紧 AgentEvent.done.reason 类型

**Files:**
- Modify: `src/agent/loop.ts:18-23`

将 `done.reason` 从 `string` 收紧为联合类型 `DoneReason`，删除已不再产出的 `'completed'`。

- [ ] **Step 1: 添加 DoneReason 类型并修改 AgentEvent**

```typescript
// Replace lines 18-23:
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string; call_id: string }
  | { type: 'tool_result'; name: string; call_id: string; result: string }
  | { type: 'warning'; content: string }
  | { type: 'done'; reason: string };

// With:
export type DoneReason = 'ask_user' | 'max_rounds' | 'timeout' | 'stalled' | 'anti_loop' | 'llm_error';

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string; call_id: string }
  | { type: 'tool_result'; name: string; call_id: string; result: string }
  | { type: 'warning'; content: string }
  | { type: 'done'; reason: DoneReason };
```

- [ ] **Step 2: 运行 typecheck 确认无类型错误**

```bash
npx tsc --noEmit
```
Expected: 无错误。如果 callLlm 等 return path 用了不在 DoneReason 中的 reason 值，tsc 会报错。

- [ ] **Step 3: 检查 chat.ts 消费者**

`src/cli/chat.ts:93-96` 的 `renderEvent` 中 done 分支只做 `spinner.stop(\`\${G}[\${event.reason}]\`)` — 字符串插值，联合类型无影响。

- [ ] **Step 4: 运行测试**

```bash
npx vitest run
```
Expected: 301 passed

---

### 最终验证

```bash
npx tsc --noEmit && npx vitest run
```
