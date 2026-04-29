# logo — TypeScript 日志库设计

> **状态**：Approved

## 1. 概述

为 pc2 项目实现一个轻量级 TypeScript 日志库 `logo`，参考 Go 版 [lixianmin/logo](https://github.com/lixianmin/logo) 的核心设计。零第三方依赖，使用 Node.js 标准库 `fs` + `stream`。

**目标**：
- 全路径追踪 agent 执行流程，支持事后调试和性能分析
- 按级别分文件，rolling 归档，不搞乱 TUI 界面
- 人可读的纯文本格式，方便 grep/awk 程序化分析

## 2. 文件结构

```
src/lib/
  logo.ts                    # Logger 类 + RollingFileWriter + singleton export
tests/unit/lib/
  logo.test.ts               # Logger 格式、级别过滤、rolling 归档测试
```

单文件实现，~150 行。不需要拆分——职责清晰，单文件足够。

## 3. 核心 API

```typescript
enum LogLevel { Debug = 1, Info = 2, Warn = 3, Error = 4 }

interface LogoOptions {
  logDir?: string;         // default: 'logs'
  maxFileSize?: number;    // default: 10 * 1024 * 1024 (10MB)
  maxArchives?: number;    // default: 5
  console?: boolean;       // default: true (non-TUI mode); chat 模式设为 false
  level?: LogLevel;        // default: LogLevel.Info
}

class Logo {
  init(opts?: LogoOptions): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  close(): void;           // flush 所有 writer
}

export const logo: Logo;   // singleton
```

### init() 调用时机

- `cli/chat.ts` — `logo.init({ console: false })`，TUI 模式不写 console
- `cli/index.ts` reflect start — `logo.init({ console: true })`
- 不调用 `init()` 时：默认 console=true，logDir='logs'，level=Info

## 4. 日志格式

```
2026-04-27 14:30:00.123 loop.ts:47 [I] LLM call completed tokens=150 latency_ms=1200
```

字段说明：
- **时间**：`YYYY-MM-DDTHH:mm:ss`，UTC+8（遵循 AGENTS.md 时区规则，T 分隔符无毫秒）
- **调用位置**：`filename:line`，从 `Error.stack` 提取，跳过 `logo.ts` 自身帧
- **级别**：`[D]` `[I]` `[W]` `[E]`
- **消息**：msg 参数 + args 序列化拼接
  - 基本类型（string/number/boolean）：直接拼接
  - 对象/数组：`JSON.stringify(obj)`
  - Error：提取 message + stack

### caller info 提取

```typescript
private getCallerInfo(): { file: string; line: number } {
  const err = new Error();
  const lines = err.stack?.split('\n') || [];
  for (const line of lines) {
    const match = line.match(/at .+ \((.+):(\d+):\d+\)/);
    if (match) {
      const [, filePath, lineNum] = match;
      const file = path.basename(filePath);
      if (file !== 'logo.ts') {
        return { file, line: parseInt(lineNum, 10) };
      }
    }
  }
  return { file: 'unknown', line: 0 };
}
```

## 5. 文件组织

```
logs/
├── info.log          # INFO + DEBUG 级别
├── warn.log          # WARN + ERROR（级联写入）
├── error.log         # ERROR only
└── archive/
    ├── info2026-04-27_001.log
    ├── info2026-04-27_002.log
    └── ...
```

### 级联规则

| 调用方法 | 写入文件 |
|---------|---------|
| `error()` | error.log + warn.log + info.log |
| `warn()` | warn.log + info.log |
| `info()` | info.log |
| `debug()` | info.log |

### Rolling 策略

- 单文件超过 `maxFileSize`（默认 10MB）时触发归档
- 归档操作：`logs/info.log` → `logs/archive/info2026-04-27_001.log`
- 序号递增：同一日期内按 `_001`, `_002`, `_003` 递增
- 检查频率：每写入 1024 条检查一次文件大小（避免每次 fsync 后 stat）
- 归档上限：`maxArchives`（默认 5），超出删除最旧归档
- `archive/` 目录不存在时自动创建

### RollingFileWriter 实现

```typescript
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

  private async checkRolling(): Promise<void> {
    try {
      const stat = await fs.promises.stat(this.filePath);
      if (stat.size >= this.maxFileSize) {
        await this.roll();
      }
    } catch {}
  }

  private async roll(): Promise<void> {
    // 关闭当前 stream
    this.stream?.end();
    this.stream = null;
    // 生成归档文件名
    const archiveDir = path.join(path.dirname(this.filePath), 'archive');
    await fs.promises.mkdir(archiveDir, { recursive: true });
    const baseName = path.basename(this.filePath, '.log'); // e.g. 'info'
    const date = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
    let seq = 1;
    while (fs.existsSync(path.join(archiveDir, `${baseName}${date}_${String(seq).padStart(3, '0')}.log`))) {
      seq++;
    }
    const archivePath = path.join(archiveDir, `${baseName}${date}_${String(seq).padStart(3, '0')}.log`);
    await fs.promises.rename(this.filePath, archivePath);
    // 清理旧归档
    await this.cleanOldArchives(archiveDir, baseName);
  }

  private async cleanOldArchives(archiveDir: string, baseName: string): Promise<void> {
    const files = await fs.promises.readdir(archiveDir);
    const archives = files
      .filter(f => f.startsWith(baseName))
      .sort();
    while (archives.length > this.maxArchives) {
      const toDelete = archives.shift()!;
      await fs.promises.unlink(path.join(archiveDir, toDelete));
    }
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
```

注意：不使用 `dayjs`，直接手动构造 UTC+8 时间字符串，格式 `YYYY-MM-DDTHH:mm:ss`。

## 6. Console 行为

- `console: true`（默认）—— 写 stderr（不干扰 stdout 的 TUI 输出）
- `console: false`（chat 模式）—— 不写 console，只写文件
- Console 输出带 ANSI 颜色：`[D]` 灰色, `[I]` 白色, `[W]` 黄色, `[E]` 红色
- Console 只写当前级别，不做级联（文件才级联）

## 7. pc2 集成点

### 7.1 配置

`src/config.ts` 新增：
```typescript
logDir: 'logs',
logLevel: LogLevel.Info,
logMaxFileSize: 10 * 1024 * 1024,
```

### 7.2 集成点清单

| 位置 | 记录内容 | 级别 |
|------|----------|------|
| **Agent Loop** (`loop.ts`) | | |
| turn 开始 | turn number, user message length | DEBUG |
| LLM 调用完成 | token count, latency ms, response text length | INFO |
| LLM 重试 | 重试原因, 是第几次重试 | WARN |
| LLM 最终失败 | error message | ERROR |
| tool call 开始 | tool name, args length | INFO |
| tool call 完成 | tool name, latency ms, result length | INFO |
| tool call 异常 | tool name, error message | ERROR |
| freeze 触发 | frozen 文件名, token count | INFO |
| summarize 触发 | 源文件, 输出文件 | INFO |
| context truncation | 截断前行数, 保留行数 | WARN |
| loop 结束 | reason, 总 turn 数, 总耗时 ms | INFO |
| **Storage** (`tokens.ts`) | | |
| encoder 首次加载 | tiktoken 初始化完成 | DEBUG |
| **Storage** (`summary.ts`) | | |
| freeze 完成 | frozen 文件名, message 数量 | INFO |
| freeze 并发序列化 | 并发调用被排队 | DEBUG |
| summarize 完成 | 源文件, 输出文件, summary 长度 | INFO |
| **Reflect** (`runner.ts`) | | |
| module check | module name, 是否产出 task | DEBUG |
| module check 异常 | module name, error | ERROR |
| task 消费 | task content | INFO |
| task 消费异常 | error | ERROR |
| **Memory** (`lmd-client.ts`) | | |
| query 请求 | query length | DEBUG |
| query 成功 | latency ms, hit count | INFO |
| query 失败 | error message, 降级处理 | WARN |
| add 请求 | content type, content length | DEBUG |
| add 成功 | memory id, latency ms | INFO |
| add 失败 | error message | ERROR |
| 重试 | attempt number, delay ms | WARN |
| **CLI** (`cli/index.ts`) | | |
| 命令启动 | command name, 配置摘要 | INFO |
| **Skills** (`loader.ts`) | | |
| skill 加载 | name, path, evolvable | DEBUG |
| skill 加载失败 | path, error | WARN |

### 7.3 替换现有 console.*

将现有 8 个 `console.log/error` 调用全部替换为 `logo.info/error`：

| 文件 | 原调用 | 替换为 |
|------|--------|--------|
| `cli/index.ts:32` | `console.log('[reflect] executing: ...')` | `logo.info('[reflect] executing: ...')` |
| `cli/index.ts:35` | `console.log('Reflect started...')` | `logo.info('Reflect started...')` |
| `cli/index.ts:50` | `console.log('Reflect status...')` | `logo.info('Reflect status...')` |
| `cli/index.ts:62` | `console.log('Added memory: ...')` | `logo.info('Added memory: ...')` |
| `cli/index.ts:72` | `console.log('[r.type] ...')` | `logo.info(...)` |
| `runner.ts:24` | `console.error('[reflect] module ...')` | `logo.error('[reflect] module ...')` |
| `runner.ts:48` | `console.log('[reflect] task: ...')` | `logo.info('[reflect] task: ...')` |
| `runner.ts:51` | `console.error('[reflect] task error: ...')` | `logo.error('[reflect] task error: ...')` |

### 7.4 chat.ts init

`src/cli/chat.ts` 启动时调用：
```typescript
import { logo } from '../lib/logo.js';
import { LogLevel } from '../lib/logo.js';

logo.init({ console: false, level: LogLevel.Info });
```

### 7.5 JSONL 补全

当前 JSONL 缺少 user message。在 `loop.ts` 中补写：
```typescript
if (options.threadDir) {
  await appendJsonl(
    join(options.threadDir, 'messages-current.jsonl'),
    { id: `msg_${turn}_u`, role: 'user', content: userMessage,
      timestamp: new Date().toISOString() } satisfies Message,
  );
}
```

但这只在 turn 1 时写入（后续 turn 用户消息不变，不应重复写入）。实际上用户消息只在首轮写入一次。

## 8. 测试

### 8.1 单元测试（`tests/unit/lib/logo.test.ts`）

- 格式化输出匹配 `YYYY-MM-DDTHH:mm:ss filename:line [X] message` 正则
- 级别过滤：`level=Warn` 时 debug/info 不写入
- 级联写入：error 调用写入 3 个文件，warn 写入 2 个
- Rolling：mock 文件大小超过阈值后归档
- Console 控制：`console: false` 时不写 stderr
- caller info：验证提取的 filename 不包含 'logo.ts'
- close() 后写入不崩溃

### 8.2 集成测试

- `loop.test.ts`：验证每个 turn 产生至少一条 INFO 日志
- 现有测试不受影响（logo init 在 test 外）

## 9. 不做的事

- **异步写入**：V1 同步写入即可。pc2 是 CLI 工具，不是高并发服务，同步写入简单可靠
- **钉钉/飞书 hook**：个人项目不需要
- **日志加密**：不需要
- **远程日志**：不需要
- **logrotate 依赖**：自己做 rolling，不依赖系统工具
