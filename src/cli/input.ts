import * as readline from 'readline';

export function readMultiline(prompt: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      resolve(null);
      return;
    }

    let buffer = '';
    let cursorPos = 0;
    let previousVisualLines = 0;
    let resolved = false;

    const termWidth = () => stdout.columns || 80;
    const promptLines = prompt.split('\n');
    const promptLastLineLen = promptLines[promptLines.length - 1].length;

    function visualLineCount(text: string): number {
      const tw = termWidth();
      const segments = text.split('\n');
      let count = 0;
      for (let i = 0; i < segments.length; i++) {
        const offset = i === 0 ? promptLastLineLen : 0;
        const len = segments[i].length + offset;
        count += Math.max(1, Math.ceil(len / tw));
      }
      return count + (promptLines.length - 1);
    }

    function getLineInfo(): { row: number; col: number } {
      const beforeCursor = buffer.slice(0, cursorPos);
      const lines = beforeCursor.split('\n');
      const row = lines.length - 1;
      const col = lines[lines.length - 1].length;
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
      stdout.write(prompt + buffer);

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
        const len = segments[i].length + off;
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
      stdin.removeListener('keypress', onKeypress);
      stdin.removeListener('end', onEnd);
      stdout.removeListener('resize', onResize);
      if (previousVisualLines > 1) {
        stdout.write(`\x1b[${previousVisualLines - 1}A`);
      }
      stdout.write('\x1b[J');
      if (writeBuffer) {
        stdout.write(prompt + buffer);
      }
      stdout.write('\n');
      if (stdin.isRaw) {
        stdin.setRawMode(false);
      }
      stdin.pause();
    }

    function onKeypress(_str: string | undefined, key: readline.Key): void {
      if (resolved) return;

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

      if (key.name === 'return') {
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
        }
        render();
        return;
      }

      if (key.name === 'delete') {
        if (cursorPos < buffer.length) {
          buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
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
        buffer = buffer.slice(0, cursorPos) + '  ' + buffer.slice(cursorPos);
        cursorPos += 2;
        render();
        return;
      }

      if (_str && _str.length > 0 && !key.ctrl && !key.meta) {
        buffer = buffer.slice(0, cursorPos) + _str + buffer.slice(cursorPos);
        cursorPos += _str.length;
        render();
        return;
      }
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
    readline.emitKeypressEvents(stdin);
    stdin.on('keypress', onKeypress);
    stdin.on('end', onEnd);
    stdout.on('resize', onResize);

    render();
  });
}
