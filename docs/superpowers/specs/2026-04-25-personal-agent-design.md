# Personal Agent (pc2) Design Spec

> **Note**: Sections 6 (Memory), 7 (Summary), and 8 (Dream) are superseded by `docs/superpowers/specs/memory-and-context.md`. That document is the authoritative source for all memory, summary, and context design decisions.

## 1. Overview

A personal AI agent with self-evolution capabilities, built in TypeScript. The agent runs as a CLI chat application, supports built-in tools, user-defined skills, SOP-driven behavior (built-in SOPs are NOT self-evolvable; agent can create new SOPs), memory, reflect-based autonomous operation, and cron jobs.

### Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Language | TypeScript | User preference |
| LLM calls | BAML | All LLM calls through BAML. Tool calling logic handled in code (text protocol) |
| Memory | LMD MCP | Hybrid search + time-decay memory, already available. Memory only (no document indexing) |
| Agent data | File-based (JSONL/JSON/Markdown) | Subsystems independent, agent can self-manage data with file tools, no native dependency |
| Architecture | Monolithic modular | Simple, debuggable, suitable for personal project |
| PDF processing | External CLI tool (MinerU primary, marker fallback) | Best Chinese PDF support, local processing |

### Reference Projects

| Project | What we learned |
|---------|----------------|
| generic-agent (Python) | Agent loop, SOP system + self-evolution, reflect system, plan mode, sub-agents, turn-end callback |
| xvc.agent2 (TypeScript/CF) | Tool dispatch pattern, message history with token budget, sub-agent parallel execution |
| lmd (Golang) | Hybrid search (BM25 + vector + RRF fusion), memory types (fact/episode/relation), MCP protocol |
| Letta/MemGPT | Context summary, sleeptime agent (dream), archival memory, core/recall/archival memory hierarchy |

---

## 2. Architecture

```
+----------------------------------------------------------+
|                     CLI Entry (src/cli/)                   |
|   User input -> AgentLoop.run() -> Stream to terminal     |
+----------------------------+-----------------------------+
                             |
                             v
+----------------------------------------------------------+
|                  Agent Loop (src/agent/)                  |
|                                                           |
|  +------------+  +-------------+  +----------------+      |
|  | loop.ts    |  | prompt.ts   |  | sub-agent.ts   |      |
|  | ReAct loop |  | Context asm |  | Isolated agent |      |
|  | State mgmt |  |             |  |                |      |
|  +------------+  +-------------+  +----------------+      |
|                                                           |
|  turn_end_callback: anti-loop warning, intervention check |
+---------+------------------+------------------+-----------+
          |                  |                  |
          v                  v                  v
  +------------+    +-------------+    +--------------+
   | BAML (LLM) |    | Tools       |    | Reflect      |
   | baml_src/  |    | src/tools/  |    | src/reflect/ |
   +-----+------+    +------+------+    +-------+------+
         |                  |                     |
         |   +--------------+------------+        |
         |   v              v            v        v
         |  +----------+ +--------+ +-----------+ +--------+
         |  | LMD MCP  | | File   | | External  | | File   |
         |  | Memory   | | System | | whoogle   | | System |
         |  | (memory  | | (data) | | Bash exec | | (data) |
         |  |  only)   | |        | |           | |        |
         |  +----------+ +--------+ +-----------+ +--------+
        |
         +-- BAML handles all LLM calls:
              AgentChat, ExtractMemory, SummarizeHistory,
              VerifyJudge
              Tool calling logic in code (text protocol)
```

### Data Storage Separation

Each subsystem stores its own data independently on the file system. No shared database.

| Subsystem | Storage | Format |
|-----------|---------|--------|
| Conversation history | `data/threads/{id}/` | JSONL (messages) + Markdown (summaries) |
| Long-term memory | LMD MCP (external daemon) | fact/episode/relation |
| Cron jobs | `data/cron/{id}.json` | JSON |
| SOP | `sop/{name}/SKILL.md` | Markdown + YAML frontmatter (built-in human-authored + agent-evolved) |
| Reports | `data/reports/{date}_{id}.md` | Markdown |
| Plans | `temp/plan_{id}/plan.md` | Markdown |

---

## 3. Agent Loop

### Core Loop (ReAct with State Management)

Flow:

1. Load history context (summaries + bridge frozen file + current file)
2. Query LMD for relevant memory
3. Assemble LLM context (see Context Assembly Order below)
4. Call BAML AgentChat (streaming only on final text turn; full response for tool-call turns)
5. Parse response for text + tool_calls
6. If no tool_calls: output text, done
7. If tool_calls: dispatch each tool, collect StepOutcome
8. turn_end_callback(): inject warnings, check intervention
9. Append messages to JSONL, check freeze threshold
10. Build next message, loop (max 30 rounds, wall-clock timeout 20 minutes)

### StepOutcome

```typescript
type ToolResult = string | Record<string, unknown>;

interface StepOutcome {
  data: ToolResult | null;
  nextPrompt: string | null;  // null = task done
  shouldExit: boolean;        // true = break loop (ask_user only)
}
```

### Plan Mode

Plan mode is not a separate agent loop state machine. It is SOP-guided task management using existing file tools, with lightweight agent loop support via `turn_end_callback`.

**Why plan mode exists** (validated against generic-agent):

When a task has 3+ steps with dependencies, the agent needs to:
- **Decompose**: break a vague task into executable steps
- **Track progress**: remember which step across turns (conversation history alone loses detail once Summary triggers)
- **Enforce quality**: prevent the agent from claiming PASS without verification
- **User visibility**: user can see what the agent is doing and its progress

