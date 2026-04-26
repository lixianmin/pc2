# Memory and Context Design

本文档定义 pc2 的记忆与上下文系统。这是 agent 最核心的子系统。

主 spec (`2026-04-25-personal-agent-design.md`) 中 Section 6 (Memory)、Section 7 (Summary)、Section 8 (Dream) 的内容以此文档为准。

---

## 1. 设计原则

1. **LMD 的唯一写入路径是 Dream**。对话过程中不直接写 LMD。避免双路径冲突。
2. **数据不丢失**。所有原始对话永久保留在磁盘。Summary 是附加信息，不是替代品。Summary 文件在 Dream 处理后保留（rename 为 `.lmd.md`），不删除。
3. **Summary 与 Last N 不重叠**。Summary 覆盖已冻结的旧文件，bridge 冻结文件和 current 文件构成 Last N。两者在逻辑上是对消息的不重叠分割。
4. **阈值基于 token，不基于消息数**。不同消息长度差异大，token 是更准确的度量。
5. **简单优先**。个人项目，一条路径胜过两条。
6. **Summary 和 LMD 记忆不重叠**。已被 Dream 处理的 summary 不再进入 LLM context。同一份知识在 context 中只出现一次。
7. **不超预算**。所有 token 计算从 model_context_window 推导，保证任何状态下不超出 context window。

---

## 2. 三层存储模型

```
┌──────────────────────────────────────────────────────┐
│ Layer 1: Recent Messages (JSONL)                      │
│ "刚才具体说了什么"                                     │
│ 存储：messages-current.jsonl (活跃)                    │
│       messages-{N}.jsonl (冻结，其中一个是 bridge)      │
│ 生命周期：永久落盘                                     │
│ 进入 LLM：bridge 冻结文件(完整) + current 文件          │
├──────────────────────────────────────────────────────┤
│ Layer 2: Conversation Summary (Markdown)              │
│ "之前聊了什么（压缩叙述）"                              │
│ 存储：summaries/{N}.md (未处理)                         │
│       summaries/{N}.lmd.md (已处理到 LMD)              │
│ 生命周期：当存在 3+ 冻结文件时生成，Dream 处理后 rename  │
│ 进入 LLM：System Message 2（仅 .md 文件）              │
├──────────────────────────────────────────────────────┤
│ Layer 3: Long-term Memory (LMD)                      │
│ "长期积累了什么知识"                                   │
│ 存储：LMD 外部 daemon（fact/episode/relation）         │
│ 生命周期：fact=永久 / episode=衰减 / relation=版本化   │
│ 进入 LLM：Dynamic Tail 中的 Relevant Memory 区         │
│ 唯一写入路径：Dream                                    │
└──────────────────────────────────────────────────────┘
```

### Token 预算分配

所有数值从模型 context window 推导。**条数永远不硬编码，由 token 预算在运行时决定。**

```
唯一可配置项：model_context_window (e.g., 100K tokens)

固定开销：
  system_prompt     = ~1500 tokens (身份 + 指令 + 工具 + skill 元数据 + SOP 索引)
  dynamic_tail      = ~500 tokens (时间 + memory query + 用户输入)
  fixed_total       = ~2000 tokens

可用数据预算 = model_context_window - fixed_total

数据区组成：
  summaries_total   = N * ~2500 tokens (N 个未处理 summary)
  bridge_file       = freeze_threshold tokens (一个完整冻结文件)
  current_file      ≤ freeze_threshold tokens (当前活跃文件)

预算约束（任何时刻都必须满足）：
  summaries_total + bridge_file + current_file ≤ 可用数据预算

推导：
  freeze_threshold = model_context_window * 30%
    -- 100K -> 30K tokens，触发冻结的 JSONL token 量

  最坏情况 (3 个冻结文件，第一个即将 summarize)：
    0 summaries + 2 * 30K + 30K + 2K = 92K < 100K ✓

  稳态 (1 summary + bridge + current)：
    2.5K + 30K + 30K + 2K = 64.5K < 100K ✓
```

各层回答不同的问题：

