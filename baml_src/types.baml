class ToolCall {
  name string
  arguments string
  id string
}

class ChatResponse {
  text string
  tool_calls ToolCall[]
}

class VerifyResult {
  verdict string
  details string
}