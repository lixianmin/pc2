function AgentChat(
  tools_description: string,
  chat_history: string,
  skills_list: string,
  sops_list: string,
  context_block: string,
  relevant_memory: string
) -> ChatResponse {
  client GLM
  prompt #"
    You are a personal AI agent. Follow your instructions and use tools when needed.

    You are an AI assistant with access to tools, skills, and standard operating procedures (SOPs).
    Follow instructions precisely. Use tools when needed. Be concise and accurate.

    {% if tools_description %}
    ## Tools
    {{ tools_description }}
    {% endif %}

    {% if skills_list %}
    ## Skills
    {{ skills_list }}
    {% endif %}

    {% if sops_list %}
    ## SOPs
    {{ sops_list }}
    {% endif %}

    {{ chat_history }}

    {% if context_block %}
    {{ context_block }}
    {% endif %}

    {% if relevant_memory %}
    ## Relevant Memory
    {{ relevant_memory }}
    {% endif %}

    {{ ctx.output_format }}
  "#
}

test TestAgentChatTextOnly {
  functions [AgentChat]
  args {
    tools_description "## echo\necho input"
    chat_history #"
      [User]
      Hello, what can you do?
    "#
    skills_list ""
    sops_list ""
    context_block ""
    relevant_memory ""
  }
}

test TestAgentChatToolCall {
  functions [AgentChat]
  args {
    tools_description #"
      ## file_read
      Read file contents
      Parameters: {"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}
    "#
    chat_history #"
      [User]
      Read the file /tmp/test.txt
    "#
    skills_list ""
    sops_list ""
    context_block #"
      [Context]
      Time: 2026-04-26T22:00:00+08:00
      Turn: 1

      [User Message]
      Read the file /tmp/test.txt
    "#
    relevant_memory ""
  }
}