| 层 | 回答的问题 | 例子 |
|----|-----------|------|
| Recent Messages | "刚才具体说了什么？" | user: "chunker 在分页处断了" assistant: "我看一下..." |
| Conversation Summary | "之前这段对话做了什么？" | "用户要求修 PDF parser，agent 发现 chunker 分页逻辑有问题，修改后测试通过" |
| Long-term Memory | "长期积累了什么知识？" | fact: "LMD 用 sqlite-vec"; relation: "项目用 TypeScript" |

### Summary 与 LMD 记忆的互斥关系

同一份知识在 context 中只出现一次。状态由 summary 文件后缀决定：

```
summaries/{N}.md 存在（未处理）：
  System Message 2 包含此 summary
  LMD 中无对应知识
  -> 知识通过 Summary 进入 context

summaries/{N}.lmd.md 存在（已处理到 LMD）：
  System Message 2 不包含此 summary
  LMD 中已有提取的 fact/episode/relation
  -> 知识通过 LMD query 进入 Dynamic Tail

判断逻辑：扫描 summaries/ 目录，仅 .md 后缀文件进入 System Message 2。
.lmd.md 后缀文件表示已处理，保留作历史记录，不进入 context。
```

### Summary 与 Recent Messages 的不重叠保证

Summary 和 Recent Messages 在逻辑上是对原始消息的不重叠分割：

```
时间轴上的消息：

  [messages-1 冻结] [messages-2 冻结 (bridge)] [messages-current 活跃]

  Summary 覆盖:       messages-1 (已 summarize)
  Recent Messages:    messages-2 (bridge，完整) + current (完整)

  两部分不重叠。messages-2 作为 bridge 保证 Summary 和 current 之间零语义断裂。
```

### 为什么不需要 Working Memory / Task Context

generic-agent 的 Working Memory 存在是因为它故意把 context 压到 ~72K 字符并 FIFO 裁剪（不可恢复），需要一层抗裁剪的摘要。我们的设计不裁剪对话历史——bridge 冻结文件完整保留，current 文件完整保留，Summary 覆盖更早的对话，LMD 覆盖长期知识。没有信息丢失，不需要额外中间层。

---

## 3. 写入流程

### 3.1 每轮写入（Layer 1 only）

对话进行中的每轮只写 JSONL。**不写 LMD，不写中间文件。**

```
用户发消息
  │
  ├─ appendFile -> messages-current.jsonl
  │   {"role":"user","content":"...","timestamp":"..."}
  │
  ├─ LLM 回复后
  │   appendFile -> messages-current.jsonl
  │   {"role":"assistant","content":"...","toolCalls":[...],"timestamp":"..."}
  │
  └─ tool 调用结果
      appendFile -> messages-current.jsonl
      {"role":"tool","content":"...","toolCallId":"...","timestamp":"..."}
```

用户说"记住这个"或 agent 发现重要信息——这些对话内容本身就在 JSONL 中。Dream 读 JSONL 时 ExtractMemory 会自然提取出这些重要知识。不需要 highlights 文件或其他中间存储。

### 3.2 文件冻结与 Summary 触发

**两步分离**：文件冻结和 Summary 生成是分开的操作。

#### 第一步：文件冻结（达到 freeze_threshold 时）

当 `messages-current.jsonl` 的 token 量达到 `freeze_threshold`（model_context_window * 30%）：

```
messages-current.jsonl (~30K tokens)
  │
  ├─ rename 为 messages-{N}.jsonl (冻结)
  │
  └─ 创建新的空 messages-current.jsonl
```

不做 summarize。冻结文件完整保留。

#### 第二步：Summary 生成（当存在 3+ 冻结文件时）

当冻结产生新文件，且此时已有 2 个冻结文件时（共 3 个冻结文件）：

```
当前状态：messages-1, messages-2, messages-3(刚冻结), current

  ├─① BAML.SummarizeHistory(messages-1 的全部消息) -> 详细 summary
  │    输出：1500-3000 tokens 的叙述性摘要
  │    覆盖：任务、决策、代码变更、发现的信息、未解决的问题
  │
  └─② write-to-temp-then-rename -> summaries/1.md

冻结后的状态：summary-1, messages-2(bridge), messages-3, current
  bridge = messages-2（Summarize 后倒数第二个冻结文件）
```

