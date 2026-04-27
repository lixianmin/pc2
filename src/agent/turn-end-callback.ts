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
  'done',
  'finished',
  'all steps done',
  'verification passed',
];

function isCompletionClaim(text: string): boolean {
  const lower = text.toLowerCase();
  return COMPLETION_PATTERNS.some((p) => lower.includes(p));
}

export function turnEndCallback(turn: number, ctx: CallbackContext): string | null {
  if (ctx.consecutiveFailures >= 3 && ctx.lastFailedTool) {
    return `[Anti-Loop] Tool "${ctx.lastFailedTool}" has failed ${ctx.consecutiveFailures} times consecutively. You MUST use a completely different approach or use ask_user to ask for guidance. Do NOT call ${ctx.lastFailedTool} again.`;
  }

  if (turn > 0 && turn % 7 === 0) {
    return `[Anti-Loop Warning] Turn ${turn}: you may be repeating a failed approach. Change strategy.`;
  }

  if (turn >= 60) {
    return `[DANGER] Turn ${turn} — extremely long execution. Use ask_user to report progress and confirm continuation.`;
  }

  if (turn > 25) {
    return `[Safety] Turn ${turn} exceeds safe limit. Use ask_user to report progress and ask if you should continue.`;
  }

  if (ctx.planFile && isCompletionClaim(ctx.lastResponse) && !ctx.hasVerificationEvidence) {
    return `[Blocked] Completion claimed without verification. spawn_agent to run independent verification first.`;
  }

  if (ctx.planFile && turn >= 10 && turn % 5 === 0) {
    return `[Plan Reminder] file_read(${ctx.planFile}) — check current step, continue execution.`;
  }

  return null;
}
