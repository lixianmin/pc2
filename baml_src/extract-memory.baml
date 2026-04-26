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

test TestExtractMemoryFact {
  functions [ExtractMemory]
  args {
    conversation #"
      [User]
      I always prefer dark mode in all my editors and tools.

      [Assistant]
      Noted! I'll remember your dark mode preference.
    "#
  }
}

test TestExtractMemoryEmpty {
  functions [ExtractMemory]
  args {
    conversation #"
      [User]
      hello

      [Assistant]
      Hi! How can I help you?
    "#
  }
}
