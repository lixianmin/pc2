function ExtractMemory(
  conversation: string
) -> MemoryItem[] {
  client Glm5Turbo
  prompt #"
    Extract knowledge with long-term value from this conversation.
    Types: fact (immutable truth), episode (time-sensitive event), relation (currently-true relationship).

    SKIP: one-time tasks, common knowledge, context-dependent details.
    Only extract what a trained LLM could NOT infer from general knowledge.

    {{ conversation }}

    {{ ctx.output_format }}
  "#
}
