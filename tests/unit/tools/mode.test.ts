import { describe, it, expect } from 'vitest';
import { ModeManager } from '../../../src/tools/mode.js';

describe('ModeManager', () => {
  it('starts with given mode', () => {
    expect(new ModeManager('default').get()).toBe('default');
  });

  it('cycles default → yolo → plan → default', () => {
    const m = new ModeManager('default');
    expect(m.next()).toBe('yolo');
    expect(m.next()).toBe('plan');
    expect(m.next()).toBe('default');
  });

  it('shouldAsk is true only for default', () => {
    expect(new ModeManager('default').shouldAsk()).toBe(true);
    expect(new ModeManager('yolo').shouldAsk()).toBe(false);
    expect(new ModeManager('plan').shouldAsk()).toBe(false);
  });

  it('shouldAllow is true only for yolo', () => {
    expect(new ModeManager('default').shouldAllow()).toBe(false);
    expect(new ModeManager('yolo').shouldAllow()).toBe(true);
    expect(new ModeManager('plan').shouldAllow()).toBe(false);
  });

  it('shouldDeny is true only for plan', () => {
    expect(new ModeManager('default').shouldDeny()).toBe(false);
    expect(new ModeManager('yolo').shouldDeny()).toBe(false);
    expect(new ModeManager('plan').shouldDeny()).toBe(true);
  });
});
