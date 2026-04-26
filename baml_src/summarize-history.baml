function SummarizeHistory(
  messages: string
) -> string {
  client Glm5Turbo
  prompt #"
    Summarize this conversation segment. Cover: Tasks, Key Decisions, Code/File Changes,
    Important Information Discovered, User Preferences Expressed, Unresolved Issues.
    Output 1500-3000 tokens of narrative summary.

    {{ messages }}

    {{ ctx.output_format }}
  "#
}
