# Multiline Input Design

## Problem

The CLI chat uses Node.js `readline`, which is inherently single-line. Users cannot input multiline text. Shift+Enter should insert a newline without submitting the input.

## Approach

Replace `readline.question()` with a custom raw keypress input handler. Zero new dependencies.

## New File: `src/cli/input.ts`

Export `readMultiline(prompt: string): Promise<string>`.

### Key handling

| Key | Action |
|-----|--------|
| Enter (no Shift) | Submit — resolve promise with buffer content |
| Shift+Enter / Option+Enter | Insert `\n` into buffer |
| Backspace | Delete character before cursor (cross-line) |
| Delete | Delete character at cursor |
| Left / Right arrow | Move cursor |
| Up / Down arrow | Move cursor across lines (only when buffer is multiline) |
| Home / End | Jump to start/end of current line |
| Ctrl+C | Abort — resolve with empty string, emit warning |
| Ctrl+D on empty buffer | Same as Ctrl+C |
| Ctrl+D on non-empty buffer | Delete character at cursor (like Delete) |
| Ctrl+A | Jump to start of line |
| Ctrl+E | Jump to end of line |
| Ctrl+K | Delete from cursor to end of line |
| Ctrl+U | Delete from start of line to cursor |
| Regular printable char | Insert at cursor position |

### Rendering

On each keypress:
1. Move cursor up N lines (where N = number of lines in previous render)
2. Clear from cursor to bottom of screen (`\x1b[J`)
3. Write `prompt` + buffer content
4. Position cursor at correct row/column

Use ANSI escape sequences for all cursor and screen manipulation.

### State

- `buffer: string` — the full input text
- `cursorPos: number` — cursor position within buffer (0-based)
- `previousLineCount: number` — for clearing previous render

### Edge cases

- Empty input submit → caller handles (return empty, caller re-prompts)
- Very long input wrapping at terminal width → render must count visual lines, not just `\n` count
- Terminal width query via `process.stdout.columns`

## Changes to `src/cli/chat.ts`

Replace `rl.question('\n> ', callback)` with:

```ts
const input = await readMultiline('\n> ');
```

The `rl` readline interface is still needed for `@inquirer/select` session picker (pause/resume pattern). Keep `rl` creation but stop using it for the main prompt loop.

The prompt function changes from callback-style to async/await:

```ts
const prompt = async () => {
  const input = await readMultiline('\n> ');
  if (!input.trim()) { prompt(); return; }
  // ... rest of handling unchanged ...
  prompt();
};
```

## Out of Scope

- Input history (up arrow to recall previous inputs)
- Syntax highlighting
- Paste handling (raw mode handles paste as rapid keypress events by default)

## Testing

Unit tests with mocked `process.stdin` / `process.stdout`:
- Single line input + Enter submits
- Shift+Enter inserts newline, then Enter submits multiline
- Backspace across line boundary
- Ctrl+C aborts with empty string
- Ctrl+A / Ctrl+E navigation
