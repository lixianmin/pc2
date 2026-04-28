# Loop Refactor & Bugfixes Spec

## 1. loop.ts `execute` 方法拆分

**现状：** `execute` 方法 208 行，违反 AGENTS.md ≤ 50 行规则。

**拆分方案：**

```
execute()        ~40行  主循环编排
├─ callLlm()     ~30行  调BAML + BamlValidationError重试 + 日志
├─ handleResponse() ~25行  处理assistant文本 + 写jsonl + yield事件
├─ executeToolCall() ~35行  单个tool dispatch + 反循环检测 + 写jsonl
└─ postTurn()    ~25行  turnEndCallback + anti-loop + freeze/summarize + context truncate
```

**约束：** 所有子方法是 `private async *`（返回 AsyncGenerator），因为它们需要 yield 事件。`callLlm` 也用 generator 因为可能 yield warning。

## 2. `appendMessage` 统一

**现状：** 3处 `appendJsonl` 写 `messages-current.jsonl`，ID 规则不一致（`msg_u_${Date.now()}`, `msg_${turn}_a`, `msg_${turn}_t_${tc.id}`），timestamp 各自生成。

**方案：** 在 `src/storage/jsonl.ts` 新增 `appendMessage(dir, role, content, opts?)`:
- ID 统一为 `msg_${递增seq}_${Date.now().toString(36)}`
- timestamp 在方法内部生成
- `toolCalls` / `toolCallId` 通过 opts 传入

`loop.ts` 的 3 处调用替换为：
```ts
await appendMessage(threadDir, 'user', userMessage);
await appendMessage(threadDir, 'assistant', response.text, { toolCalls });
await appendMessage(threadDir, 'tool', resultStr, { toolCallId: tc.id });
```

## 3. readMultiline echo 修复

**现状：** Enter 提交时，`cleanup()` 写 `\n`，但之前 render 的 prompt+buffer 内容留在屏幕上，造成"重复打印"。

**方案：** `cleanup()` 中，提交前先清除当前渲染区域（move up + clear），再写最终内容 + `\n`。Ctrl+C 时同样清除（不写 buffer 内容，只写换行）。

## 4. BamlValidationError 自动重试

**现状：** BAML client 已有 `retry_policy Exponential` 处理网络错误，但 `BamlValidationError`（返回格式不符合 schema）是解析错误，BAML retry 不覆盖。当前代码把原始错误暴露给用户。

**方案：**
- 在 `callLlm()` 中，catch `BamlValidationError` 时重试最多 2 次（总共 3 次调用）
- 重试间不 yield warning 给用户（静默重试）
- 错误信息只写 `logo.warn` 日志
- 全部重试失败后，yield 简短提示 `"LLM response format error, please retry."`（不暴露技术细节）

## 5. 日志时间格式

**现状：** `formatTimestamp()` 用 `sv-SE` locale 产生 `2026-04-27 13:05:21.821`（空格分隔，带毫秒）。

**方案：** 改为 `2026-04-27T13:05:21`（T 分隔，无毫秒）。直接拼接 ISO 8601 格式，不再依赖 locale。

## 6. Web Search URL 可配置

**现状：** `http://127.0.0.1:5001` 硬编码在 `src/tools/web-search.ts`。

**方案：** 在 `src/config.ts` 新增 `webSearchUrl` 配置项，默认值 `http://127.0.0.1:5001`。从环境变量 `WEB_SEARCH_URL` 读取。`web-search.ts` 从 config 读取 URL。