**Design** (方案 C — SOP + File Tools + lightweight turn_end_callback):

| Component | Implementation |
|-----------|---------------|
| Task decomposition | Agent reads `sop/plan/SKILL.md`, AgentChat decomposes naturally (no dedicated BAML function — generic-agent validates this) |
| Progress tracking | Agent uses `file_write`/`file_edit`/`file_read` to manage `temp/plan_{id}/plan.md` with checkboxes |
| Verification | `BAML.VerifyJudge` + `spawn_agent` for structured adversarial verification |
| Trigger | SOP guidance + agent judgment (not automatic detection) |

**sop/plan/SKILL.md 5-phase workflow** (referenced from generic-agent):

```
Phase I: Explore
  - spawn_agent to explore codebase and environment
  - Produce exploration findings

Phase II: Plan
  - Write plan.md ([ ]/[x]/[D]/[P] checkboxes)
  - ask_user to confirm plan

Phase III: Execute
  - Each turn: file_read(plan.md) -> execute first [ ] -> file_edit mark [x result]

Phase IV: Verify
  - spawn_agent independent verification (reads sop/verify/SKILL.md)
  - BAML.VerifyJudge structured output VERDICT

Phase V: Failure handling
  - Repair -> re-verify (max 2 rounds)
```

**turn_end_callback lightweight support** (when plan file exists):

```typescript
function planTurnEndCallback(turn: number, context: LoopContext): string | null {
  const planFile = findActivePlanFile(context.threadId);
  if (!planFile) return null;

  // 1. Ensure enough turns remain for complex tasks
  context.ensureMinRemainingTurns(40);

  // 2. Every 5 turns: inject reminder to re-read plan
  if (turn >= 10 && turn % 5 === 0) {
    return `[Plan Reminder] file_read(${planFile}) 确认当前步骤，继续执行`;
  }

  // 3. Intercept completion claims without verification
  if (isCompletionClaim(context.lastResponse) && !hasVerificationEvidence(context)) {
    return "⛔ 检测到声称完成但未执行验证步骤。请 spawn_agent 执行独立验证。";
  }

  // 4. High turn count: force progress report
  if (turn >= 60) {
    return `[DANGER] 已执行 ${turn} 轮。ask_user 汇报进度，确认是否继续。`;
  }

  return null;
}
```

These are **reactive checks**, not proactive state management. Plan file exists → callback provides support; plan file deleted → normal flow resumes. No `enter_plan_mode()`, no state machine.

**Note**: Plan mode guidance is provided through the SOP system (built-in procedural memory), not the Skill system (capability extension).

### External Intervention Files

Location: `temp/` directory. Two special files that the turn-end callback checks:

- `temp/_keyinfo`: Injects content into next prompt context (consumed on read, file deleted)
- `temp/_intervene`: Appends instructions to next prompt (consumed on read, file deleted)

### Sub-Agents

Isolated AgentLoop instances:

- Independent message history
- maxRounds: 15
  - Wall-clock timeout: 10 minutes per sub-agent run
- Per-call heartbeat: if no event yielded for 60 seconds, abort
  - No recursive spawning (enforced via `ctx.isSubAgent` flag)

### Magic Numbers

| Value | Location | Why this value |
|-------|----------|----------------|
| `freeze_threshold = model_context_window * 30%` tokens | File freeze threshold | When current JSONL reaches this, freeze it and start new. 30% ensures 3 files (worst case) + system fit within context window. For 100K context → 30K tokens per segment. |
| `summary_threshold` | Triggered when 3+ frozen files exist | Summarize oldest frozen file (100% complete, no truncation). Ensures bridge file always between summary and current. |
| 30 rounds | Agent loop max | Prevents runaway loops. 25-turn force ask_user gives 5-round buffer |
| 15 rounds | Sub-agent max | Sub-tasks should be simpler than main task; 15 is half of main loop |
| 20 minutes | Agent loop wall-clock | Upper bound for a single task execution |
| 10 minutes | Sub-agent wall-clock | Half of main loop timeout |
| 7 turns | Anti-loop check | Empirically, LLM repetition starts after 5-7 failed attempts. 7 catches most loops |
| 25 turns | Force ask_user | Safety valve at 25, before maxRounds(30) |

### Context Assembly Order (Optimized for LLM Prefix Caching)

Context is assembled to maximize prefix cache hits across turns. The principle: stable content first, growing content in the middle, dynamic content last.

**Note on caching**: Actual cache hit rates depend on the LLM provider's KV cache implementation. This order is structurally optimal regardless — stable first, dynamic last — but providers differ in granularity and automatic caching behavior.

```javascript
[
  // ===== STABLE PREFIX (rarely changes -> high cache hit rate) =====
  { role: "system", content: "Agent identity + core instructions + tool descriptions + skill metadata + SOP index" },

  // ===== SUMMARY (only changes on summary generation -> high cache hit rate) =====
  { role: "system", content: "[Previous conversation summary]\n..." },

  // ===== BRIDGE + CURRENT (bridge changes on freeze, current grows each turn) =====
  // Bridge frozen file: complete, un-truncated, provides semantic bridge to summary
  { role: "user", content: "..." },
  { role: "assistant", content: "...", tool_calls: [...] },
  { role: "tool", content: "..." },
  // ... bridge frozen file messages (complete, ~30% of context) ...
  // ... current file messages (growing) ...

  // ===== DYNAMIC TAIL (changes every turn -> low cache, but small) =====
  { role: "user", content: `
