import { resolve } from 'path';

export function isPathWithinRoot(inputPath: string, root: string): boolean {
  const resolved = resolve(inputPath);
  const resolvedRoot = resolve(root);
  return resolved.startsWith(resolvedRoot + '/') || resolved === resolvedRoot;
}
