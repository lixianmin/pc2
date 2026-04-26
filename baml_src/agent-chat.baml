function AgentChat(
  messages: string,
  tools_description: string
) -> ChatResponse {
  client Glm5Turbo
  prompt #"
    You are a personal AI agent. Follow your instructions and use tools when needed.

    {{ messages }}

    Available tools:
    {{ tools_description }}

    {{ ctx.output_format }}
  "#
}
