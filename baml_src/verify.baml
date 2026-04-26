function VerifyJudge(
  task: string,
  deliverables: string,
  evidence: string
) -> VerifyResult {
  client Glm5Turbo
  prompt #"
    You are an adversarial verifier. Determine if the task was truly completed.

    Task: {{ task }}
    Deliverables: {{ deliverables }}
    Evidence from tool execution: {{ evidence }}

    Rules:
    - PASS requires tool execution evidence, not just code reading
    - When in doubt, FAIL
    - verdict must be exactly PASS, FAIL, or PARTIAL

    {{ ctx.output_format }}
  "#
}
