import { rename, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import { getFrozenFiles, getUnprocessedSummaries } from './history.js';
import { config } from '../config.js';
import { logo } from '../lib/logo.js';

const lockQueues = new Map<string, Promise<void>>();

async function acquireLock(threadDir: string): Promise<() => void> {
  const prev = lockQueues.get(threadDir) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  lockQueues.set(threadDir, next);
  await prev;
  return release!;
}

export async function checkAndFreeze(
  threadDir: string,
  tokenCounter: (msgs: any[]) => Promise<number>,
): Promise<boolean> {
  const release = await acquireLock(threadDir);
  try {
    const currentFile = join(threadDir, 'messages-current.jsonl');
    const messages = await readJsonl(currentFile);
    if (messages.length === 0) return false;

    const tokens = await tokenCounter(messages);
    if (tokens < config.freezeThreshold()) return false;

    const frozenFiles = await getFrozenFiles(threadDir);
    const nextNum = String(frozenFiles.length + 1).padStart(3, '0'); // 3-digit zero-padded: supports up to 999 frozen segments before overflow
    const frozenPath = join(threadDir, `messages-${nextNum}.jsonl`);

    await rename(currentFile, frozenPath);
    logo.info('Freeze completed', { file: frozenPath, tokens, messages: messages.length });
    return true;
  } finally {
    release();
  }
}

export async function checkAndSummarize(
  threadDir: string,
  summarizeFn?: (messages: string) => Promise<string>,
): Promise<string | null> {
  const frozenFiles = await getFrozenFiles(threadDir);
  if (frozenFiles.length < 3) return null;

  const unprocessed = await getUnprocessedSummaries(threadDir);
  if (unprocessed.length >= 3) return null;

  if (!summarizeFn) return null;

  const oldestFile = frozenFiles[0];
  const messages = await readJsonl(oldestFile);
  const formatted = JSON.stringify(messages);

  const summary = await summarizeFn(formatted);
  if (!summary) return null;

  const match = oldestFile.match(/messages-(\d+)\.jsonl$/);
  const num = match![1];
  const summariesDir = join(threadDir, 'summaries');
  await mkdir(summariesDir, { recursive: true });
  const summaryPath = join(summariesDir, `${num}.md`);

  await writeFile(summaryPath, summary, 'utf-8');
  logo.info('Summarize completed', { source: oldestFile, output: summaryPath, summary_len: summary.length });
  return summaryPath;
}
