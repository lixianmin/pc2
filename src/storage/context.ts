import { readFile } from 'fs/promises';
import { join } from 'path';
import { getFrozenFiles, getUnprocessedSummaries } from './history.js';
import { readJsonl } from './jsonl.js';
import { serializeMessages } from '../agent/prompt.js';
import type { Message } from '../types.js';

export async function assembleContext(
  threadDir: string,
  inMemorySuffix: string = '',
): Promise<string> {
  const frozen = await getFrozenFiles(threadDir);
  const unprocessedSummaries = await getUnprocessedSummaries(threadDir);

  const summaryParts: string[] = [];
  for (const s of unprocessedSummaries) {
    const content = await readFile(s, 'utf-8');
    const match = s.match(/(\d+)\.md$/);
    const label = match ? match[1] : '?';
    summaryParts.push(`[Summary: ${label}]\n${content}`);
  }

  let recentMessages: Message[] = [];

  if (unprocessedSummaries.length > 0 && frozen.length >= 2) {
    const bridgeIdx = frozen.length - 2;
    for (let i = bridgeIdx; i < frozen.length; i++) {
      const msgs = await readJsonl<Message>(frozen[i]);
      recentMessages.push(...msgs);
    }
  } else {
    for (const f of frozen) {
      const msgs = await readJsonl<Message>(f);
      recentMessages.push(...msgs);
    }
  }

  const currentFile = join(threadDir, 'messages-current.jsonl');
  const currentMsgs = await readJsonl<Message>(currentFile);
  recentMessages.push(...currentMsgs);

  if (summaryParts.length === 0 && recentMessages.length === 0 && !inMemorySuffix) {
    return '';
  }

  const parts: string[] = [];
  if (summaryParts.length > 0) {
    parts.push(summaryParts.join('\n\n'));
  }
  if (recentMessages.length > 0) {
    parts.push(serializeMessages(recentMessages));
  }
  if (inMemorySuffix) {
    parts.push(inMemorySuffix);
  }

  return parts.join('\n\n');
}
