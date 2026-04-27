# /sessions 命令设计

## 目标

chat 模式下支持 `/sessions` 列出历史会话、`/resume <N>` 恢复历史会话继续对话。

## 背景

当前每次 `pc2 chat` 启动都创建全新 thread，进程退出后 `AgentLoop.conversationHistory` 丢失。已有 JSONL 持久化和 freeze/summary 管线，但缺少：用户消息持久化、thread 元数据、恢复机制。

## 设计

### 1. 补齐用户消息持久化

**文件**: `src/agent/loop.ts`

在 `execute()` 开头，当 `options.threadDir` 存在时，追加 `{ role: 'user', content: userMessage }` 到 JSONL。

### 2. Thread 元数据

**文件**: `src/storage/thread.ts` (新)

每个 thread 目录新增 `meta.json`:

```json
{
  "id": "2026-04-27-14-30-28",
  "createdAt": "2026-04-27T14:30:28+08:00",
  "lastActivityAt": "2026-04-27T14:35:00+08:00",
  "messageCount": 12,
  "preview": "帮我去查一下 GitHub Trending..."
}
```

- `preview`: 第一条用户消息前 80 字符
- `messageCount` + `lastActivityAt`: 每次 `execute()` 结束时更新

API:

- `writeMeta(threadDir, meta)`: 创建 meta.json
- `updateMeta(threadDir, patch)`: 部分更新 meta.json
- `readMeta(threadDir)`: 读取 meta.json
- `listThreads(dataDir, limit?)`: 按 lastActivityAt 降序返回 thread 列表
- `loadThreadHistory(threadDir)`: 加载所有 frozen + current JSONL，调用 `serializeMessages()` 返回 string

### 3. REPL 命令

**文件**: `src/cli/chat.ts`

在 readline 输入处理中添加命令识别：

| 输入 | 行为 |
|------|------|
| `/sessions` | 列出最近 10 个 session |
| `/resume <N>` | 恢复第 N 个 session |
| `exit` / `quit` | 退出 |
| 其他 | 作为用户消息发给 AgentLoop |

`/sessions` 输出格式:

```
Recent sessions:
  #1  04-27 14:30  (12 msg)  帮我去查一下 GitHub Trending...
  #2  04-27 13:20  (5 msg)   安河家园到北京南站怎么走

Enter # to resume, or Enter to cancel:
```

### 4. Session 恢复流程

1. 用户输入 `/resume 1`
2. `listThreads()` 获取列表，找到第 1 个
3. `loadThreadHistory(threadDir)` 加载 JSONL → `serializeMessages()` → string
4. `loop.resumeHistory(historyString)` 设定 `conversationHistory`
5. 后续 `execute()` 自动拼接到此 history 上
6. 切换到该 thread 目录，后续 JSONL 写入恢复的 thread

**文件**: `src/agent/loop.ts` 新增方法:

```typescript
resumeHistory(history: string): void {
  this.conversationHistory = history;
}
```

### 5. 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/storage/thread.ts` | 新文件: listThreads, loadThreadHistory, writeMeta, updateMeta, readMeta |
| `src/agent/loop.ts` | execute() 追加 user message 到 JSONL; 新增 resumeHistory() |
| `src/cli/chat.ts` | REPL 命令解析; /sessions, /resume |
| `tests/integration/session.test.ts` | 新文件: session 恢复集成测试 |
| `tests/unit/storage/thread.test.ts` | 新文件: thread 模块单元测试 |

### 6. 约束

- 所有时间使用东八区 (config.timezone)
- `loadThreadHistory` 加载全部消息，由 token budget 自动截断保护
- 不删除 session，只列出和恢复
- `/sessions` 和 `/resume` 只在 chat REPL 中可用，不是子命令
