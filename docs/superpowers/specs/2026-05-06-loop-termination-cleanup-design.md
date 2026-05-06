# Loop Termination Model — Post-Review Cleanup

## 背景

上一轮修改了 Agent loop 终止模型：
- `maxRounds: 30 → 1000`
- `!hasTools` 不再终止循环，改为连续 3 轮无工具调用才 `stalled` 退出
- `consecutiveFailures >= 3` → `anti_loop` 硬退出（在 `postTurn` 之前执行）

代码 review 发现三处遗留问题。

---

## 1. 删除 turn-end-callback.ts 中的死代码

**现状：** `turnEndCallback` Priority 1 检查 `ctx.consecutiveFailures >= 3` 并返回反循环警告。但 `loop.ts` 在 `postTurn` 之前就检查了同一条件并 `anti_loop` 退出，因此该分支永不会被执行。

**改动：** 删除 `turn-end-callback.ts` 中 Priority 1 分支（第 31-33 行）。保留 Priority 2（周期性提示）、Priority 3（完成声明/计划提醒）、Priority 4（危险轮数阈值）。

**文件：** `src/agent/turn-end-callback.ts`

---

## 2. 调整 config.ts 阈值

**现状：** `dangerTurnThreshold: 60`、`forceAskUserTurn: 25`，但 `maxRounds` 已改为 1000。60 轮（6%）就打印 DANGER 太早，25 轮（2.5%）就强制 ask_user 太激进。

**改动：**

```typescript
dangerTurnThreshold: 200,  // 20% 时告警 — 仍有 4/5 的预算可继续
forceAskUserTurn: 50,      // 5% 时首次要求汇报 — 留有 95% 预算
```

**文件：** `src/config.ts`

---

## 3. 收紧 AgentEvent.done.reason 类型

**现状：** `done` 事件的 `reason` 字段是 `string`。新增的 `'stalled'`、`'anti_loop'` 没有被类型约束，`'completed'` 已不再产出但类型仍允许。

**改动：** 将 `reason` 从 `string` 改为联合类型 `DoneReason`，删除 `'completed'`：

```typescript
export type DoneReason =
  | 'ask_user'
  | 'max_rounds'
  | 'timeout'
  | 'stalled'
  | 'anti_loop'
  | 'llm_error';

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string; call_id: string }
  | { type: 'tool_result'; name: string; call_id: string; result: string }
  | { type: 'warning'; content: string }
  | { type: 'done'; reason: DoneReason };
```

**文件：** `src/agent/loop.ts`（类型定义）

---

## 影响范围

- `src/agent/loop.ts` — 类型定义 + callLlm 中的 `done: 'llm_error'` + 所有 `yield { type: 'done', reason: ... }` 语句
- `src/agent/turn-end-callback.ts` — 删除 Priority 1 分支
- `src/config.ts` — 两个阈值
- 测试文件 — 如果有断言 `done: 'completed'` 的测试需更新为 `'stalled'`（已完成）
- `chat.ts` — `renderEvent` 中的 done 事件展示逻辑无变化（只打印 reason 字符串）
