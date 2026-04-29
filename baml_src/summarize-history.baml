function SummarizeHistory(
  messages: string
) -> string {
  client GLM
  prompt #"
    Summarize this conversation segment. Cover: Tasks, Key Decisions, Code/File Changes,
    Important Information Discovered, User Preferences Expressed, Unresolved Issues.
    Output 1500-3000 tokens of narrative summary.

    {{ messages }}

    {{ ctx.output_format }}
  "#
}

test TestSummarizeHistory {
  functions [SummarizeHistory]
  args {
    messages #"
      [User]
      Create a new file called config.json with default settings.

      [Assistant]
      I'll create the config.json file with default settings.

      [Tool Call: file_write]({"path":"/project/config.json","content":"{\"theme\":\"dark\",\"lang\":\"zh\"}"})

      [Tool Result: file_write]
      Written to /project/config.json

      [Assistant]
      Done! Created config.json with theme=dark and lang=zh defaults.

      [User]
      Great, now add a port field set to 8080.

      [Assistant]
      I'll edit the config to add the port field.

      [Tool Call: file_edit]({"path":"/project/config.json","old_string":"{\"theme\":\"dark\",\"lang\":\"zh\"}","new_string":"{\"theme\":\"dark\",\"lang\":\"zh\",\"port\":8080}"})

      [Tool Result: file_edit]
      Edited /project/config.json

      [Assistant]
      Added port: 8080 to config.json.
    "#
  }
}
