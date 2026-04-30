import { readdir } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import type { Message } from '../types.js';

const CURRENT_PREFIX = 'messages-current';
const FROZEN_PATTERN = /^messages-(\d+)\.jsonl$/;

export function getCurrentFile(threadDir: string): string {
  return join(threadDir, `${CURRENT_PREFIX}.jsonl`);
}

export async function getFrozenFiles(threadDir: string): Promise<string[]> {
  const files = await readdir(threadDir);
  return files
    .filter((f) => FROZEN_PATTERN.test(f))
    .sort()
    .map((f) => join(threadDir, f));
}

export async function getBridgeFile(threadDir: string): Promise<string | null> {
  const frozen = await getFrozenFiles(threadDir);
  if (frozen.length < 2) return null;
  return frozen[frozen.length - 2];
}

export async function loadFrozenMessages(filePath: string): Promise<Message[]> {
  return readJsonl<Message>(filePath);
}

export async function getUnprocessedSummaries(threadDir: string): Promise<string[]> {
  const summariesDir = join(threadDir, 'summaries');
  try {
    const files = await readdir(summariesDir);
    return files
      .filter((f) => f.endsWith('.md') && !f.endsWith('.lmd.md'))
      .sort()
      .map((f) => join(summariesDir, f));
  } catch {
    return [];
  }
}

export async function getProcessedSummaries(threadDir: string): Promise<string[]> {
  const summariesDir = join(threadDir, 'summaries');
  try {
    const files = await readdir(summariesDir);
    return files
      .filter((f) => f.endsWith('.lmd.md'))
      .sort()
      .map((f) => join(summariesDir, f));
  } catch {
    return [];
  }
}
