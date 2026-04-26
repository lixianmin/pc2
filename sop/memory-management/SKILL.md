---
name: Memory Management
description: How memory is managed — LMD only through Dream
evolvable: false
---

# Memory Management SOP

## Principles

1. Only action-verified information enters memory
2. All writes through LMD MCP (via Dream process only)
3. "No execution, no memory"
4. Failed experiments have value — record them
5. Conflict resolution: timestamps + deleteMemory

## Types

- fact: Immutable truths, never decays
- episode: Time-sensitive events, 15-day half-life
- relation: Currently-true relationships, slow decay (floor 0.7)
