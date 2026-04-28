# Loop Refactor & Bugfixes Spec

## 1. loop.ts `execute` 方法拆分

**现状：** `execute` 方法 208 行，违反 AGENTS.md ≤ 50 行规则。

**拆分方案：**

```
execute()        ~40行  主循环编排
├─ callLlm()     ~30行  调BAML + BamlValidationError重试 + 日志
├─ handleResponse() ~25行  处理assistant文本 + 写jsonl + yield事件
├─ executeToolCall() ~35行  单个tool dispatch + 反循环检测 + 写jsonl + shouldExit
└─ postTurn()    ~25行  turnEndCallback + anti-loop + freeze/summarize + context truncate
```

**约束：** 所有子方法是 `private async *`（返回 AsyncGenerator<AgentEvent>），因为它们需要 yield 事件。

**共享可变状态：** `messages`, `lastAssistantText`, `consecutiveFailures`, `lastFailedTool` 通过闭包在 `execute()` 内声明，子方法直接读写。不通过参数/返回值传递。

**各方法职责与签名：**

```
callLlm(turn, messages, toolsDesc, skillsList, sopsList, contextBlock, relevantMemory)
  → yield warning（非BamlValidationError的重试提示）
  → return ChatResponse | null（null表示彻底失败，已yield done）

handleResponse(turn, response, threadDir)
  → yield text
  → 修改 messages += assistant文本
  → 修改 lastAssistantText
  → 写 appendMessage(threadDir, 'assistant', ...)（仅当 response.text 非空）
  → return boolean（是否有 tool_calls）

executeToolCall(turn, tc, threadDir, options)
  → yield tool_call, tool_result
  → 修改 messages += tool call + tool result
  → 修改 consecutiveFailures, lastFailedTool
  → 写 appendMessage(threadDir, 'tool', ...)
  → 检查 shouldExit → yield done, return true
  → return boolean（shouldExit）

postTurn(turn, response, options, ...)
  → yield warning（anti-loop提示）
  → 修改 messages += system warning
  → freeze/summarize（无yield）
  → context truncate → yield warning
  → 修改 messages（truncation）
```

**留在 execute() 中的逻辑：**
- 超时检查（`Date.now() - startTime > timeoutMs`）
- Memory query（`options.lmdClient.queryMemory`）
- contextBlock/relevantMemory 构建

## 2. `appendMessage` 统一

**现状：** 3处 `appendJsonl` 写 `messages-current.jsonl`，ID 规则不一致，timestamp 各自生成。

**方案：** 在 `src/storage/jsonl.ts` 新增 `appendMessage(dir, role, content, opts?)`:
- ID: `msg_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`（无状态，无需计数器）
- timestamp 在方法内部生成
- `toolCalls` / `toolCallId` 通过 opts 传入

```ts
import { randomBytes } from 'crypto';
import type { Message, ToolCall } from '../types.js';

export async function appendMessage(
  dir: string,
  role: Message['role'],
  content: string,
  opts?: { toolCalls?: ToolCall[]; toolCallId?: string },
): Promise<void> {
  const id = `msg_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  await appendJsonl(join(dir, 'messages-current.jsonl'), {
    id, role, content,
    timestamp: new Date().toISOString(),
    ...opts,
  } satisfies Message);
}
```

`appendJsonl` 保留导出（其他文件如 dream.ts 也使用）。`loop.ts` 中 `import { appendJsonl }` 替换为 `import { appendMessage }`。

仅在 `response.text` 非空时才调用 `appendMessage(threadDir, 'assistant', ...)`。

## 3. readMultiline echo 修复

**现状：** Enter 提交时，`cleanup()` 写 `\n`，但之前 render 的 prompt+buffer 内容留在屏幕上，造成"重复打印"。

**方案：** `cleanup()` 中：
1. 先 move up by `previousVisualLines`
2. Clear from cursor to end of screen (`\x1b[J`)
3. 提交时：写 `prompt + buffer + \n`（保留用户输入作为历史）
4. Ctrl+C 时：只写 `\n`（不保留输入）

## 4. BamlValidationError 自动重试

**现状：** BAML client 已有 `retry_policy Exponential` 处理网络错误，但 `BamlValidationError`（返回格式不符合 schema）是解析错误，BAML retry 不覆盖。当前代码把原始错误暴露给用户。

**方案：** 在 `callLlm()` 中统一处理所有错误：

```
callLlm():
  for attempt 0..2:
    try: return b.AgentChat()
    catch BamlValidationError:
      logo.warn('LLM parse error', { turn, attempt })
      if attempt < 2: continue (静默重试)
      else: yield warning "LLM response format error, please retry.", yield done, return null
    catch other:
      logo.warn('LLM call failed', { turn, error })
      yield warning "LLM call failed, retrying..."
      try one more time
      if still fails: yield warning (简短), yield done, return null
```

- BamlValidationError: 最多 3 次调用（2 次重试），静默，只写日志
- 其他错误: 1 次重试，yield 简短提示，不暴露原始错误
- 错误类名: `BamlValidationError` 来自 `@boundaryml/baml`

## 5. 日志时间格式

**现状：** `formatTimestamp()` 用 `sv-SE` locale 产生 `2026-04-27 13:05:21.821`（空格分隔，带毫秒）。时区硬编码 `Asia/Shanghai`（符合 AGENTS.md "所有时间使用东8区"）。

**方案：** 改为 `2026-04-27T13:05:21`（T 分隔，无毫秒）。保持东8区。

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

## 6. Web Search URL 可配置

**现状：** `http://127.0.0.1:5001` 硬编码在 `src/tools/web-search.ts`。

**方案：** 在 `src/config.ts` 新增：
```ts
webSearchUrl: process.env.WEB_SEARCH_URL ?? 'http://127.0.0.1:5001',
```

`web-search.ts` 从 config 读取 URL。
