import type { Message } from '../types.js';
import type { SkillDefinition } from '../skill-sop/types.js';

export function formatSkillList(items: SkillDefinition[]): string {
  return items.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}

export function serializeMessages(messages: Message[]): string {
  const toolNameMap = new Map<string, string>();

  for (const msg of messages) {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (let i = 0; i < msg.toolCalls.length; i++) {
        const key = msg.toolCalls.length === 1 ? msg.id : `${msg.id}:${i}`;
        toolNameMap.set(key, msg.toolCalls[i].name);
      }
    }
  }

  const lines: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        lines.push(`[User]\n${msg.content}`);
        break;
      case 'system':
        lines.push(`[System]\n${msg.content}`);
        break;
      case 'assistant': {
        let block = `[Assistant]\n${msg.content}`;
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            block += `\n[Tool Call: ${tc.name}](${JSON.stringify(tc.arguments)})`;
          }
        }
        lines.push(block);
        break;
      }
      case 'tool': {
        const toolName = msg.toolCallId ? (toolNameMap.get(msg.toolCallId) ?? 'unknown') : 'unknown';
        lines.push(`[Tool Result: ${toolName}]\n${msg.content}`);
        break;
      }
    }
  }

  return lines.join('\n');
}
