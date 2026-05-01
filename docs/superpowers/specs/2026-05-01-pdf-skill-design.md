# PDF Processing Skill Design

## 1. Problem

用户需要处理中文论文、扫描件、图文混排的 PDF，用于论文阅读、知识库入库、对话引用三种场景。当前 pc2 没有任何 PDF 处理能力。

## 2. Design Decision

PDF 处理实现为 **Skill**（非内置 Tool），理由：

1. 底层依赖是外部 Python CLI 工具（MinerU/marker），不是项目的一部分
2. Skill 可以独立迭代，不污染主项目
3. Skill 通过 front matter `description` 字段声明触发条件，agent 自动匹配，无需硬编码到 prompt
4. 换工具只需改 SKILL.md，不动代码

### Alternatives Considered

| 方案 | 结论 |
|------|------|
| 新增 `pdf_process` Tool | 封装了外部依赖到主项目，维护负担重，换工具要改代码 |
| Node.js 库（pdf-parse/pdfjs） | 中文支持差，表格/公式/图片提取能力为零，扫描件不行 |
| 云端 API（OpenAI/Claude） | 有成本和隐私问题，违背本地处理原则 |

## 3. Architecture

### 两条触发路径

```
路径 A: Slash Command
  用户输入 /pdf-process <path>
    → chat.ts 匹配 skill slash command
    → 将 SKILL.md body 注入 agent 消息前缀
    → agent 调 bash 执行 mineru
    → agent 调 file_read 读回 Markdown
    → agent 回答问题 / 可选入库

路径 B: 对话自动触发
  用户对话中提到 .pdf 文件
    → agent 看到 system prompt 中的 skill metadata:
        "- pdf-process: 当用户提到 PDF 文件时激活"
    → agent 自行 file_read SKILL.md
    → 按里面指令执行
```

### Slash Command 映射规则

所有 `skills/*/SKILL.md` 自动注册为 slash command。规则：

- slash command name = `/` + front matter `name` 字段原值（约定 name 字段使用 kebab-case）
- 在 input.ts 的 tab 补全列表中可见
- 用户输入 `/pdf-process <path>` 时，chat.ts 将 SKILL.md body + 用户参数拼成一条消息传给 agent
- Skill slash command 不跳过 agent，而是把增强后的消息传给 agent 执行

### 对现有系统的影响

**需要新增的基础设施**：

1. **Skill → Slash Command 通用映射机制**（影响主 spec Section 4 Skill System 和 Section 13 CLI Interface）：
   - `readMultiline` 调用时传入动态生成的 `slashCommands`：`[...DEFAULT_SLASH_COMMANDS, ...skills.map(s => '/' + s.name)]`
   - chat.ts 在 prompt 循环中增加 skill slash command 分支
2. **`skills/pdf-process/SKILL.md`** 文件
3. **chat.ts 代码改动**：`readMultiline('\n> ')` 改为 `readMultiline('\n> ', { slashCommands })` 传入动态列表

**不需要改动**：

- Agent prompt 不加 PDF 相关规则（由 skill front matter `description` 处理）
- 不新增 Tool
- 不改 loader.ts（已有 parseSkillFrontmatter + scanSkillDirectory）
- 不改 loop.ts
- `src/cli/input.ts` 仅增加 `DEFAULT_SLASH_COMMANDS` 的 export 关键字，无功能改动
- Skill metadata 注入 system prompt 的链路已通：`scanSkillDirectory` → `formatSkillList` → BAML `AgentChat` 的 `skills_list` 参数

## 4. Skill Definition: `skills/pdf-process/SKILL.md`

```markdown
---
name: pdf-process
description: 当用户提到 PDF 文件、要求处理 PDF、或需要从 PDF 提取内容时激活此技能
evolvable: true
allowed-tools: Bash(mineru*) Bash(marker_single*) Bash(mkdir*) Bash(which*)
---

# PDF Processing Skill

## 前置检查

1. 运行 `which mineru` 检查 MinerU 是否已安装
2. 如果未安装，告诉用户安装方法（见下方"安装指南"），停止
3. 如果用户未提供文件路径，用 ask_user 询问 PDF 路径

## 处理单个 PDF

给定 PDF 路径 `<input>`（`stem` = 去掉扩展名的文件名）:

1. 创建输出目录: `mkdir -p /tmp/pc2-pdf/{stem}`
2. 执行转换:
   ```
   mineru -p <input> -o /tmp/pc2-pdf/{stem}
   ```
   - 如果 mineru 失败，尝试 fallback:
     ```
     marker_single <input> /tmp/pc2-pdf/{stem}
     ```
3. 找到输出 Markdown 文件（搜索 /tmp/pc2-pdf/{stem} 下的 .md 文件）
4. 用 file_read 读取 Markdown 内容
5. 向用户呈现内容 / 回答问题

## 入库到 LMD（可选）

用户要求"入库"或"记住"时：
1. 提取关键信息（事实、结论、关系）
2. 用 memory_search 检查是否已有相似内容
3. 用 addMemory 写入 LMD（type: fact 或 episode）

## 错误处理

| 错误 | 处理 |
|------|------|
| mineru 未安装 | 输出安装指南，停止 |
| 转换失败（mineru） | 尝试 marker_single fallback |
| marker_single 也失败 | 报错，建议用户检查文件是否加密/损坏 |
| 找不到输出 .md | 检查其他子目录，报告实际输出结构 |
| 未提供文件路径 | 用 ask_user 询问 |

## 安装指南（MinerU）

MinerU 3.x 安装:
```
# CPU
pip install mineru[all]

