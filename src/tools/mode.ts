export type AgentMode = 'default' | 'yolo' | 'plan';

export const MODE_LABELS: Record<AgentMode, string> = {
  default: 'default',
  yolo: 'YOLO',
  plan: 'plan',
};

export const MODE_CYCLE: AgentMode[] = ['default', 'yolo', 'plan'];

export class ModeManager {
  private current: AgentMode;

  constructor(initial: AgentMode) {
    this.current = initial;
  }

  get(): AgentMode {
    return this.current;
  }

  set(mode: AgentMode): void {
    this.current = mode;
  }

  next(): AgentMode {
    const idx = MODE_CYCLE.indexOf(this.current);
    this.current = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    return this.current;
  }

  shouldAsk(): boolean {
    return this.current === 'default';
  }

  shouldAllow(): boolean {
    return this.current === 'yolo';
  }

  shouldDeny(): boolean {
    return this.current === 'plan';
  }
}
