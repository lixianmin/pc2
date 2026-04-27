import type { ReflectModule } from './types.js';

export class ReflectRunner {
  private timers: NodeJS.Timeout[] = [];
  private taskQueue: string[] = [];
  private consumerTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private modules: ReflectModule[],
    private onTask?: (task: string) => void | Promise<void>,
    private consumerInterval = 5_000,
  ) {}

  start(): void {
    for (const mod of this.modules) {
      const timer = setInterval(async () => {
        try {
          const task = await mod.check();
          if (task) {
            this.taskQueue.push(task);
          }
        } catch (err) {
          console.error(`[reflect] module ${mod.name} error:`, err);
        }
      }, mod.interval);
      this.timers.push(timer);
    }
    this.consumerTimer = setInterval(() => this.processQueue(), this.consumerInterval);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    if (this.consumerTimer) clearInterval(this.consumerTimer);
    this.timers = [];
    this.consumerTimer = null;
  }

  private async processQueue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      try {
        if (this.onTask) {
          await this.onTask(task);
        } else {
          console.log(`[reflect] task: ${task}`);
        }
      } catch (err) {
        console.error('[reflect] task error:', err);
      }
    }
    this.running = false;
  }

  pollQueue(): string | null {
    return this.taskQueue.shift() ?? null;
  }

  get pendingCount(): number {
    return this.taskQueue.length;
  }
}
