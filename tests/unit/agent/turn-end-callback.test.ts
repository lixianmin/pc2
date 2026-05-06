import { describe, it, expect } from 'vitest';
import { turnEndCallback } from '../../../src/agent/turn-end-callback.js';
import type { CallbackContext } from '../../../src/agent/turn-end-callback.js';

const baseCtx: CallbackContext = {
  planFile: null,
  lastResponse: '',
  dataDir: '/tmp',
  hasVerificationEvidence: false,
  consecutiveFailures: 0,
  lastFailedTool: null,
};

describe('turnEndCallback', () => {
  it('returns null for normal turn', () => {
    expect(turnEndCallback(3, baseCtx)).toBeNull();
  });

  it('returns null for turn 0', () => {
    expect(turnEndCallback(0, baseCtx)).toBeNull();
  });

  it('returns anti-loop warning at turn 7', () => {
    const result = turnEndCallback(7, baseCtx);
    expect(result).not.toBeNull();
    expect(result).toContain('Anti-Loop');
    expect(result).toContain('7');
  });

  it('returns anti-loop warning at turn 14', () => {
    const result = turnEndCallback(14, baseCtx);
    expect(result).toContain('Anti-Loop');
  });

  it('returns null at turn 26 (below new 50 safety threshold)', () => {
    expect(turnEndCallback(26, baseCtx)).toBeNull();
  });

  it('returns null at turn 30 (below new 50 safety threshold)', () => {
    expect(turnEndCallback(30, baseCtx)).toBeNull();
  });

  it('returns safety warning at turn 60 (periodic after 50 threshold)', () => {
    const result = turnEndCallback(60, baseCtx);
    expect(result).toContain('Safety');
  });

  it('returns DANGER at threshold turn 200', () => {
    const result = turnEndCallback(200, baseCtx);
    expect(result).toContain('DANGER');
    expect(result).toContain('200');
  });

  it('returns DANGER at periodic interval after threshold 205', () => {
    const result = turnEndCallback(205, baseCtx);
    expect(result).toContain('DANGER');
  });

  it('does not return DANGER between periodic intervals', () => {
    const result = turnEndCallback(61, baseCtx);
    expect(result).toBeNull();
  });

  it('returns plan reminder at turn 10 with plan file', () => {
    const ctx: CallbackContext = { ...baseCtx, planFile: '/path/to/plan.md' };
    const result = turnEndCallback(10, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('Plan Reminder');
    expect(result).toContain('/path/to/plan.md');
  });

  it('returns plan reminder at turn 15 with plan file', () => {
    const ctx: CallbackContext = { ...baseCtx, planFile: '/plan.md' };
    const result = turnEndCallback(15, ctx);
    expect(result).toContain('Plan Reminder');
  });

  it('returns null for plan reminder without plan file', () => {
    const result = turnEndCallback(10, baseCtx);
    expect(result).toBeNull();
  });

  it('blocks completion claim without verification', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      planFile: '/plan.md',
      lastResponse: 'The task is complete, all done.',
      hasVerificationEvidence: false,
    };
    const result = turnEndCallback(5, ctx);
    expect(result).not.toBeNull();
    expect(result).toContain('Blocked');
    expect(result).toContain('verification');
  });

  it('does not block when verification evidence exists', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      planFile: '/plan.md',
      lastResponse: 'The task is complete.',
      hasVerificationEvidence: true,
    };
    const result = turnEndCallback(5, ctx);
    expect(result).toBeNull();
  });

  it('does not block without plan file', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      lastResponse: 'Task complete!',
      hasVerificationEvidence: false,
    };
    const result = turnEndCallback(5, ctx);
    expect(result).toBeNull();
  });

  it('anti-loop takes priority over safety at turn 28', () => {
    const result = turnEndCallback(28, baseCtx);
    expect(result).toContain('Anti-Loop');
  });

  it('returns safety warning at turn 51 (first trigger after new threshold)', () => {
    const result = turnEndCallback(51, baseCtx);
    expect(result).toContain('Safety');
    expect(result).not.toContain('DANGER');
  });

  it('returns DANGER at turn 200 when no other rule fires', () => {
    const result = turnEndCallback(200, baseCtx);
    expect(result).toContain('DANGER');
  });

  it('completion block fires at any turn when conditions met', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      planFile: '/plan.md',
      lastResponse: 'all steps done',
      hasVerificationEvidence: false,
    };
    const result = turnEndCallback(2, ctx);
    expect(result).toContain('Blocked');
  });

  it('recognizes "finished" as completion claim', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      planFile: '/plan.md',
      lastResponse: 'I have finished the work.',
      hasVerificationEvidence: false,
    };
    const result = turnEndCallback(3, ctx);
    expect(result).toContain('Blocked');
  });

  it('recognizes "verification passed" as completion claim', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      planFile: '/plan.md',
      lastResponse: 'verification passed successfully',
      hasVerificationEvidence: false,
    };
    const result = turnEndCallback(3, ctx);
    expect(result).toContain('Blocked');
  });

  it('returns null for 3 consecutive failures (exit handled in loop.ts)', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      consecutiveFailures: 3,
      lastFailedTool: 'web_search',
    };
    expect(turnEndCallback(2, ctx)).toBeNull();
  });

  it('returns null for 5 consecutive failures (exit handled in loop.ts)', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      consecutiveFailures: 5,
      lastFailedTool: 'fetch_url',
    };
    expect(turnEndCallback(4, ctx)).toBeNull();
  });

  it('does not return anti-loop on fewer than 3 consecutive failures', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      consecutiveFailures: 2,
      lastFailedTool: 'web_search',
    };
    const result = turnEndCallback(2, ctx);
    expect(result).toBeNull();
  });

  it('periodic anti-loop fires at turn 7 regardless of consecutiveFailures', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      consecutiveFailures: 3,
      lastFailedTool: 'file_edit',
    };
    const result = turnEndCallback(7, ctx);
    expect(result).toContain('Anti-Loop Warning');
    expect(result).not.toContain('file_edit');
  });

  it('completion claim fires at turn 30 (between safety and danger thresholds)', () => {
    const ctx: CallbackContext = {
      ...baseCtx,
      planFile: '/plan.md',
      lastResponse: 'task complete',
      hasVerificationEvidence: false,
    };
    const result = turnEndCallback(30, ctx);
    expect(result).toContain('Blocked');
  });

  it('plan reminder fires at turn 15 with plan file', () => {
    const ctx: CallbackContext = { ...baseCtx, planFile: '/plan.md' };
    const result = turnEndCallback(15, ctx);
    expect(result).toContain('Plan Reminder');
  });
});

