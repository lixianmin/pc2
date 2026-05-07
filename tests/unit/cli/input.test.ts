import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { parseKeypress, type ParsedKey } from '../../../src/cli/parse-keypress.js';

vi.mock('../../../src/cli/parse-keypress.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/cli/parse-keypress.js')>(
    '../../../src/cli/parse-keypress.js',
  );
  return {
    ...actual,
    enableKittyProtocol: vi.fn(),
    disableKittyProtocol: vi.fn(),
  };
});

function makeParsedKey(
  name: string,
  opts?: { ctrl?: boolean; shift?: boolean; meta?: boolean },
): ParsedKey {
  const key = parseKeypress(name.length === 1 && !opts?.ctrl ? name : '');
  return {
    ...key,
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

function emitKey(stdin: any, key: ParsedKey) {
  stdin.emit('data', Buffer.from(key.sequence));
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

function key(
  name: string,
  opts?: { ctrl?: boolean; shift?: boolean; meta?: boolean },
): ParsedKey {
  // For Shift+Return, use Kitty protocol sequence so parseKeypress sets shift=true
  if (name === 'return' && (opts?.shift || opts?.meta)) {
    const mod = 1 + (opts.shift ? 1 : 0) + (opts.meta ? 2 : 0);
    const seq = `\x1b[13;${mod}u`;
    return { name: 'return', shift: !!opts?.shift, meta: !!opts?.meta, ctrl: false, sequence: seq, raw: seq, isKittyProtocol: true, isPrintable: true };
  }

  let seq = '';
  if (name === 'return') seq = '\r';
  else if (name === 'enter') seq = '\n';
  else if (name === 'tab') seq = '\t';
  else if (name === 'backspace') seq = '\x7f';
  else if (name === 'delete') seq = '\x1b[3~';
  else if (name === 'left') seq = '\x1b[D';
  else if (name === 'right') seq = '\x1b[C';
  else if (name === 'up') seq = '\x1b[A';
  else if (name === 'down') seq = '\x1b[B';
  else if (name === 'home') seq = '\x1b[H';
  else if (name === 'end') seq = '\x1b[F';
  else if (name.length === 1 && opts?.ctrl) seq = String.fromCharCode(name.charCodeAt(0) - 96);
  else if (name.length === 1) seq = name;

  return {
    name,
    ctrl: opts?.ctrl ?? false,
    shift: opts?.shift ?? false,
    meta: opts?.meta ?? false,
    sequence: seq,
    raw: seq,
  };
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
    emitKey(stdin, key('h'));
    emitKey(stdin, key('i'));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('c', { ctrl: true }));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('return', { shift: true }));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('d', { ctrl: true }));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('return', { shift: true }));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('backspace'));
    emitKey(stdin, key('backspace'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('Tab on non-slash line resolves with mode switch sentinel', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('tab'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('__OP_MODE_SWITCH__');
  });

  it('Tab completes slash command with unique match', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    for (const ch of '/ses') emitKey(stdin, key(ch));
    emitKey(stdin, key('tab'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('/sessions');
  });

  it('Tab completes slash command with /r prefix matching /resume', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    for (const ch of '/r') emitKey(stdin, key(ch));
    emitKey(stdin, key('tab'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('/resume');
  });

  it('Tab shows candidates when multiple matches', async () => {
    const stdin = mockStdin();
    const { ee: stdout, written } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ', { slashCommands: ['/sessions', '/resume', '/save'] });

    await tick();
    emitKey(stdin, key('/'));
    emitKey(stdin, key('s'));
    emitKey(stdin, key('tab'));
    await tick();
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('/s');
    const allOutput = written.join('');
    expect(allOutput).toContain('/sessions');
    expect(allOutput).toContain('/save');
  });

  it('Tab does not complete when no match', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    for (const ch of '/xyz') emitKey(stdin, key(ch));
    emitKey(stdin, key('tab'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('/xyz');
  });

  it('Ctrl+A moves cursor to start, then typing prepends', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('b'));
    emitKey(stdin, key('a', { ctrl: true }));
    emitKey(stdin, key('a'));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('a', { ctrl: true }));
    emitKey(stdin, key('e', { ctrl: true }));
    emitKey(stdin, key('c'));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('left'));
    emitKey(stdin, key('k', { ctrl: true }));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('e', { ctrl: true }));
    emitKey(stdin, key('u', { ctrl: true }));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('left'));
    emitKey(stdin, key('delete'));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('return', { shift: true }));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('up'));
    emitKey(stdin, key('x'));
    emitKey(stdin, key('return'));

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
    emitKey(stdin, key('a'));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('left'));
    emitKey(stdin, key('d', { ctrl: true }));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('a');
  });

  it('slash character is accepted as input', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('/'));
    emitKey(stdin, key('s'));
    emitKey(stdin, key('e'));
    emitKey(stdin, key('s'));
    emitKey(stdin, key('s'));
    emitKey(stdin, key('i'));
    emitKey(stdin, key('o'));
    emitKey(stdin, key('n'));
    emitKey(stdin, key('s'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('/sessions');
  });

  it.each([
    ['!', '!cmd'],
    ['@', '@user'],
    ['#', '#tag'],
    ['$', '$var'],
    ['%', '100%'],
    ['^', 'x^2'],
    ['&', 'a&b'],
    ['*', '2*x'],
    ['(', '(x)'],
    [')', '(x)'],
    ['-', 'a-b'],
    ['_', '_var'],
    ['=', 'x=1'],
    ['+', '1+1'],
    ['[', 'arr[0]'],
    [']', 'arr[0]'],
    ['{', '{key}'],
    ['}', '{key}'],
    [';', 'a;b'],
    [':', 'key:val'],
    ["'", "it's"],
    ['"', '"hi"'],
    [',', 'a,b'],
    ['<', '<tag>'],
    ['>', '<tag>'],
    ['?', 'ok?'],
    ['~', '~home'],
    ['`', '`code`'],
    ['\\', 'a\\b'],
    ['|', 'a|b'],
  ])('symbol %s in input yields %s', async (symbol, expected) => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    for (const ch of expected) {
      if (ch === '\n') {
        emitKey(stdin, key('return', { shift: true }));
      } else {
        emitKey(stdin, key(ch));
      }
    }
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe(expected);
  });

  it('space is accepted as input', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('h'));
    emitKey(stdin, key('e'));
    emitKey(stdin, key('l'));
    emitKey(stdin, key('l'));
    emitKey(stdin, key('o'));
    emitKey(stdin, key(' '));
    emitKey(stdin, key('w'));
    emitKey(stdin, key('o'));
    emitKey(stdin, key('r'));
    emitKey(stdin, key('l'));
    emitKey(stdin, key('d'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('numbers are accepted as input', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('4'));
    emitKey(stdin, key('2'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('42');
  });

  it('multi-char chunk (paste or fast typing) is handled correctly', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    stdin.emit('data', Buffer.from('hello world'));
    await tick();
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('multi-char chunk with symbols', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    stdin.emit('data', Buffer.from('/sessions'));
    await tick();
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('/sessions');
  });

  it('multi-char chunk with mixed content', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    stdin.emit('data', Buffer.from('x=1+2*3'));
    await tick();
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('x=1+2*3');
  });

  it('ESC sequence in multi-char chunk: arrow key after text', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('a'));
    emitKey(stdin, key('b'));
    emitKey(stdin, key('left'));
    emitKey(stdin, key('x'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('axb');
  });

  it('Ghostty Shift+Enter (CSI 27;2;13~) inserts newline', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('a'));
    stdin.emit('data', Buffer.from('\x1b[27;2;13~'));
    await tick();
    emitKey(stdin, key('b'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('a\nb');
  });

  it('CSI 13;2~ (tilde-format Shift+Enter) inserts newline', async () => {
    const stdin = mockStdin();
    const { ee: stdout } = mockStdout();
    setStdin(stdin);
    setStdout(stdout);

    const { readMultiline } = await import('../../../src/cli/input.js');
    const promise = readMultiline('> ');

    await tick();
    emitKey(stdin, key('a'));
    stdin.emit('data', Buffer.from('\x1b[13;2~'));
    await tick();
    emitKey(stdin, key('b'));
    emitKey(stdin, key('return'));

    const result = await promise;
    expect(result).toBe('a\nb');
  });
});
