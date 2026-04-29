# Multiline Input Design

## Problem

The CLI chat uses Node.js `readline`, which is inherently single-line. Users cannot input multiline text. Shift+Enter should insert a newline without submitting the input.

## Approach

Replace `readline.question()` with a custom raw keypress input handler. Zero new dependencies.

## New File: `src/cli/input.ts`

Export `readMultiline(prompt: string): Promise<string | null>`. Returns `null` on Ctrl+C abort, empty string on empty submit.

### Key handling

| Key | Action |
|-----|--------|
| Enter (no Shift) | Submit — resolve promise with buffer content |
| Shift+Enter / Option+Enter | Insert `\n` into buffer |
| Tab | Insert literal tab (2 spaces). Tab completion deferred to future work. |
| Backspace | Delete character before cursor (cross-line) |
| Delete | Delete character at cursor |
| Left / Right arrow | Move cursor one position |
| Up / Down arrow | Move cursor across lines (multiline only). When single-line, no-op. Reserved for future history. |
| Home / Ctrl+A | Jump to start of current logical line |
| End / Ctrl+E | Jump to end of current logical line |
| Ctrl+C | Abort — resolve with `null` |
| Ctrl+D on empty buffer | Same as Ctrl+C |
| Ctrl+D on non-empty buffer | Delete character at cursor (like Delete) |
| Ctrl+K | Delete from cursor to end of current logical line |
| Ctrl+U | Delete from start of current logical line to cursor |
| Ctrl+L | Clear screen, re-render prompt and buffer |
| Regular printable char | Insert at cursor position |

### Rendering

On each keypress (debounced: batch all available stdin data within a single tick before rendering):
1. Move cursor up by `previousVisualLines`
2. Clear from cursor to bottom of screen (`\x1b[J`)
3. Write `prompt` + buffer content
4. Position cursor at correct row/column

Visual line count formula:
```
termWidth = process.stdout.columns
promptLen = prompt.length   // visible length of prompt string
for each \n-delimited segment in buffer:
  isFirst ? offset = promptLen : offset = 0
  visualLines += max(1, ceil((segment.length + offset) / termWidth))
```

Use ANSI escape sequences for all cursor and screen manipulation.

### State

- `buffer: string` — the full input text
- `cursorPos: number` — cursor position within buffer (0-based), tracks JS string index (1 char = 1 position)
- `previousVisualLines: number` — visual lines of last render, for clearing

### Signals

- `SIGWINCH` → recalculate `termWidth`, re-render
- `SIGINT` (Ctrl+C in raw mode arrives as keypress, not signal) → handled in key table
- `process.stdin` `end` event → resolve with `null`

### stdin contention with `@inquirer/select`

When `handleSessions()` needs to show the session picker:
1. `readMultiline` calls `process.stdin.setRawMode(false)` and removes its keypress listener
2. `handleSessions()` runs `@inquirer/select` (which takes over stdin)
3. After select completes, `prompt()` calls `readMultiline` again, which re-enters raw mode

This means `readMultiline` is stateless between invocations — no persistent raw mode.

### Wide character handling

Deferred. Cursor positioning uses `string.length` (JS char index). **Update:** CJK support was later implemented using `vWidth()` function that counts codepoints > 0x7F as double-width. Emoji combining characters are not handled. The input handler uses `parse-keypress.ts` (extracted from ink) with Kitty keyboard protocol support for Shift+Enter detection.

## Changes to `src/cli/chat.ts`

Replace `rl.question('\n> ', callback)` with:

```ts
const input = await readMultiline('\n> ');
if (input === null) { rl.close(); return; }  // Ctrl+C → exit
```

Remove `rl` readline interface. `handleSessions()` uses `@inquirer/select` directly without `rl.pause()/resume()` (since stdin is no longer shared with readline).

The prompt function changes from callback-style to async/await:

```ts
const prompt = async () => {
  const input = await readMultiline('\n> ');
  if (input === null) { process.exit(0); }
  if (!input.trim()) { await prompt(); return; }
  // ... rest of handling unchanged ...
  await prompt();
};
```

## Out of Scope

- Input history (up arrow to recall previous inputs) — Up/Down reserved for future use
- Tab completion — Tab inserts spaces for now
- Syntax highlighting
- Wide character (CJK/emoji) cursor positioning

## Testing

Unit tests with mocked `process.stdin` / `process.stdout`:
- Single line input + Enter submits
- Shift+Enter inserts newline, then Enter submits multiline
- Backspace across line boundary
- Ctrl+C returns `null`
- Ctrl+A / Ctrl+E navigation
- Ctrl+K / Ctrl+U kill operations
- SIGWINCH triggers re-render
