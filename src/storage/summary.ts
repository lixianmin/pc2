import { rename, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import { getFrozenFiles, getUnprocessedSummaries } from './history.js';
import { config } from '../config.js';

export async function checkAndFreeze(
  threadDir: string,
  tokenCounter: (msgs: any[]) => Promise<number>,
): Promise<boolean> {
  const currentFile = join(threadDir, 'messages-current.jsonl');
  const messages = await readJsonl(currentFile);
  if (messages.length === 0) return false;

  const tokens = await tokenCounter(messages);
  if (tokens < config.freezeThreshold()) return false;

  const frozenFiles = await getFrozenFiles(threadDir);
  const nextNum = String(frozenFiles.length + 1).padStart(3, '0');
  const frozenPath = join(threadDir, `messages-${nextNum}.jsonl`);

  await rename(currentFile, frozenPath);
  await writeFile(currentFile, '', 'utf-8');
  return true;
}

export async function checkAndSummarize(
  threadDir: string,
  summarizeFn?: (messages: string) => Promise<string>,
): Promise<string | null> {
  const frozenFiles = await getFrozenFiles(threadDir);
  if (frozenFiles.length < 3) return null;

  const unprocessed = await getUnprocessedSummaries(threadDir);
  if (unprocessed.length > 0) return null;

  if (!summarizeFn) return null;

  const oldestFile = frozenFiles[0];
  const messages = await readJsonl(oldestFile);
  const formatted = JSON.stringify(messages);

  const summary = await summarizeFn(formatted);

  const match = oldestFile.match(/messages-(\d+)\.jsonl$/);
  const num = match![1];
  const summariesDir = join(threadDir, 'summaries');
  await mkdir(summariesDir, { recursive: true });
  const summaryPath = join(summariesDir, `${num}.md`);

  await writeFile(summaryPath, summary, 'utf-8');
  return summaryPath;
}
