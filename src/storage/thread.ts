import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { assembleContext } from './context.js';
import { writeJsonAtomic } from './json-safe.js';
import type { Message } from '../types.js';

export interface ThreadMeta {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  preview: string;
}

export async function writeMeta(threadDir: string, meta: ThreadMeta): Promise<void> {
  await writeJsonAtomic(join(threadDir, 'meta.json'), meta);
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

const updateLocks = new Map<string, Promise<void>>();

async function acquireUpdateLock(threadDir: string): Promise<() => void> {
  const prev = updateLocks.get(threadDir) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  updateLocks.set(threadDir, next);
  await prev;
  return release!;
}

export async function updateMeta(threadDir: string, patch: Partial<ThreadMeta>): Promise<void> {
  const release = await acquireUpdateLock(threadDir);
  try {
    const existing = await readMeta(threadDir);
    if (!existing) {
      throw new Error(`meta.json not found in ${threadDir}`);
    }
    const merged: ThreadMeta = { ...existing, ...patch };
    await writeMeta(threadDir, merged);
  } finally {
    release();
  }
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
  return assembleContext(threadDir);
}