# GPU (自动检测 CUDA)
pip install mineru[all]

# 验证
mineru --help
```

如遇问题参考: https://github.com/opendatalab/MinerU
```

## 5. Skill → Slash Command 机制设计

### 注册流程

```
chat.ts 启动
  → scanSkillDirectory('skills')  // 已有
  → 从返回的 skills 提取 name 字段
  → readMultiline('\n> ', { slashCommands: [...DEFAULT_SLASH_COMMANDS, '/' + skill.name for each skill] })
  → 用户按 Tab 可看到 /pdf-process
```

### 执行流程

```
用户输入: /pdf-process path/to/paper.pdf
  → chat.ts 检测到以某个 skill.name 开头（匹配 '/' + skill.name）
  → 提取参数: args = input.slice(('/' + skill.name).length).trim()  // "path/to/paper.pdf"
  → 查找 skills 数组中匹配的 skill，取其 filePath
  → 读取 SKILL.md 全文（或使用已加载的 body）
  → 构造 agent 消息，格式:
      "<SKILL.md body>\n\n---\n\n用户要求: path/to/paper.pdf"
  → 将此消息传给 loop.execute()
```

关键设计选择：chat.ts 注入 SKILL.md body 到消息中，而非让 agent 自己 file_read。理由：减少一轮 tool call 循环，且 slash command 的语义就是"明确要求使用此 skill"。

### 代码改动清单

1. **chat.ts**:
   - `readMultiline` 调用增加 `slashCommands` 参数
   - prompt 循环增加 skill command 分支（在 `/sessions`、`/resume` 之后）
   - 匹配逻辑：`input.startsWith('/' + skill.name)` + 空格或行尾

2. **input.ts**: 无需改动（`slashCommands` 参数已支持，只是目前未传入动态值）

## 6. Data Flow

```
                  ┌─────────────────────┐
                  │   skills/           │
                  │   pdf-process/      │
                  │     SKILL.md        │
                  └─────────┬───────────┘
                            │ chat.ts reads body (slash command path)
                            │ OR agent file_read (dialog trigger path)
                            ▼
┌──────────┐    ┌───────────────────────┐    ┌──────────────┐
│ User     │───▶│ Agent Loop            │───▶│ bash tool    │
│ /pdf ... │    │ (receives skill msg)  │    │ mineru       │
└──────────┘    └───────────────────────┘    └──────┬───────┘
                                                     │
                                                     ▼
                                            ┌──────────────┐
                                            │ /tmp/pc2-pdf/│
                                            │ *.md output  │
                                            └──────┬───────┘
                                                   │ file_read (by agent)
                                                   ▼
                                            ┌──────────────┐
                                            │ Agent reads  │
                                            │ Markdown,    │
                                            │ answers user │
                                            └──────────────┘
```

## 7. Scope

### In Scope

1. Skill → Slash Command 通用映射机制（适用于所有 skill）
2. `skills/pdf-process/SKILL.md` 文件
3. `/pdf-process` 命令在 chat.ts 中的处理
4. Tab 补全支持

### Out of Scope

- MinerU 安装脚本（SKILL.md 包含安装指引）
- PDF 入库 LMD 的自动化流程（由 SKILL.md 指导 agent 手动完成）
- PDF 处理进度条
- PDF 分块/向量化（属于 LMD 职责）
- 批量处理（V2）

## 8. Testing

| 测试场景 | 类型 | 验证 |
|----------|------|------|
| SKILL.md front matter 解析 | 单元 | parseSkillFrontmatter 正确提取 name/description/evolvable |
| Skill slash command 注册 | 单元 | `['/sessions', '/resume', '/pdf-process']` 出现在 slashCommands 数组 |
| `/pdf-process path.pdf` 分发 | 集成 | chat.ts 构造的消息包含 SKILL.md body + 用户路径 |
| `/pdf-process` 无参数 | 集成 | 消息仍传给 agent，agent 用 ask_user 询问路径 |
| Skill 自动触发 | 集成 | 用户说"帮我读一下 paper.pdf"时 agent 加载 SKILL.md |
| Tab 补全 | 手动 | 输入 `/pd` + Tab → 补全 `/pdf-process` |

## 9. Dependencies

| 依赖 | 类型 | 说明 |
|------|------|------|
| MinerU (`mineru` CLI) | 外部 Python CLI | 用户需自行安装，SKILL.md 包含安装指引 |
| marker (可选 fallback) | 外部 Python CLI | mineru 失败时的备选 |
| 现有 bash tool | 内置 | 调用外部 CLI |
| 现有 file_read tool | 内置 | 读取输出 Markdown |

## 10. 主 Spec 更新

本 spec 引入的通用机制需更新到主 spec (`2026-04-25-personal-agent-design.md`)：

1. **Section 4 Skill System** — 新增 "Skill Slash Command" 小节：
   - 所有 skills 自动注册为 `/<name>` slash command
   - Tab 补全可见
   - 执行时注入 SKILL.md body 到 agent 消息

2. **Section 12 PDF Processing Pipeline** — 更新：
   - CLI 命令从 `magic-pdf` 更正为 `mineru`
   - skill 名称从 `pdf_process` 更正为 `pdf-process`（kebab-case）
   - 移除 `-m auto` 标志（MinerU 3.x 自动检测）

3. **Section 13 CLI Interface** — 新增 skill slash commands 说明