[Context]
Time: 2026-04-25 14:30 CST (UTC+8)
Turn: 15

[Relevant Memory]
- fact: LMD uses sqlite-vec for vector storage
- relation: project uses TypeScript

[User Message]
actual user input here
` }
]
```

Summary and Recent Messages are a non-overlapping partition of all conversation data. Summary covers old frozen files; bridge + current cover recent data. Bridge file guarantees zero semantic gap.

Summary is placed in a second system message instead of a simulated user/assistant pair. This avoids wasting tokens on fake acknowledgment turns and is compatible with providers that support multiple system messages.

Cache benefit breakdown (provider-dependent):

| Section | Token estimate | Change frequency | Cache hit |
|---------|---------------|-----------------|-----------|
| Stable system | ~1500 | Almost never | ~100% |
| Summary system | ~1500-3000 per summary | Only on summary generation | ~90%+ |
| Bridge frozen file | ~30K (freeze_threshold) | Changes on freeze | ~80%+ |
| Current file | Up to ~30K | +1-2 per turn | Growing |
| Dynamic tail | ~300-500 | Every turn | 0% (smallest) |

### Turn-End Callback

| Turn | Action | Rationale |
|------|--------|-----------|
| turn % 7 == 0 | Anti-loop warning (demand strategy change) | LLM tends to repeat same failed approach |
| turn > 25 | Force ask_user | Safety valve, 25 < maxRounds(30) gives buffer |
| Always | Check `_keyinfo` / `_intervene` files | Allow external guidance |

---

## 4. Tools, Skills & SOP

### Concepts

| | Tools (工具) | Skills (技能) | SOP (标准操作流程) |
|--|--|--|--|
| **Source** | Built-in, defined in code | Human-authored + agent-evolved, `skills/` directory | Human-authored foundation, `sop/` directory |
| **Quantity** | Fixed set (9) | Unlimited | Unlimited |
| **Definition** | TypeScript `Tool` interface | `SKILL.md` with YAML frontmatter | `SKILL.md` with YAML frontmatter (same structure as Skills) |
| **evolvable** | N/A | `evolvable: true` (or omitted, default true) | Built-in SOPs: `evolvable: false`; Agent-created SOPs: `evolvable: true` |
| **Trigger** | LLM tool call (always available) | Auto-triggered by context matching | Agent reads on-demand via `file_read` |
| **Loading** | Always in context | Progressive: metadata → body → references | Progressive: metadata → body → references (same as Skills) |
| **Agent can modify** | No | Yes (create/edit/delete) | Only `evolvable: true` SOPs |
| **Example** | `file_read`, `bash`, `memory_search` | "React component builder", "PDF process" | plan, verify, dream, subagent |

### Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<StepOutcome>;
}

interface ToolContext {
  turn: number;
  index: number;
  lmdClient: LmdMcpClient;
  dataDir: string;
  agentId: string;
  isSubAgent: boolean;
}
```

### Tool Registry

Tools are registered explicitly via `registry.register(tool)`. All built-in tools registered in setup function.

Tool definitions for BAML generated at runtime from each tool's `name`, `description`, `parameters`.

### Built-in Tools (9)

| Tool | Purpose | External Dependency |
|------|---------|-------------------|
| `file_read` | Read files (line range, keyword search). Aligns with Claude Code Read. | none |
| `file_write` | Create or fully overwrite files. Aligns with Claude Code Write. | none |
| `file_edit` | Exact string search-and-replace in existing files. Aligns with Claude Code Edit. | none |
| `bash` | Execute shell commands. V1 security: user approval + read-only whitelist + CWD write confinement. | subprocess |
| `web_search` | Search via local whoogle-search | whoogle API |
| `web_fetch` | Fetch and extract web page content | fetch |
| `memory_search` | Search long-term memory via LMD. Agent proactively queries for specific knowledge. | LMD MCP |
| `ask_user` | Interrupt loop, wait for user input | none |
| `spawn_agent` | Launch sub-agent for isolated execution | none |

**Why file_read / file_edit / file_write are separate** (following Claude Code design):

- **Token efficiency**: Edit sends only the changed portion (old_string + new_string), not the whole file
- **Safety/reviewability**: Edit output is a structured diff — immediately clear what changed
- **Semantic clarity**: Model explicitly chooses "read" / "small change" / "full write" — reduces errors

#### bash Tool — V1 Security Model

Simplified from Claude Code's three-layer model (permissions + OS sandbox + managed policies). V1 focuses on practical safety for a personal project.

**Approval flow:**

| Command type | Behavior | Examples |
|-------------|----------|---------|
| Read-only whitelist | Auto-approved, no prompt | `ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc`, `diff`, `stat`, `du`, `git status`, `git log`, `git diff`, `git branch` |
| Everything else | Prompt user, wait for approval | `rm`, `npm`, `python`, `mkdir`, `curl`, etc. |

**Approval persistence**: User can choose "yes, don't ask again for this command" — stored per-project. Compound commands (`&&`, `||`, `;`) require each subcommand to be independently approved.

**Write confinement**: Bash can only write to CWD and subdirectories by default. Configurable via `allowWrite` paths.

**Default blocklist**: `curl`, `wget` (prevent arbitrary data exfiltration; use `web_fetch` instead).

**Not in V1** (deferred to later discussion):
- OS-level sandboxing (Seatbelt / bubblewrap)
- Network isolation (proxy with domain allowlisting)
- Organization-level managed policies
- Auto mode with safety classifier

### Skill System

Skills are knowledge packages that extend the agent's capabilities with domain expertise, workflows, and reference material. Following the Claude Code skill pattern. Skills can be human-authored or agent-evolved (agent creates new skills based on experience).

#### SOP vs Skill — Two Separate Systems

| | SOP (Standard Operating Procedure) | Skill |
|--|--|--|
| **Author** | Built-in SOPs: human. Agent-created SOPs: agent (self-evolution) | Human (developer/user) + agent (self-evolution) |
| **Content** | Core behavior workflows — planning, verification, memory consolidation, sub-agent delegation | Domain capability — "how to do X" |
| **Loading** | Progressive: metadata → body → references (same as Skills) | Progressive: metadata → body → references |
| **Evolution** | Built-in SOPs: **NOT self-evolvable** (`evolvable: false`). Agent-created SOPs: self-evolvable. | Self-evolvable (agent can create/edit/delete) |
| **Validation** | Built-in SOPs: human review only. Agent-created: "No execution, no memory" | Human review or agent execution-verified |
| **Storage** | `sop/` directory | `skills/` directory |
| **Agent can modify** | Only `evolvable: true` SOPs. Built-in core SOPs are read-only for agent. | Yes |
| **Examples** | plan, verify, dream, subagent, autonomous, memory-management | pdf-process, react-builder, aws-deployer |

**Why built-in SOPs are NOT self-evolvable**: Built-in SOPs are foundational infrastructure — they define the agent's core behavior loop (planning, verification, dreaming). If an LLM corrupts a core SOP (e.g., adds hallucinated content to `verify/SKILL.md`), the entire agent's logic breaks. The risk is unacceptable. Agent self-evolution happens in two safe channels: (1) creating NEW SOPs in `sop/` with `evolvable: true`, and (2) creating/editing Skills in `skills/`.

SOP is the agent's **procedural memory** — core workflows plus execution-verified experience. Skill is the agent's **capability extension** — domain knowledge. Both share the same file structure (directory + `SKILL.md` + YAML frontmatter) and loading mechanism (progressive disclosure), but live in separate directories with different modification permissions.

#### Skill Structure

```
skills/
  {skill-name}/
    SKILL.md              # Required: YAML frontmatter + markdown instructions
    references/           # Optional: detailed docs loaded on demand
    scripts/              # Optional: reusable scripts
    assets/               # Optional: templates, examples
