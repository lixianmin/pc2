import { open, rename, mkdir, readFile } from 'fs/promises';
import { dirname, resolve } from 'path';

export async function writeJsonAtomic<T>(filePath: string, data: T): Promise<void> {
  const absPath = resolve(filePath);
  const tmpPath = absPath + '.tmp';
  await mkdir(dirname(absPath), { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const fd = await open(tmpPath, 'w');
  try {
    await fd.writeFile(content, 'utf-8');
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmpPath, absPath);
}

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
