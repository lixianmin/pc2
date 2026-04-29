function VerifyJudge(
  task: string,
  deliverables: string,
  evidence: string
) -> VerifyResult {
  client GLM
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

test TestVerifyPass {
  functions [VerifyJudge]
  args {
    task "Add a hello function to utils.ts"
    deliverables "A hello() function in src/utils.ts"
    evidence #"
      [Tool Call: file_read]({"path":"src/utils.ts"})
      [Tool Result: file_read]
      1: export function hello(name: string): string {
      2:   return `Hello, ${name}!`;
      3: }

      [Tool Call: bash]({"command":"node -e \"const m = require('./dist/utils.js'); console.log(m.hello('World'))\""})
      [Tool Result: bash]
      Hello, World!
    "#
  }
}

test TestVerifyFail {
  functions [VerifyJudge]
  args {
    task "Add a hello function to utils.ts"
    deliverables "A hello() function in src/utils.ts"
    evidence #"
      No tool calls were made. I believe the function was already added.
    "#
  }
}
