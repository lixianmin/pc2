import type { ReflectModule } from './types.js';

export class ReflectRunner {
  private timers: NodeJS.Timeout[] = [];
  private taskQueue: string[] = [];

  constructor(private modules: ReflectModule[]) {}

  start(): void {
    for (const mod of this.modules) {
      const timer = setInterval(async () => {
        const task = await mod.check();
        if (task) {
          this.taskQueue.push(task);
        }
      }, mod.interval);
      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  pollQueue(): string | null {
    return this.taskQueue.shift() ?? null;
  }

  get pendingCount(): number {
    return this.taskQueue.length;
  }
}