```

#### Skill Definition (SKILL.md)

```markdown
---
name: Skill Name
description: Trigger condition description — when to activate this skill
version: 0.1.0
allowed-tools: Bash(git add *) Bash(git commit *)  # Optional: pre-approved tools for this skill
---

# Skill Instructions

Core workflow and domain knowledge here.
Keep lean (~1500-2000 words). Move details to references/.
```

- **name**: Human-readable skill name
- **description**: When this skill should activate (context matching)
- **allowed-tools** (optional): Tools that are pre-approved when this skill is active. Uses permission rule syntax: `Bash(git add *)`, `Bash(npm test)`. Eliminates per-command approval prompts for skill-specific commands.
- **Body**: Procedural knowledge, workflows, domain expertise — written in imperative form

#### Skill Loading (Progressive Disclosure)

1. **Metadata** (always loaded): `name` + `description` from all SKILL.md frontmatter — scanned at startup
2. **Body** (on trigger): Full SKILL.md content loaded when context matches description
3. **References** (as needed): Files under `references/` loaded when the agent needs deeper detail

#### Skill vs Tool Interaction

Skills contain **knowledge** (instructions, reference material, domain expertise). Tools perform **actions** (file ops, shell commands, web requests). A skill may instruct the agent to use specific tools in specific ways, and can pre-approve specific tool patterns via `allowed-tools`, but skills do not define new tools.

#### Skill Auto-Discovery

At startup, scan `skills/` directory for subdirectories containing `SKILL.md`. Parse YAML frontmatter for metadata. No manual registration needed.

---

## 5. BAML Integration

### Design: BAML for All LLM Calls

All LLM calls go through BAML. BAML defines prompt templates and structured output types. The agent loop handles ReAct tool calling logic in code (text protocol).

### BAML File Structure

```
baml_src/
  chat.baml              # Main agent dialog (text + structured tool calls)
  extract_memory.baml    # Extract memory items from conversation
  summarize_history.baml # Conversation summary (summarize old messages)
  verify.baml            # Adversarial verification
  generator.baml         # Code generator config (TypeScript output)
```

### Tool Calling via BAML (Text Protocol)

BAML does not support native multi-turn tool calling. Tools are expressed as union types in BAML output:

```baml
class ToolCall {
  name string
  arguments string
}

class ChatResponse {
  text string
  tool_calls ToolCall[]
}

function AgentChat(
  messages: string,
  tools_description: string
) -> ChatResponse {
  client "glm-5-turbo"
  prompt #"
    {{ messages }}
    
    Available tools:
    {{ tools_description }}
    
    {{ ctx.output_format }}
  "#
}
```

Agent loop: call `AgentChat` -> get `ChatResponse` -> dispatch tools -> append results -> call again.

Dynamic tool registration: descriptions generated at runtime from `ToolRegistry`, passed as string parameter.

### BAML Messages Serialization Format

The `messages: string` parameter is a structured text representation of the conversation history. Format:

```
[System]
Agent identity + instructions

[Previous Summary]
Compressed history...

