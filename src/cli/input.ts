import {
  parseKeypress,
  enableKittyProtocol,
  disableKittyProtocol,
  type ParsedKey,
} from './parse-keypress.js';

function commonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix.length === 0) return '';
    }
  }
  return prefix;
}

export const DEFAULT_SLASH_COMMANDS = ['/sessions', '/resume', '/mode'];

export function readMultiline(prompt: string, options?: { slashCommands?: string[]; mode?: string }): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      resolve(null);
      return;
    }

    const slashCommands = options?.slashCommands ?? DEFAULT_SLASH_COMMANDS;
    const modeLabel = options?.mode;

    const MODE_COLORS: Record<string, string> = {
      default: '',
      yolo: '\x1b[91m',
      plan: '\x1b[94m',
    };

    let effectivePrompt = prompt;
    const promptLines = prompt.split('\n');
    let promptLastLineLen = promptLines[promptLines.length - 1]?.length ?? 0;

    if (modeLabel) {
      const color = MODE_COLORS[modeLabel.toLowerCase()] ?? '';
      const coloredPrefix = color ? `${color}[${modeLabel}]\x1b[0m ` : `[${modeLabel}] `;
      const visualPrefix = `[${modeLabel}] `;
      const lastNewline = prompt.lastIndexOf('\n');
      effectivePrompt = prompt.slice(0, lastNewline + 1) + coloredPrefix + prompt.slice(lastNewline + 1);
      promptLastLineLen = (promptLines[promptLines.length - 1]?.length ?? 0) + visualPrefix.length;
    }

    let lastCandidates: string[] = [];

    let buffer = '';
    let cursorPos = 0;
    let previousVisualLines = 0;
    let resolved = false;

    const termWidth = () => stdout.columns || 80;

    function vWidth(str: string): number {
      let w = 0;
      for (const ch of str) {
        w += ch.codePointAt(0)! > 0x7f ? 2 : 1; // CJK and other wide chars are double-width (codepoint > 0x7F)
      }
      return w;
    }

    function visualLineCount(text: string): number {
      const tw = termWidth();
      const segments = text.split('\n');
      let count = 0;
      for (let i = 0; i < segments.length; i++) {
        const offset = i === 0 ? promptLastLineLen : 0;
        const len = vWidth(segments[i]) + offset;
        count += Math.max(1, Math.ceil(len / tw));
      }
      return count + (promptLines.length - 1);
    }

    function getLineInfo(): { row: number; col: number } {
      const beforeCursor = buffer.slice(0, cursorPos);
      const lines = beforeCursor.split('\n');
      const row = lines.length - 1;
      const col = vWidth(lines[lines.length - 1]);
      return { row, col };
    }

    function currentLineStart(): number {
      const idx = buffer.lastIndexOf('\n', cursorPos - 1);
      return idx === -1 ? 0 : idx + 1;
    }

    function currentLineEnd(): number {
      const idx = buffer.indexOf('\n', cursorPos);
      return idx === -1 ? buffer.length : idx;
    }

    function render(): void {
      if (previousVisualLines > 1) {
        stdout.write(`\x1b[${previousVisualLines - 1}A`);
      }
      stdout.write('\x1b[J');
      stdout.write(effectivePrompt + buffer);

      const totalLines = visualLineCount(buffer);
      previousVisualLines = totalLines;

      const info = getLineInfo();
      const tw = termWidth();
      const segments = buffer.split('\n');

      const colOffset = info.row === 0 ? promptLastLineLen : 0;
      const logicalCol = colOffset + info.col;

      const visualRowOfCursor = Math.floor(logicalCol / tw);
      let visualLinesAbove = promptLines.length - 1;
      for (let i = 0; i < info.row; i++) {
        const off = i === 0 ? promptLastLineLen : 0;
        const len = vWidth(segments[i]) + off;
        visualLinesAbove += Math.max(1, Math.ceil(len / tw));
      }
      visualLinesAbove += visualRowOfCursor;

      const cursorVisualRow = visualLinesAbove;
      const rowsToMoveUp = totalLines - 1 - cursorVisualRow;
      const cursorCol = logicalCol % tw;

      if (rowsToMoveUp > 0) {
        stdout.write(`\x1b[${rowsToMoveUp}A`);
      }
      stdout.write(`\x1b[${cursorCol + 1}G`);
    }

    function cleanup(writeBuffer: boolean): void {
      if (resolved) return;
      resolved = true;
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdout.removeListener('resize', onResize);
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = null;
      }
      if (previousVisualLines > 1) {
        stdout.write(`\x1b[${previousVisualLines - 1}A`);
      }
      stdout.write('\x1b[J');
      if (writeBuffer) {
        stdout.write(effectivePrompt + buffer);
      }
      if (writeBuffer || buffer.length > 0) {
        stdout.write('\n');
      }
      disableKittyProtocol();
      if (stdin.isRaw) {
        stdin.setRawMode(false);
      }
      stdin.pause();
    }

    function onKeypress(key: ParsedKey): void {
      if (resolved) return;

      // DEBUG: log every keypress to stderr for terminal debugging
      if (process.env.DEBUG_KEYS) {
        process.stderr.write(`[key] name=${JSON.stringify(key.name)} shift=${key.shift} ctrl=${key.ctrl} meta=${key.meta} seq=${JSON.stringify(key.sequence)}\n`);
      }

      // Normalize Shift+Enter variants that parseKeypress doesn't map to name='return'+shift.
      // Ghostty CSI 27;2;13~ → name:''  |  CSI 13;2~ → name:'f3' shift:true
      if (
        (key.name === '' && /^\x1b\[\d+(?:;\d+)*;13~$/.test(key.sequence)) ||
        (key.name === '' && /^\x1b\[27;\d+;13~$/.test(key.sequence)) ||
        (key.name === 'f3' && key.shift && key.sequence === '\x1b[13;2~')
      ) {
        key = { ...key, name: 'return', shift: true };
      }

      if (key.ctrl && key.name === 'c') {
        cleanup(false);
        resolve(null);
        return;
      }

      if (key.ctrl && key.name === 'd') {
        if (buffer.length === 0) {
          cleanup(false);
          resolve(null);
          return;
        }
        if (cursorPos < buffer.length) {
          buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
        }
        render();
        return;
      }

      if (key.ctrl && key.name === 'l') {
        stdout.write('\x1b[2J\x1b[H');
        previousVisualLines = 0;
        render();
        return;
      }

      if ((key.ctrl && key.name === 'a') || (!key.ctrl && !key.meta && key.name === 'home')) {
        cursorPos = currentLineStart();
        render();
        return;
      }

      if ((key.ctrl && key.name === 'e') || (!key.ctrl && !key.meta && key.name === 'end')) {
        cursorPos = currentLineEnd();
        render();
        return;
      }

      if (key.ctrl && key.name === 'k') {
        const end = currentLineEnd();
        buffer = buffer.slice(0, cursorPos) + buffer.slice(end);
        render();
        return;
      }

      if (key.ctrl && key.name === 'u') {
        const start = currentLineStart();
        buffer = buffer.slice(0, start) + buffer.slice(cursorPos);
        cursorPos = start;
        render();
        return;
      }

      if (key.name === 'enter' || key.name === 'return') {
        if (key.shift || key.meta) {
          buffer = buffer.slice(0, cursorPos) + '\n' + buffer.slice(cursorPos);
          cursorPos += 1;
          render();
        } else {
          const result = buffer;
          cleanup(true);
          resolve(result);
        }
        return;
      }

      if (key.name === 'backspace') {
        if (cursorPos > 0) {
          buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
          cursorPos -= 1;
          lastCandidates = [];
        }
        render();
        return;
      }

      if (key.name === 'delete') {
        if (cursorPos < buffer.length) {
          buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
          lastCandidates = [];
        }
        render();
        return;
      }

      if (key.name === 'left') {
        if (cursorPos > 0) {
          cursorPos -= 1;
        }
        render();
        return;
      }

      if (key.name === 'right') {
        if (cursorPos < buffer.length) {
          cursorPos += 1;
        }
        render();
        return;
      }

      if (key.name === 'up') {
        const lines = buffer.split('\n');
        if (lines.length <= 1) return;
        const info = getLineInfo();
        if (info.row > 0) {
          const targetCol = Math.min(info.col, lines[info.row - 1].length);
          let pos = 0;
          for (let i = 0; i < info.row - 1; i++) {
            pos += lines[i].length + 1;
          }
          pos += targetCol;
          cursorPos = pos;
        }
        render();
        return;
      }

      if (key.name === 'down') {
        const lines = buffer.split('\n');
        if (lines.length <= 1) return;
        const info = getLineInfo();
        if (info.row < lines.length - 1) {
          const targetCol = Math.min(info.col, lines[info.row + 1].length);
          let pos = 0;
          for (let i = 0; i < info.row + 1; i++) {
            pos += lines[i].length + 1;
          }
          pos += targetCol;
          cursorPos = pos;
        }
        render();
        return;
      }

      if (key.name === 'tab') {
        const lineStart = buffer.lastIndexOf('\n', cursorPos - 1) + 1;
        const line = buffer.slice(lineStart, cursorPos);
        if (line.startsWith('/')) {
          const prefix = line;
          const matches = slashCommands.filter((c) => c.startsWith(prefix));
          if (matches.length === 1) {
            const completion = matches[0].slice(prefix.length);
            buffer = buffer.slice(0, cursorPos) + completion + buffer.slice(cursorPos);
            cursorPos += completion.length;
            lastCandidates = [];
          } else if (matches.length > 1) {
            const common = commonPrefix(matches);
            if (common.length > prefix.length) {
              const completion = common.slice(prefix.length);
              buffer = buffer.slice(0, cursorPos) + completion + buffer.slice(cursorPos);
              cursorPos += completion.length;
            }
            if (matches !== lastCandidates) {
              stdout.write('\n' + matches.join('  ') + '\n');
              previousVisualLines = 0;
            }
            lastCandidates = matches;
          } else {
            lastCandidates = [];
          }
          render();
          return;
        }
        cleanup(false);
        resolve('__OP_MODE_SWITCH__');
        return;
      }

      const text =
        key.text ??
        (key.isPrintable
          ? key.sequence
          : !key.ctrl && !key.meta && key.sequence.length === 1 && key.name !== 'return' && key.name !== 'enter' && key.name !== 'tab' && key.name !== 'escape' && key.name !== 'backspace'
            ? key.sequence
            : '');
      if (text && text.length > 0 && !key.ctrl && !key.meta) {
        buffer = buffer.slice(0, cursorPos) + text + buffer.slice(cursorPos);
        cursorPos += text.length;
        lastCandidates = [];
        render();
        return;
      }
    }

    let dataBuffer = '';
    let parseTimer: ReturnType<typeof setTimeout> | null = null;

    function processBuffer(): void {
      parseTimer = null;
      while (dataBuffer.length > 0) {
        if (dataBuffer[0] === '\x1b') {
          const key = parseKeypress(dataBuffer);
          if (key.name || key.sequence) {
            const consumed = key.sequence.length || 1;
            dataBuffer = dataBuffer.slice(consumed);
            onKeypress(key);
          } else {
            dataBuffer = dataBuffer.slice(1);
          }
        } else {
          const ch = dataBuffer[0];
          dataBuffer = dataBuffer.slice(1);
          onKeypress(parseKeypress(ch));
        }
      }
    }

    function tryProcessEsc(): void {
      while (dataBuffer.length > 0 && dataBuffer.startsWith('\x1b')) {
        const key = parseKeypress(dataBuffer);
        if (key.name && key.sequence === dataBuffer) {
          dataBuffer = dataBuffer.slice(key.sequence.length);
          onKeypress(key);
          continue;
        }
        // Bare ESC or incomplete sequence — wait 10ms for more data
        parseTimer = setTimeout(processBuffer, 10); // 10ms: standard ESC sequence wait timeout
        return;
      }
      if (dataBuffer.length > 0) {
        processBuffer();
      }
    }

    function onData(chunk: Buffer): void {
      dataBuffer += chunk.toString('utf-8');
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = null;
      }
      tryProcessEsc();
    }

    function onEnd(): void {
      cleanup(false);
      resolve(null);
    }

    function onResize(): void {
      render();
    }

    stdin.setRawMode(true);
    stdin.resume();
    enableKittyProtocol();
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdout.on('resize', onResize);

    render();
  });
}