**为什么延迟 Summarize**：
- 保证在 Summarize 和 current 之间始终有一个完整的冻结文件（bridge）作为语义桥接
- 每个 messages 文件被 100% 完整 Summarize，不做截断，没有信息损失
- Summary 和 Recent Messages 天然不重叠

#### 稳态时间线

```
T1: current 达 30% → 冻结为 messages-1，新建 current
    Context: [messages-1] [current]
    无 summary

T2: current 达 30% → 冻结为 messages-2，新建 current
    Context: [messages-1] [messages-2] [current]
    无 summary，三个完整文件

T3: current 达 30% → 冻结为 messages-3，新建 current
    → 触发 Summarize: messages-1 → summaries/1.md
    Context: [summary-1] [messages-2(bridge)] [messages-3] [current]

T4: current 达 30% → 冻结为 messages-4，新建 current
    → 触发 Summarize: messages-2 → summaries/2.md
    Context: [summary-1] [summary-2] [messages-3(bridge)] [messages-4] [current]

T5: Dream 处理 summary-1 → rename 为 1.lmd.md
    Context: [summary-2] [messages-3(bridge)] [messages-4] [current]
    知识进入 LMD，通过 Dynamic Tail 的 memory query 提供
```

#### 预算安全检查

每次冻结前，检查是否超预算：

```
预算检查（冻结前）：
  拟冻结后状态 = summaries_total + 所有冻结文件 + current + fixed_total
  if 拟冻结后状态 > model_context_window:
    先 Summarize 最老冻结文件（释放一个完整文件的预算）
    再冻结
```

### 3.3 Dream：记忆整理（Summary → LMD）

**LMD 的唯一写入路径。** 所有长期记忆都通过 Dream 写入。

#### 触发条件

Dream 是异步 Worker 线程，不阻塞主线程。触发不应该跟用户状态绑定，而应该跟**实际需求**绑定——summary 积累了就需要处理。

| 触发方式 | 条件 | 说明 |
|---------|------|------|
| **Summary 积累触发** | 未处理 summary (.md) 数量或总 token 量超过阈值 | 核心触发条件 |
| **定时检查** | 每 N 分钟（可配置）检查 summary 状态 | 兜底机制 |
| **启动触发** | `pc2 chat` 或 `pc2 reflect start` 启动时 | 处理残留 summary |

#### 什么需要 Dream 处理

只有 `.md` 后缀的 summary 文件需要处理。`.lmd.md` 已处理，跳过。

```
summaries/001.md       → 需要 Dream 处理
summaries/002.md       → 需要 Dream 处理
summaries/001.lmd.md   → 已处理，跳过
```

没有达到 freeze_threshold 就退出的对话，消息仍在 current 中，LLM 直接可见，不需要 Dream 提取。

#### 提取内容的筛选

**不是所有对话内容都值得进入长期记忆。** Dream 的 `BAML.ExtractMemory` prompt 需要加入筛选规则：

| 内容类型 | 是否进 LMD | 原因 |
|---------|-----------|------|
| 用户偏好（"所有时间用东八区"） | ✅ relation | 持久偏好 |
| 项目技术决策（"chunker 改为 split-by-section"） | ✅ fact | 持久知识 |
| 执行经验（"MinerU 不支持 encrypted PDF"） | ✅ episode | 经验教训 |
| 一次性任务（"帮我查一下天气"） | ❌ | 无长期价值 |
| 通用常识（"Python 是解释型语言"） | ❌ | 大模型可推理，无需存储 |
| 临时对话上下文（"这个变量的类型是 string"） | ❌ | 上下文相关，无独立价值 |

原则（参考 generic-agent）：
- **"无执行，不记忆"** — 只有经过实际执行验证的信息才进入 LMD
- **"不记录大模型可推理的通用常识"** — 训练数据已有的知识不浪费存储

#### 执行流程