[User]
Hello, help me with X

[Assistant]
I'll help you with that. Let me search.
[Tool Call: web_search({"q": "X"})]

[Tool Result: web_search]
Search results here...

[User]
That's not what I wanted...

[Assistant]
Let me try a different approach.
```

This preserves role differentiation (System/User/Assistant/Tool Result) while using a single string parameter. The agent loop serializes messages to this format before calling BAML.

### BAML Streaming

`AgentChat` supports streaming for the final response turn (no tool calls). During ReAct loop iterations that return tool_calls, the full `ChatResponse` must be collected before dispatching tools. Streaming is only beneficial for the user-facing text response.

### BAML Auxiliary Functions

Each function has a defined error contract. On LLM call failure or malformed output, the caller receives a structured error and must handle it (retry, fallback, or graceful degradation).

| Function | Input | Output | Error Handling |
|----------|-------|--------|----------------|
| `ExtractMemory` | `conversation: string` | `MemoryItem[]` where `MemoryItem = { content: string, type: "fact" \| "episode" \| "relation" }` | On failure: return empty array, log warning. Non-critical — memory extraction can be retried by Dream. |
| `SummarizeHistory` | `messages: string` | `string` (summary paragraph, 1500-3000 tokens) | On failure: **critical** — abort summary, frozen file stays. Retry when next freeze triggers. See Section 7. |
| `VerifyJudge` | `task: string, deliverables: string, evidence: string` | `{ verdict: "PASS" \| "FAIL" \| "PARTIAL", details: string }` | On failure: return `FAIL` with error details. Safe default is to reject. |

---

## 6. Memory System (LMD MCP)

> **Authoritative source**: `docs/superpowers/specs/memory-and-context.md`. This section is a summary.

LMD is used **only for memory** (fact/episode/relation). No document indexing.

### Memory Types (from LMD)

| Type | Time Factor | Forgetting | Use Case |
|------|-------------|------------|----------|
| `fact` | None | Never | Immutable truths: "Go is statically typed" |
| `episode` | 15-day half-life (core factor) | Expires when score < 0.05 | Time-sensitive events: "discussed chunkSize yesterday" |
| `relation` | 365-day recencyBoost (minor factor, floor 0.7) | Never (but can be manually deleted) | Currently-true relationships: "user works at A company" |

### Memory Query Strategy

| Timing | Query | Purpose |
|--------|-------|---------|
| Every turn | `lastAssistant + " " + currentUser` | Semantic context + user intent |
| First message in thread | `currentUser` only | Fallback when no lastAssistant |
| Agent-initiated | Custom query via `memory_search` built-in tool | Agent proactively searches for specific knowledge |

### Memory Write Triggers

- **Dream process only**: all long-term memory written through Dream (see Section 8)

### LMD MCP Client Interface

```typescript
interface LmdMcpClient {
  addMemory(params: { content: string; type: "fact" | "episode" | "relation" }): Promise<{ id: string }>;
  queryMemory(params: { query: string; limit?: number }): Promise<MemoryHit[]>;
  deleteMemory(params: { id: string }): Promise<void>;
}

interface MemoryHit {
  id: string;
  content: string;
  type: "fact" | "episode" | "relation";
  score: number;
  createdAt: string;
}
```

Communication: LMD daemon exposes HTTP. pc2 connects via MCP over HTTP (`POST http://localhost:{port}/mcp`, JSON-RPC). Reconnection: 3 retries with 2s/4s/8s backoff. Graceful degradation on failure.

---

## 7. Conversation Summary

> **Authoritative source**: `docs/superpowers/specs/memory-and-context.md` Sections 2-3. This section is a summary.

### Two-Step Process: Freeze then Summarize

File freezing and Summary generation are **separate operations**:

**Step 1 — Freeze** (when current file reaches `freeze_threshold` = context * 30%):
1. Rename `messages-current.jsonl` to `messages-{N}.jsonl` (freeze)
2. Create new empty `messages-current.jsonl`

**Step 2 — Summarize** (when 3+ frozen files exist):
1. Call `BAML.SummarizeHistory()` on the **oldest** frozen file -> 1500-3000 tokens
2. Write to `summaries/{N}.md` via write-to-temp-then-rename

**Why delayed**: ensures a complete frozen file (bridge) always exists between Summary and current messages — zero semantic gap, no truncation.

### Summary File Lifecycle

```
summaries/{N}.md      → unprocessed, enters System Message 2
summaries/{N}.lmd.md  → processed to LMD by Dream, does NOT enter context
```

Dream renames (not deletes) summary files after extracting knowledge to LMD. Files preserved as historical record.

### Failure Recovery

| Failure Point | Recovery |
|---------------|----------|
| SummarizeHistory LLM call fails | Abort summary. Frozen file stays. Retry when next freeze triggers. |
| Summary write fails (disk full) | Abort. Frozen file stays. No data loss. |

---

## 8. Dream System (Memory Consolidation)

> **Authoritative source**: `docs/superpowers/specs/memory-and-context.md` Section 3.3. This section is a summary.

Background process that consolidates summaries into long-term memory. Runs in a Worker thread, does not block the main agent loop.

### Trigger

| Trigger | Condition | Description |
|---------|-----------|-------------|
| **Summary accumulation** | Unprocessed summaries (.md) exceed threshold | Core trigger |
| **Periodic timer** | Every N minutes (configurable) | Fallback mechanism |
| **Startup** | `pc2 chat` or `pc2 reflect start` | Processes residual summaries |

### Execution Flow

