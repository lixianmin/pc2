# CLI Autocomplete & Session Picker Design

> **Status: Partially superseded.** Tab completion via readline `completer` callback is no longer possible since stdin was switched to raw mode (see `2026-04-27-multiline-input-design.md`). Tab now inserts 2 spaces. The session picker part remains valid and implemented.

## Goal

Add Tab completion for `/` commands and an interactive session picker (up/down arrows + Enter to resume) to the chat REPL.

## Scope

- Tab completion: only `/` commands (`/sessions`, `/resume`, `/help`)
- Session picker: `@inquirer/select` interactive list, up/down + Enter to resume
- No argument completion, no file path completion

## Architecture

1. **Tab completion**: Node.js `readline` built-in `completer` callback. When input starts with `/`, filter command list and show candidates.
2. **Session picker**: Replace the text-only `/sessions` handler with `@inquirer/select`. User picks a session, it resumes immediately.
3. `/sessions` + `/resume <N>` still work as before (fallback for non-interactive use).

## Changes

- `src/cli/chat.ts`: add `completer` to `readline.createInterface`; replace `handleSessions()` with `@inquirer/select`
- `package.json`: add `@inquirer/select` dependency
- Tests: unit test for completer function; integration test for session picker flow

## Commands list

```
/sessions — list sessions with interactive picker
/resume <N> — resume session by number
/help — show available commands
```
