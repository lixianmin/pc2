import { readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { readJsonl } from './jsonl.js';
import { getFrozenFiles, getCurrentFile } from './history.js';
import { serializeMessages } from '../agent/prompt.js';
import type { Message } from '../types.js';

export interface ThreadMeta {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  preview: string;
}

export async function writeMeta(threadDir: string, meta: ThreadMeta): Promise<void> {
  const filePath = join(threadDir, 'meta.json');
  await writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8');
}

export async function readMeta(threadDir: string): Promise<ThreadMeta | null> {
  const filePath = join(threadDir, 'meta.json');
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ThreadMeta;
  } catch {
    return null;
  }
}

export async function updateMeta(threadDir: string, patch: Partial<ThreadMeta>): Promise<void> {
  const existing = await readMeta(threadDir);
  if (!existing) {
    throw new Error(`meta.json not found in ${threadDir}`);
  }
  const merged: ThreadMeta = { ...existing, ...patch };
  await writeMeta(threadDir, merged);
}

export async function listThreads(dataDir: string, limit: number = 10): Promise<ThreadMeta[]> { // 10: reasonable default for a single page of recent threads
  const threadsDir = join(dataDir, 'threads');
  let entries: string[];
  try {
    entries = await readdir(threadsDir);
  } catch {
    return [];
  }

  const metas: ThreadMeta[] = [];
  for (const entry of entries) {
    const threadDir = join(threadsDir, entry);
    const meta = await readMeta(threadDir);
    if (meta) {
      metas.push(meta);
    }
  }

  metas.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return metas.slice(0, limit);
}

export async function loadThreadHistory(threadDir: string): Promise<string> {
  const frozenFiles = await getFrozenFiles(threadDir);
  const currentFile = getCurrentFile(threadDir);

  const allMessages: Message[] = [];
  for (const f of frozenFiles) {
    const msgs = await readJsonl<Message>(f);
    allMessages.push(...msgs);
  }
  const currentMsgs = await readJsonl<Message>(currentFile);
  allMessages.push(...currentMsgs);

  if (allMessages.length === 0) return '';
  return serializeMessages(allMessages);
}
