---
name: verification
description: After completing any implementation — verify with tool evidence
evolvable: false
---

# Verification SOP

## Rules

1. Must RUN code, not just read it
2. PASS without tool evidence = invalid
3. Use spawn_agent for adversarial independent verification
4. BAML.VerifyJudge outputs: VERDICT: PASS | FAIL | PARTIAL
5. On FAIL: fix, re-verify (max 2 rounds)