describe('isCompletionClaim edge cases', () => {
  const makeCtx = (lastResponse: string): CallbackContext => ({
    ...baseCtx,
    planFile: '/plan.md',
    lastResponse,
    hasVerificationEvidence: false,
  });

  it('DOES block on standalone "Done."', () => {
    expect(turnEndCallback(5, makeCtx('Done.'))).toContain('Blocked');
  });

  it('DOES block on "I am done."', () => {
    expect(turnEndCallback(5, makeCtx('I am done.'))).toContain('Blocked');
  });

  it('DOES block on "All finished."', () => {
    expect(turnEndCallback(5, makeCtx('All finished.'))).toContain('Blocked');
  });

  it('does NOT block on "doner kebab" (word-internal, not standalone)', () => {
    // \bdone\b does not match word-internal "done" in "doner"
    expect(turnEndCallback(5, makeCtx('order a doner kebab'))).toBeNull();
  });

  it('blocks "step 3 is done" (standalone word — safety net catches it)', () => {
    // Word boundary matches "done" as standalone word.
    // Acceptable tradeoff: callback is a safety net, not a final arbiter.
    expect(turnEndCallback(5, makeCtx('step 3 is done, moving to step 4'))).toContain('Blocked');
  });

  it('blocks "I\'m done with the analysis" (standalone word)', () => {
    expect(turnEndCallback(5, makeCtx('I\'m done with the analysis'))).toContain('Blocked');
  });

  it('blocks "the build is finished" (standalone word)', () => {
    expect(turnEndCallback(5, makeCtx('the build is finished, now testing'))).toContain('Blocked');
  });
});
