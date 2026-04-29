import { resolve, dirname } from 'path';
import { realpathSync } from 'fs';

function safeRealPath(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

export function isPathWithinRoot(inputPath: string, root: string): boolean {
  const resolvedRoot = safeRealPath(resolve(root));
  // Check if the path itself resolves to root
  const resolvedInput = safeRealPath(resolve(inputPath));
  if (resolvedInput === resolvedRoot) return true;
  if (resolvedInput.startsWith(resolvedRoot + '/')) return true;
  // For non-existent files, check parent directory
  const parent = safeRealPath(resolve(dirname(inputPath)));
  return parent.startsWith(resolvedRoot + '/') || parent === resolvedRoot;
}