```
Dream process (Worker thread):

  1. Scan all thread directories for unprocessed summaries (*.md, exclude .lmd.md)

  2. Read corresponding original JSONL (messages-{N}.jsonl, matching summary number)

  3. BAML.ExtractMemory(messages) -> MemoryItem[]
     (Filtered: only extract knowledge with long-term value.
      Skip one-time tasks, common knowledge, context-dependent details.)

  4. For each MemoryItem: addMemory() to LMD
     No deduplication. Facts, episodes, relations all added directly.

  5. If addMemory() fails: do NOT rename summary. Log error. Retry next run.

  6. After all addMemory() succeed: rename summaries/{N}.md -> summaries/{N}.lmd.md
     Knowledge transferred from Summary to LMD.
     Summary file preserved as historical record.
     Original JSONL preserved permanently.
```

### Dream Process (Worker Thread)

```
┌─────────────────────────┐     ┌─────────────────────────┐
│      Main Thread        │     │     Worker Thread        │
│                         │     │                         │
│  pc2 chat / reflect     │     │  Dream Process          │
│  - Agent loop           │     │  - Read JSONL from disk │
│  - LLM calls (AgentChat)│     │  - LLM calls (Extract)  │
│                         │     │  - LMD writes (HTTP)    │
│         MessagePort      │     │                         │
│         ├───────────────┤────>│  abort signal           │
│         │<──────────────┤─────┤  progress log           │
└─────────────────────────┘     └─────────────────────────┘
```

No shared state between threads. Only coordination is abort signal and progress log.

### Dream Interruption

When user sends a new message:
1. Main thread sends abort signal via MessagePort
2. Worker checks abort after each summary processing
3. Already-renamed summaries (.lmd.md) won't be reprocessed
4. Current in-progress summary: unwritten LMD results discarded, next run picks it up

---

## 9. SOP System (Procedural Memory)

SOP (Standard Operating Procedure) is the agent's **procedural memory** — core behavior workflows plus execution-verified experience. Built-in SOPs are foundational, human-authored, and NOT self-evolvable. The agent can create NEW SOPs (self-evolution), but cannot modify built-in ones.

Core principle from generic-agent: **"No execution, no memory."** Agent-created SOPs only contain knowledge verified through actual execution. They capture what training data cannot provide: environment-specific pitfalls, non-obvious failure modes, verified tool chains.

### Directory Structure (Skill-like)

```
sop/
  plan/
    SKILL.md                  # Built-in, evolvable: false
  verify/
    SKILL.md                  # Built-in, evolvable: false
  dream/
    SKILL.md                  # Built-in, evolvable: false
  subagent/
    SKILL.md                  # Built-in, evolvable: false
  autonomous/
    SKILL.md                  # Built-in, evolvable: false
  memory-management/
    SKILL.md                  # Built-in, evolvable: false
  deploy-pitfalls/
    SKILL.md                  # Agent-created, evolvable: true
  (agent-created ...)         # Agent creates new SOPs through self-evolution
```

SOPs use the same file structure as Skills: directory per SOP, `SKILL.md` with YAML frontmatter + markdown body. No `README.md` index — metadata is read from each `SKILL.md` frontmatter, same as Skills auto-discovery.

### SOP Definition (SKILL.md)

```markdown
---
name: Task Planning
description: When to use structured planning — 3+ dependent steps
evolvable: false
---

# Task Planning SOP

Core workflow for complex task planning.
...
```

- **name**: Human-readable SOP name
- **description**: When this SOP should be activated (context matching)
- **evolvable**: `false` = agent cannot modify (built-in core SOP). `true` = agent can edit/delete. Default: `true` if omitted.
- **Body**: Procedural knowledge, workflows, pitfall lists — written in imperative form

### SOP Loading Flow

1. System prompt includes SOP metadata index (name + description from all `sop/*/SKILL.md` frontmatter)
2. Agent identifies matching SOP from metadata
3. Agent reads full SOP via `file_read("sop/<name>/SKILL.md")` on demand
4. Follow SOP instructions

Same progressive disclosure as Skills: metadata always loaded, body on trigger, references as needed.

### Key SOP Rules

**plan**: 3+ dependent steps -> write plan with `[ ]` checkboxes, user approval gate, `[D]` delegation markers, mandatory verification phase. 5 phases: explore → plan → execute → verify → failure handling.

**verify**: Must run (not just read code). PASS without tool evidence = invalid. Independent sub-agent does adversarial verification via `BAML.VerifyJudge`. Outputs `VERDICT: PASS | FAIL | PARTIAL`.

**autonomous**: Triggered after 30min user idle. Max 30 turns per session. Must write report. Permission boundaries: read-only is free, modifications need reporting.

**dream**: Process summaries that exist. Read corresponding JSONL, extract facts/episodes/relations into LMD (no dedup). Rename summary `.md` → `.lmd.md` after processing.

**memory-management**: Only action-verified information enters memory. Failed experiments have value. All writes through LMD MCP. Conflict resolution via timestamps + `deleteMemory`.

### Self-Evolution Mechanism (Controlled)

Agent can create NEW SOPs through experience. Cannot modify built-in SOPs.

1. **After successful task completion**: Agent identifies reusable patterns — pitfalls encountered, verified procedures, non-obvious dependencies
2. **Crystallize into new SOP**: Agent creates a new directory under `sop/` with `SKILL.md` (frontmatter: `evolvable: true`)
3. **SOP quality**: Must be pitfall-focused, not tutorial-style. Only capture what the LLM could NOT figure out from training data. No "大模型可推理的通用常识".
4. **SOP pruning**: Agent periodically reviews `evolvable: true` SOPs for relevance. Outdated procedures can be removed or consolidated.

