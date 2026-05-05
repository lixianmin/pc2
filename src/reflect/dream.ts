import { rename, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { b } from '../../baml_client/index.js';
import type { LmdMcpClient } from '../memory/lmd-client.js';
import type { MemoryItem } from '../../baml_client/types.js';
import { getUnprocessedSummaries } from '../storage/history.js';
import { readJsonl } from '../storage/jsonl.js';
import type { Message } from '../types.js';
import { logo } from '../lib/logo.js';

export interface DreamResult {
  processed: number;
  errors: number;
}

export async function runDream(
  dataDir: string,
  lmdClient: LmdMcpClient,
  abortSignal?: { aborted: boolean },
): Promise<DreamResult> {
  const result: DreamResult = { processed: 0, errors: 0 };
  const threadsDir = join(dataDir, 'threads');

  let threadDirs: string[];
  try {
    const entries = await readdir(threadsDir);
    const dirs: string[] = [];
    for (const e of entries) {
      const full = join(threadsDir, e);
      try {
        const s = await stat(full);
        if (s.isDirectory()) dirs.push(full);
      } catch {}
    }
    threadDirs = dirs;
  } catch {
    return result;
  }

  for (const threadDir of threadDirs) {
    if (abortSignal?.aborted) break;

    const unprocessed = await getUnprocessedSummaries(threadDir);
    for (const summaryPath of unprocessed) {
      if (abortSignal?.aborted) break;

      try {
        const base = basename(summaryPath);
        const num = base.replace(/\.md$/, '');
        if (!num) continue;

        const jsonlPath = join(threadDir, `messages-${num}.jsonl`);
        const messages = await readJsonl<Message>(jsonlPath);
        if (messages.length === 0) continue;

        const messagesText = messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
        logo.info('ExtractMemory request', { messages_count: messages.length, messages_text_len: messagesText.length });
        const memoryItems: MemoryItem[] = await b.ExtractMemory(messagesText);
        logo.info('ExtractMemory response', { items_count: memoryItems.length, items: memoryItems });

        for (const item of memoryItems) {
          await lmdClient.addMemory({ content: item.content });
        }

        const newPath = summaryPath.replace(/\.md$/, '.lmd.md');
        await rename(summaryPath, newPath);

        result.processed++;
      } catch (err) {
        result.errors++;
        logo.error('Dream failed to process summary', { summaryPath, err: String(err) });
      }
    }
  }

  return result;
}
