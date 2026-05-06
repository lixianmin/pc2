import { config } from '../config.js';

export interface CallbackContext {
  planFile: string | null;
  lastResponse: string;
  dataDir: string;
  hasVerificationEvidence: boolean;
  consecutiveFailures: number;
  lastFailedTool: string | null;
}

const COMPLETION_PATTERNS = [
  'task complete',
  'all steps done',
  'verification passed',
];

// `done` and `finished` are common words — use word boundaries to avoid
// matching substrings like "doner kebab".  Some false positives remain
// (e.g. "step 3 is done"); the callback is a safety net, not a final arbiter.
const SINGLE_WORD_COMPLETION = /\b(?:done|finished)\b/i;

function isCompletionClaim(text: string): boolean {
  if (SINGLE_WORD_COMPLETION.test(text)) return true;
  const lower = text.toLowerCase();
  return COMPLETION_PATTERNS.some((p) => lower.includes(p));
}

export function turnEndCallback(turn: number, ctx: CallbackContext): string | null {
  // Priority 1: periodic anti-loop check (consecutive-failure exit handled in loop.ts)
  if (turn > 0 && turn % config.antiLoopInterval === 0) {
    return `[Anti-Loop Warning] Turn ${turn}: you may be repeating a failed approach. Change strategy.`;
  }

  // Priority 3: specific checks (plan/completion) before generic safety — these are more actionable
  if (ctx.planFile && isCompletionClaim(ctx.lastResponse) && !ctx.hasVerificationEvidence) {
    return `[Blocked] Completion claimed without verification. spawn_agent to run independent verification first.`;
  }

  if (ctx.planFile && turn >= 10 && turn % 5 === 0) {
    return `[Plan Reminder] file_read(${ctx.planFile}) — check current step, continue execution.`;
  }

  // Priority 4: hard danger limit
  if (turn >= config.dangerTurnThreshold && (turn === config.dangerTurnThreshold || turn % 5 === 0)) {
    return `[DANGER] Turn ${turn} — extremely long execution. Use ask_user to report progress and confirm continuation.`;
  }

  if (turn > config.forceAskUserTurn && (turn === config.forceAskUserTurn + 1 || turn % 5 === 0)) {
    return `[Safety] Turn ${turn} exceeds safe limit. Use ask_user to report progress and ask if you should continue.`;
  }

  return null;
}