**Safety boundary**: Agent's `file_write` and `file_edit` tools MUST check the target SOP's `evolvable` field before allowing writes. If `evolvable: false`, reject the operation.

### SOP Authorship Rules

| SOP type | Who can create | Who can edit | Who can delete |
|----------|---------------|-------------|---------------|
| Built-in (`evolvable: false`) | Human only | Human only | Human only |
| Agent-created (`evolvable: true`) | Agent (via self-evolution) | Agent + Human | Agent + Human |

Built-in SOPs are the agent's foundation. Human-authored, never touched by the agent. Agent self-evolution creates NEW SOPs only.

---

## 10. Reflect System

### Framework

```typescript
interface ReflectModule {
  name: string;
  interval: number;
  once: boolean;
  check(): Promise<string | null>;
}
```

### Built-in Modules

| Module | Interval | Function |
|--------|----------|----------|
| `autonomous` | 1800s (30min) | User idle >30 min -> run autonomous task |
| `dream` | configurable | Summary accumulation / periodic timer -> run Dream in Worker thread |
| `scheduler` | 120s (2min) | Check cron jobs for due execution |

### Cron Jobs

Stored as individual JSON files. Uses standard Unix crontab expression format.

```
data/cron/
  {jobId}.json    # { id, name, prompt, schedule: "min hour day month weekday", timezone: "Asia/Shanghai", enabled: true, lastRun: null }
```

**Schedule format** (standard 5-field crontab):

| Field | Allowed values |
|-------|---------------|
| min | 0-59 |
| hour | 0-23 |
| day (month) | 1-31 |
| month | 1-12 |
| weekday | 0-6 (0=Sunday) |

**Examples**:

| Expression | Meaning |
|-----------|---------|
| `30 9 * * *` | Every day at 09:30 |
| `0 */2 * * *` | Every 2 hours |
| `0 8 * * 1` | Every Monday at 08:00 |
| `0 0 1 * *` | First of every month at 00:00 |
| `*/10 * * * *` | Every 10 minutes |

**Parsing**: Use `cron-parser` npm package (standard, well-tested, handles all crontab features including ranges, steps, and lists).

**Timezone**: Explicit `timezone` field (default `Asia/Shanghai`), passed to cron-parser. All times in the agent are UTC+8 (per AGENTS.md rule).

**No cooldown logic needed**: Crontab expressions natively express frequency — `0 */2 * * *` means "every 2 hours" without needing a separate cooldown mechanism. After each execution, update `lastRun` timestamp. Next execution is simply the next match of the crontab expression after `lastRun`.

**Startup recovery**: On `pc2 reflect start`, re-read all cron job files, compute next run for each via cron-parser. If a job's next run is in the past (missed during downtime), queue it immediately. This handles process restart gracefully.

### Task Reports

```
data/reports/
  2026-04-25_09-00_backup-task.md
  2026-04-25_14-30_dream.md
```

### Reflect-Loop Interaction

ReflectRunner uses `setInterval` in Node.js main event loop. Serialized execution (one task at a time).

Lifecycle: `pc2 reflect start` starts agent with reflect enabled. When reflect triggers:
- If user actively chatting: queue task, notify, execute after current turn
- If no active session: execute immediately
- Task queue: in-memory array, `/reflect` command shows pending
- **Startup recovery**: on `pc2 reflect start`, re-read all cron job files from `data/cron/`, compute next run via cron-parser. Queue any jobs whose next run is in the past (missed during downtime).

---

## 11. File-Based Data Storage

### Directory Structure

```
data/
  threads/
    {threadId}/
      messages-001.jsonl         # Archived segment (frozen, read-only)
      messages-002.jsonl         # Archived segment
      ...
      messages-current.jsonl    # Active segment (append-only)
      summaries/
        002.md                   # Summary of messages-001 (unprocessed)
        003.md                   # Summary of messages-002 (unprocessed)
        001.lmd.md               # Processed to LMD by Dream (preserved)
  cron/
    {jobId}.json                # Cron jobs
  reports/
    {date}_{taskId}.md           # Execution reports
temp/
  plan_{taskId}/
    plan.md                      # Plan files
  _keyinfo                       # External intervention
  _intervene                     # External intervention
```

### JSONL Format (messages)

Each line is a complete JSON object. Append via async `appendFile(line + '\n')`.

```jsonl
{"id":"msg_1","role":"user","content":"hello","timestamp":"2026-04-25T14:00:00+08:00"}
{"id":"msg_2","role":"assistant","content":"Hi!","toolCalls":[{"name":"web_search","args":{"q":"test"},"id":"tc_1"}],"timestamp":"2026-04-25T14:00:01+08:00"}
{"id":"msg_3","role":"tool","content":"search results...","toolCallId":"tc_1","timestamp":"2026-04-25T14:00:02+08:00"}
```

### Data Safety

| Operation | Safety mechanism |
|-----------|-----------------|
| Message append | `appendFile(line + '\n')` (async). Each line is independent. If process dies mid-write, last line is malformed JSON, discarded on load. Previous lines intact. Async avoids blocking the event loop during streaming output. |
| JSON rewrite (cron jobs) | Write to `.tmp` -> `fsync` -> `rename`. Rename is atomic on POSIX. If process dies before rename, original file intact. |
| Summary write | Same write-to-temp-then-rename pattern. |

