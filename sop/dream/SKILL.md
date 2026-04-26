---
name: Dream
description: Memory consolidation process — summaries to LMD
evolvable: false
---

# Dream SOP

## Process

1. Scan summaries/*.md (exclude .lmd.md)
2. Read corresponding JSONL (messages-{N}.jsonl)
3. BAML.ExtractMemory -> MemoryItem[] (filtered: long-term value only)
4. addMemory() to LMD (no dedup)
5. On addMemory failure: do NOT rename summary, log error
6. On success: rename {N}.md -> {N}.lmd.md

## Content Filter

- Include: user preferences, technical decisions, execution experience
- Skip: one-time tasks, common knowledge, context-dependent details