```
Dream 进程（Worker 线程）：

  1. 扫描所有 thread 目录
     对每个 thread：

  2. 找到未处理的 summary 文件 (summaries/*.md，排除 .lmd.md)

  3. 读取对应的原始 JSONL（messages-{N}.jsonl，与 summary 同编号）

  4. BAML.ExtractMemory(messages) -> MemoryItem[]
     (仅提取有长期价值的知识，按上述筛选规则)

  5. 逐条 addMemory() 写入 LMD
     不做自动去重。Fact/episode/relation 全部直接 add。

  6. 如果 addMemory() 失败（LMD 不可用、网络错误）：
     不 rename summary 文件。记录错误日志。跳到下一个 summary 或停止。
     Summary 文件保留 .md 后缀，下次 Dream 会重新发现并重试。

  7. 全部成功后，rename summary 文件
     summaries/{N}.md → summaries/{N}.lmd.md
     知识已从叙述形态（Summary）转为结构化形态（LMD）
     .lmd.md 文件不再进入 LLM context（后缀不匹配 .md 加载规则）
     原始 JSONL 永久保留不动
     Summary 文件保留作历史记录
```

**为什么 rename 而不是删除：**
- 保留 summary 文件作为历史记录，可回溯
- 不依赖删除操作来表达状态，更安全
- 和 JSONL 一样，数据不丢失原则
- .lmd.md 后缀就是状态标记，无需额外标记文件

#### Worker 线程模型

```
┌─────────────────────────┐     ┌─────────────────────────┐
│      Main Thread        │     │     Worker Thread        │
│                         │     │                         │
│  pc2 chat / reflect     │     │  Dream Process          │
│                         │     │                         │
│  - Agent loop           │     │  - Read JSONL from disk │
│  - User interaction     │     │  - LLM calls (Extract)  │
│  - LLM calls (AgentChat)│     │  - LMD writes (HTTP)    │
│                         │     │                         │
│         MessagePort      │     │                         │
│         ├───────────────┤────>│  abort signal           │
│         │<──────────────┤─────┤  progress log           │
│                         │     │                         │
└─────────────────────────┘     └─────────────────────────┘
```

#### Dream 中断

用户回来或发新消息时：
1. 主线程通过 MessagePort 发送 abort 信号
2. Worker 在每个 summary 处理完后检查 abort
3. 已 rename 的 summary 不会重复处理（后缀变为 .lmd.md）
4. 当前正在处理的 summary：未写入 LMD 的结果丢弃，下次继续（summary 文件仍是 .md 后缀）

---

## 4. 读取流程（LLM Context 组装）

每轮对话开始时，按以下顺序组装 LLM context：

```
System Message 1 (~1500 tokens)
  Agent 身份 + 核心指令 + 工具描述 + Skill 元数据 + SOP 索引
  变化频率：几乎不变

System Message 2（仅未处理的 summary）
  只包含 .md 后缀的 summary 文件
  .lmd.md 后缀的文件不加载（已处理到 LMD）
  变化频率：Summary 生成时增加，Dream 处理后不变（rename，不删除）

Recent Messages = bridge 冻结文件(完整) + current 文件
  bridge 冻结文件：
    - 倒数第二个冻结文件（Summarize 后剩余冻结文件中最新那个）
    - 完整加载，不截断
    - 保证 Summary 和 current 之间零语义断裂
  current 文件：
    - messages-current.jsonl 的全部内容
  注意：这两部分是完整文件，不是从尾部截取

Dynamic Tail (~500 tokens)
  [Context]
  Time: 2026-04-25 14:30 CST (UTC+8)
  Turn: 15

  [Relevant Memory]          <-- 来自 LMD query (Layer 3)
  - fact: LMD uses sqlite-vec
  - relation: project uses TypeScript

  [User Message]
  actual user input here

  变化频率：每轮完全重建
```

### Context 中的知识不重复

三层数据互不重叠：

| 数据源 | 在 context 中的位置 | 覆盖范围 |
|--------|-------------------|---------|
| 未处理的 summary (.md) | System Message 2 | 最早的冻结文件 |
| bridge 冻结文件 + current | Recent Messages 区 | 最近的对话 |
| LMD 记忆 | Dynamic Tail | 长期沉淀的知识 |

| 知识来源 | System Message 2 | Recent Messages | Dynamic Tail |
|---------|-----------------|----------------|-------------|
| 未处理的 summary | ✅ 叙述性摘要 | ❌ | ❌ LMD 中无此知识 |
| bridge / current 消息 | ❌ | ✅ 原始消息 | ❌ |
| 已处理到 LMD 的 summary | ❌ .lmd.md 不加载 | ❌ | ✅ 通过 LMD query 检索 |