### Migration

No database schema to migrate. File format changes handled by version field in each file. Loader checks version and applies transformations if needed.

---

## 12. PDF Processing Pipeline

Primary: **MinerU** (opendatalab/MinerU). Fallback: **marker** (VikParuchuri/marker).

PDF processing is implemented as a **skill** (not a built-in tool). The skill uses the `bash` tool to call external CLI tools.

```
User provides PDF path
    |
    v
skill: pdf_process (uses bash tool internally)
    |
    +-- Call external CLI via bash
    |   Primary: magic-pdf -p input.pdf -o output_dir
    |   Fallback: marker_single input.pdf output_dir
    |
    +-- Read generated Markdown via file_read
    |
    +-- Return Markdown content to agent
    v
Output: Markdown text available for agent to use
(how to persist/index into LMD is TBD - tracked in todo)
```

---

## 13. CLI Interface

```
pc2 chat                       # Start interactive chat
pc2 chat --task "analyze PDF"  # Start with initial task
pc2 reflect start              # Start reflect background (scheduler + dream + autonomous)
pc2 reflect status             # Check reflect status
pc2 memory add "xxx" --type fact  # Manually add memory
pc2 memory search "xxx"        # Search memory
```

Chat mode uses streaming output with markdown rendering.

---

## 14. Project Directory Structure

```
pc2/
  src/
    agent/
      loop.ts               # Core ReAct loop
      prompt.ts             # System prompt builder + context assembly
      sub-agent.ts          # Sub-agent isolation
      turn-end-callback.ts    # Turn-end callback logic
      summary.ts             # Conversation Summary logic
    tools/
      registry.ts           # Tool registry + dispatch
      file-read.ts
      file-write.ts
      file-edit.ts
      bash.ts               # Shell execution with V1 security
      web-search.ts
      web-fetch.ts
      memory-search.ts       # memory_search (memory_delete is internal, dream.ts only)
      ask-user.ts
      spawn-agent.ts
    memory/
      lmd-client.ts         # LMD MCP client (HTTP JSON-RPC)
    reflect/
      types.ts
      runner.ts             # Reflect runner
      autonomous.ts         # Autonomous + Dream trigger
      scheduler.ts          # Scheduler reflect module
      dream.ts              # Dream memory consolidation logic
    storage/
      jsonl.ts              # JSONL read/write/append
      json-safe.ts          # Atomic JSON write (write-to-temp-then-rename)
      history.ts            # Message history loading + token budget
    cli/
      index.ts              # CLI entry
      chat.ts               # Interactive chat UI
  baml_src/
    chat.baml
    extract-memory.baml
    summarize-history.baml
    verify.baml
    generator.baml
  sop/
    plan/
      SKILL.md
    verify/
      SKILL.md
    dream/
      SKILL.md
    subagent/
      SKILL.md
    autonomous/
      SKILL.md
    memory-management/
      SKILL.md
  skills/
    {skill-name}/
      SKILL.md              # YAML frontmatter + markdown instructions
      references/           # Optional
      scripts/              # Optional
      assets/               # Optional
  data/                     # Runtime data (gitignored)
  temp/                     # Temp files (gitignored)
  docs/
    superpowers/
      specs/
    01.memory.md
    02.todo.md
  AGENTS.md
  package.json
  tsconfig.json
  vitest.config.ts
```

---

## 15. Testing Strategy

Per AGENTS.md section 11 (TDD first):

- Unit tests: core packages >= 80% coverage
  - Agent loop (mocked BAML + tools)
  - Tool registry and dispatch
  - JSONL read/write safety (partial write recovery)
  - Context assembly order and token budget
  - Conversation Summary trigger and summary generation
  - Last N minimum guarantee after Conversation Summary
- Integration tests: full flow coverage
  - Chat flow: user input -> agent loop -> tool dispatch -> response
  - Memory flow: Dream extract -> LMD write -> LMD search
  - Conversation Summary: token threshold -> freeze -> summary -> context loads correctly
  - Dream: summary file exists -> read JSONL -> extract memory -> write LMD (no dedup) -> rename to .lmd.md
  - Reflect: timer trigger -> dream or autonomous task -> report
- Test code >= 1/3 of total code

---

## 16. Design Principles

1. **Context is the scarcest resource.** Delegate heavy operations to sub-agents with fresh context.
2. **Tool-call evidence is mandatory.** Reading code is not verification.
3. **State is externalized to files.** plan.md checkboxes, JSONL messages, Markdown summaries. Agent can self-manage with file tools.
4. **Adversarial independence.** Verifier is separate from implementer.
5. **SOP drives behavior.** Built-in SOPs define core workflows (human-authored, not self-evolvable). Agent-created SOPs (`evolvable: true`) capture execution-verified experience. "No execution, no memory."
6. **Subsystems are independent.** SOP = built-in + agent-created SKILL.md files, Skills = human/agent capability packages, memory = LMD MCP, history = JSONL, cron = JSON. No shared database.
7. **Summary and LMD memory are mutually exclusive.** Dream transfers knowledge from Summary to LMD, then renames `.md` to `.lmd.md`. Same knowledge never appears twice in context.
8. **Summary and Recent Messages do not overlap.** Bridge frozen file guarantees zero semantic gap between Summary and current messages.
9. **Cache-friendly context assembly.** Stable prefix -> bridge + growing messages -> dynamic tail.
10. **Only implement what's in this spec.** YAGNI.
