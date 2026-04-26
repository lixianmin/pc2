---
name: Task Planning
description: When task has 3+ dependent steps — use structured planning
evolvable: false
---

# Task Planning SOP

## When to Plan

Task has 3+ steps with dependencies between them.

## 5-Phase Workflow

### Phase I: Explore
- Use spawn_agent to explore codebase and environment
- Produce exploration findings

### Phase II: Plan
- Write plan.md with checkboxes: `[ ]` todo, `[x]` done, `[D]` delegated, `[P]` partial
- Use ask_user to confirm plan before execution

### Phase III: Execute
- Each turn: file_read(plan.md) -> execute first `[ ]` -> file_edit mark `[x result]`

### Phase IV: Verify
- spawn_agent for independent verification (reads sop/verify/SKILL.md)
- BAML.VerifyJudge structured output: PASS | FAIL | PARTIAL

### Phase V: Failure Handling
- Repair -> re-verify (max 2 rounds)
- If still failing: ask_user for guidance
