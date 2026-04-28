import { randomBytes } from 'crypto';
import { appendFile, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { mkdir } from 'fs/promises';
import type { Message, ToolCall } from '../types.js';

export async function appendJsonl<T>(filePath: string, record: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record) + '\n';
  await appendFile(filePath, line, 'utf-8');
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim() !== '');
    const results: T[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch {
        // skip malformed lines (e.g., partial write from crash)
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function countJsonlLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return 0;
  }
}

export async function appendMessage(
  dir: string,
  role: Message['role'],
  content: string,
  opts?: { toolCalls?: ToolCall[]; toolCallId?: string },
): Promise<void> {
  const id = `msg_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  await appendJsonl(join(dir, 'messages-current.jsonl'), {
    id, role, content,
    timestamp: new Date().toISOString(),
    ...opts,
  } satisfies Message);
}