### Memory Query 策略（Layer 3 -> Context）

| 时机 | Query | 目的 |
|------|-------|------|
| 每轮 | `lastAssistant + " " + currentUser` | 语义上下文 + 用户意图 |
| 首条消息 | `currentUser` only | 无 lastAssistant 时的 fallback |
| Agent 主动 | 自定义 query（via `memory_search` tool） | Agent 判断需要查找的特定知识 |

### 周期性 Memory 刷新（待定）

**动机**：对话变长后，per-turn query 偏向当前任务语义，可能漏掉用户偏好等基础信息。

**问题**：泛 query（如 "user preferences and key facts"）在向量搜索中返回噪音，不是有用信息。

**候选方案**：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| A. 按类型查 | 单独查 relation 类型，取最近 N 条 | 直接拿到当前偏好/状态 | 可能不相关 |
| B. 高分记忆 | 查询 score 最高的记忆 | 最确信的知识 | 可能和当前无关 |
| C. 不做周期性刷新 | 只靠 per-turn query | 最简单 | 漂移风险 |
| D. 启动时全量加载 | session 开始时加载高分 fact + 最近 relation 到 System Message | 一次到位 | 占 System Message 空间 |

**Query 策略是运行时可调的。** 先实现 per-turn query，跑起来后根据实际效果确定是否需要周期性刷新。

---

## 5. 写入策略：不做自动去重

| Type | 策略 | 理由 |
|------|------|------|
| **fact** | 直接 add，不去重 | 不可变真理，重复无害 |
| **episode** | 直接 add，不去重 | 每个 episode 是一时间点的事件，"昨天吃了午饭"和"今天吃了午饭"是不同事件 |
| **relation** | 直接 add，不删旧的 | "2024年在A公司"和"2025年在B公司"都是事实。LMD recencyBoost 让最新的排前面。Agent 看到全部历史 |

如果未来存储膨胀，再设计清理策略。**YAGNI。**

---

## 6. 短期 -> 长期转化的完整流程

```
┌─────────────────────────────────────────────────────────┐
│                     对话进行中                           │
│                                                         │
│  Layer 1 (Recent Messages / JSONL)                      │
│  消息逐条追加到 messages-current.jsonl                    │
│  不写 LMD                                               │
└─────────────────────────────┬───────────────────────────┘
                              │
                              │  token 量达到 freeze_threshold (30%)
                              v
┌─────────────────────────────────────────────────────────┐
│                  文件冻结（无 Summarize）                  │
│                                                         │
│  rename messages-current.jsonl -> messages-{N}.jsonl    │
│  创建新的空 messages-current.jsonl                       │
│                                                         │
│  如果此时有 3+ 冻结文件：                                 │
│    BAML.SummarizeHistory(最老冻结文件) -> summaries/{M}.md│
│    最老冻结文件的 summary 进入 System Message 2           │
│    倒数第二个冻结文件成为 bridge，完整保留在 context 中    │
└─────────────────────────────┬───────────────────────────┘
                              │
                              │  summary 积累 / 定时检查 / 启动
                              v
┌─────────────────────────────────────────────────────────┐
│              Dream 记忆整理（Worker 线程）                │
│                                                         │
│  输入：.md 后缀的 summary 文件 → 读取对应原始 JSONL       │
│  处理：BAML.ExtractMemory -> MemoryItem[]（筛选有价值知识）│
│  输出：addMemory() 写入 LMD（不做去重）                   │
│                                                         │
│  rename summaries/{N}.md → summaries/{N}.lmd.md         │
│  Summary 文件保留，但不再进入 context                     │
│  原始 JSONL 永久保留                                     │
│                                                         │
│  同一份知识从 Summary 转移到 LMD                         │
│  context 中的位置从 System Message 2 变为 Dynamic Tail   │
└─────────────────────────────┬───────────────────────────┘
                              │
                              │  后续对话（任何 thread）
                              v
┌─────────────────────────────────────────────────────────┐
│                     知识使用                              │
│                                                         │
│  queryMemory(lastAssistant + currentUser) -> top N      │
│  注入 Dynamic Tail 的 Relevant Memory 区                 │
│                                                         │
│  跨 thread、跨 session 的知识共享                         │
└─────────────────────────────────────────────────────────┘
```

