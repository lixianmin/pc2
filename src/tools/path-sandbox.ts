import { resolve, dirname } from 'path';
import { realpathSync } from 'fs';

function safeRealPath(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

// NOTE: This check has a TOCTOU race — a symlink could be swapped between
// validation and the actual file operation. Acceptable for a single-user CLI
// tool; in a multi-tenant context, use O_NOFOLLOW on the final file descriptor.
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
