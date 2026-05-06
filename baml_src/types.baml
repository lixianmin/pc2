class ToolCall {
  name string @assert(has_name, {{ this != "" }})
  arguments string
  id string @assert(has_id, {{ this != "" }})
}

class ChatResponse {
  text string
  tool_calls ToolCall[]
}

class VerifyResult {
  verdict string
  details string
}