import type { ReflectModule } from './types.js';

export function createAutonomousModule(idleThresholdMs = 1_800_000): ReflectModule & { resetIdle(): void } {
  let lastActivity = Date.now();

  return {
    name: 'autonomous',
    interval: 60_000,
    once: false,
    async check() {
      const idle = Date.now() - lastActivity;
      if (idle >= idleThresholdMs) {
        lastActivity = Date.now();
        return 'Autonomous mode triggered — user idle for 30 minutes. Check for pending tasks or maintenance.';
      }
      return null;
    },
    resetIdle() {
      lastActivity = Date.now();
    },
  };
}
