import { describe, it, expect } from 'vitest';
import { isPathWithinRoot } from '../../../src/tools/path-sandbox.js';

describe('isPathWithinRoot', () => {
  it('allows paths within root', () => {
    expect(isPathWithinRoot('/home/user/project/src/foo.ts', '/home/user/project')).toBe(true);
  });

  it('blocks path traversal with ..', () => {
    expect(isPathWithinRoot('/home/user/project/../../../etc/passwd', '/home/user/project')).toBe(false);
  });

  it('blocks absolute path outside root', () => {
    expect(isPathWithinRoot('/etc/passwd', '/home/user/project')).toBe(false);
  });

  it('handles relative paths resolving outside root', () => {
    expect(isPathWithinRoot('../../../etc/passwd', '/home/user/project')).toBe(false);
  });

  it('blocks symlink-like traversal', () => {
    expect(isPathWithinRoot('/home/user/project/../secret', '/home/user/project')).toBe(false);
  });

  it('allows exact root path', () => {
    expect(isPathWithinRoot('/home/user/project', '/home/user/project')).toBe(true);
  });
});
