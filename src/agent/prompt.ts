import type { Message, MemoryHit } from '../types.js';
import type { SkillDefinition } from '../skill-sop/types.js';

const AGENT_IDENTITY = `You are an AI assistant with access to tools, skills, and standard operating procedures (SOPs).
Follow instructions precisely. Use tools when needed. Be concise and accurate.`;

function formatSkillList(items: SkillDefinition[]): string {
  return items.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}

export function buildSystemPrompt(
  toolsDescription: string,
  skills: SkillDefinition[],
  sops: SkillDefinition[],
): string {
  const parts: string[] = [AGENT_IDENTITY];

  if (toolsDescription) {
    parts.push(`\n## Tools\n${toolsDescription}`);
  }

  if (skills.length > 0) {
    parts.push(`\n## Skills\n${formatSkillList(skills)}`);
  }

  if (sops.length > 0) {
    parts.push(`\n## SOPs\n${formatSkillList(sops)}`);
  }

  return parts.join('\n');
}

export function serializeMessages(messages: Message[]): string {
  const toolNameMap = new Map<string, string>();

  for (const msg of messages) {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Use msg.id as key so tool results with toolCallId=msg.id can find the name
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

export function buildDynamicTail(
  userMessage: string,
  turn: number,
  relevantMemory: MemoryHit[],
  timezone?: string,
): string {
  const now = new Date();
  const timeStr = now.toLocaleString('sv-SE', {
    timeZone: timezone || 'UTC',
    hour12: false,
  });

  const parts: string[] = [];

  parts.push(`[Context]\nTime: ${timeStr}\nTurn: ${turn}`);

  if (relevantMemory.length > 0) {
    const memoryLines = relevantMemory.map((m) => `- (${m.type}, score: ${m.score.toFixed(2)}) ${m.content}`).join('\n');
    parts.push(`[Relevant Memory]\n${memoryLines}`);
  }

  parts.push(`[User Message]\n${userMessage}`);

  return parts.join('\n\n');
}
