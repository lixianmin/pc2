import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as readline from 'readline';

vi.mock('readline', async () => {
  const actual = await vi.importActual<typeof import('readline')>('readline');
  return {
    ...actual,
    emitKeypressEvents: vi.fn(),
  };
});

function makeKey(
  name: string,
  opts?: { ctrl?: boolean; shift?: boolean; meta?: boolean },
): readline.Key {
  return {
    name,
    ctrl: opts?.ctrl ?? false,
    shift: opts?.shift ?? false,
    meta: opts?.meta ?? false,
  };
}

function mockStdin() {
  const ee = new EventEmitter() as any;
  ee.isTTY = true;
  ee.isRaw = false;
  ee.setRawMode = vi.fn((mode: boolean) => {
    ee.isRaw = mode;
  });
  ee.resume = vi.fn();
  ee.pause = vi.fn();
  ee.removeListener = ee.off.bind(ee);
  return ee;
}

function mockStdout() {
  const ee = new EventEmitter() as any;
  ee.columns = 80;
  const written: string[] = [];
  ee.write = vi.fn((data: string) => {
    written.push(data);
  });
  ee.removeListener = ee.off.bind(ee);
  return { ee, written };
}

function emitKey(stdin: any, str: string | undefined, key: readline.Key) {
  stdin.emit('keypress', str, key);
}

function setStdin(obj: any) {
  Object.defineProperty(process, 'stdin', { value: obj, writable: true, configurable: true });
}

function setStdout(obj: any) {
  Object.defineProperty(process, 'stdout', { value: obj, writable: true, configurable: true });
}

let origStdin: any;
let origStdout: any;

beforeEach(() => {
  origStdin = process.stdin;
  origStdout = process.stdout;
});

afterEach(() => {
  setStdin(origStdin);
  setStdout(origStdout);
  vi.restoreAllMocks();
});

async function tick(ms = 10) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('readMultiline', () => {
  it('single line input + Enter resolves with typed text', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'h', makeKey('h'));
    emitKey(stdin, 'i', makeKey('i'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('hi');
  });

  it('Ctrl+C resolves with null', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, undefined, makeKey('c', { ctrl: true }));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('Shift+Enter inserts newline, then Enter submits multiline', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, undefined, makeKey('return', { shift: true }));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a\nb');
  });

  it('Ctrl+D on empty buffer resolves with null', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, undefined, makeKey('d', { ctrl: true }));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('stdin not a TTY resolves with null immediately', async () => {
    const stdin = mockStdin();
    stdin.isTTY = false;
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const result = await readMultiline('> ');
    expect(result).toBeNull();
  });

  it('backspace across line boundary (a, shift+enter, b, backspace x2 → a)', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, undefined, makeKey('return', { shift: true }));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('backspace'));
    emitKey(stdin, undefined, makeKey('backspace'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('Tab inserts 2 spaces', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, undefined, makeKey('tab'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('  ');
  });

  it('Ctrl+A moves cursor to start, then typing prepends', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('a', { ctrl: true }));
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('ab');
  });

  it('Ctrl+E moves cursor to end of line', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('a', { ctrl: true }));
    emitKey(stdin, undefined, makeKey('e', { ctrl: true }));
    emitKey(stdin, 'c', makeKey('c'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('abc');
  });

  it('Ctrl+K kills to end of line', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('left'));
    emitKey(stdin, undefined, makeKey('k', { ctrl: true }));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('Ctrl+U kills to start of line', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('e', { ctrl: true }));
    emitKey(stdin, undefined, makeKey('u', { ctrl: true }));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('');
  });

  it('Delete key removes character at cursor', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('left'));
    emitKey(stdin, undefined, makeKey('delete'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('Up/Down arrows move across lines', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, undefined, makeKey('return', { shift: true }));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('up'));
    emitKey(stdin, 'x', makeKey('x'));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('ax\nb');
  });

  it('Ctrl+D on non-empty buffer deletes at cursor', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, 'a', makeKey('a'));
    emitKey(stdin, 'b', makeKey('b'));
    emitKey(stdin, undefined, makeKey('left'));
    emitKey(stdin, undefined, makeKey('d', { ctrl: true }));
    emitKey(stdin, undefined, makeKey('return'));

    const result = await promise;
    expect(result).toBe('a');
  });
});