### 转化时间线

| 时间点 | 发生的事 | LLM 看到什么 |
|--------|---------|-------------|
| T=0 | 对话开始 | System + 用户输入（无历史） |
| T=1..N | 对话进行中 | current 文件逐渐增长 |
| T=freeze阈值 | 文件冻结 | 新冻结文件 + current |
| T=3个冻结文件 | Summarize 最老文件 | summary + bridge + 另一冻结 + current |
| T=Dream触发 | 记忆提取 | summary rename 为 .lmd.md，知识进入 LMD |
| T=下次对话 | 新 thread | LMD 中有了沉淀的知识，queryMemory 可查到 |

---

## 7. Conversation Summary 的质量要求

每段 1500-3000 tokens，覆盖：

```markdown
## Session Summary (messages 1-N)

### Tasks
- [完成] 修复 PDF parser 的 chunker 分页问题
- [进行中] 添加 web search tool 的错误重试

### Key Decisions
- chunker 从 split-by-page 改为 split-by-section

### Code/File Changes
- src/storage/chunker.ts: 重写了 splitSections()

### Important Information Discovered
- MinerU 不支持 encrypted PDF

### User Preferences Expressed
- "所有时间用东八区"

### Unresolved Issues
- PDF 中的表格提取仍有乱码问题
```

---

## 8. 边界情况

### 跨 Thread 知识共享

- 每个 thread 有独立的 JSONL / Summary
- LMD 长期记忆跨 thread 共享
- Thread A 的知识在 Thread B 中可用的前提：Dream 已处理 Thread A 的 summary
- **延迟是已知的 trade-off**

### 非常短的对话（未触发冻结就退出）

- 不触发冻结，不生成 summary
- 没有 summary 文件 → Dream 不会处理此对话
- 消息仍在 messages-current.jsonl 中，下次打开此 thread 时完整可见

### LMD 不可用

- Agent 降级运行：无 memory query，无 memory save
- Recent Messages 和 Summary 正常工作
- 下次 Dream 运行时处理积压的 summary

### Relation 的时间线查询

- queryMemory("工作 公司") 返回多条 relation
- LMD recencyBoost 让最新的排前面
- Agent 看到全部历史，根据 createdAt 判断哪个是当前的

### Summary 积累过多

多次冻结但 Dream 未运行时，System Message 2 会包含多个 summary。Context loader 按优先级加载：最新的优先，旧的在预算不够时可截断。触发 Dream 处理即可解决。

预算安全检查确保即使 Dream 未运行，也不会因为 summary + 冻结文件超预算。

---

## 9. 优缺点

### 优点

1. **一条路径到 LMD**。没有双路径冲突，没有去重难题。
2. **三层模型极简**。Recent Messages + Summary + LMD，每层职责清晰。
3. **数据不丢失**。原始 JSONL 永久保留，summary 文件也保留（rename 不删除）。
4. **Summary 与 Recent Messages 不重叠**。bridge 冻结文件完整保留，零语义断裂。
5. **Dream 内容筛选**。只提取有长期价值的知识，不浪费 LMD 存储。
6. **不超预算**。所有计算从 context window 推导，冻结前有预算安全检查。
7. **Worker 线程不阻塞**。用户可以一边聊天一边整理记忆。
8. **阈值基于 token**。适应不同模型和消息长度。
9. **Summary 与 LMD 不重叠**。同一份知识在 context 中只出现一次。

### 已知限制

1. **跨 Thread 知识有延迟**。Thread A 的知识在 Dream 处理前对 Thread B 不可见。
2. **Summary 压缩有损**。具体代码片段、错误信息可能丢失。缓解：原始 JSONL 保留，agent 可 file_read 回溯。
3. **Memory Query 可能不相关**。per-turn query 偏向当前任务语义，可能漏掉偏好等基础信息。周期性刷新方案待定。
4. **不做去重可能积累冗余**。个人项目数据量下不太可能成为问题。
