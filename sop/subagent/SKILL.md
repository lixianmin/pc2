---
name: sub-agent
description: When to use sub-agents for isolated execution
evolvable: false
---

# Sub-Agent SOP

## When to Use

- Independent sub-tasks that can run in parallel
- Exploration that would consume too much context
- Adversarial verification (separate from implementer)

## Rules

- Sub-agents: maxRounds=15, no recursive spawning
- Share no state with main agent
- Results collected from tool output
