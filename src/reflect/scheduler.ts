import { CronExpressionParser } from 'cron-parser';
import type { ReflectModule } from './types.js';

export interface CronJob {
  expression: string;
  task: string;
  timezone: string;
  enabled: boolean;
}

export function createCronSchedulerModule(
  jobs: CronJob[],
  checkIntervalMs = 120_000,
): ReflectModule {
  const lastRuns = new Map<string, number>();

  return {
    name: 'cron_scheduler',
    interval: checkIntervalMs,
    once: false,
    async check() {
      const now = Date.now();
      const tasks: string[] = [];

      for (const job of jobs) {
        if (!job.enabled) continue;
        try {
          const interval = CronExpressionParser.parse(job.expression, { tz: job.timezone });
          const prev = interval.prev().getTime();
          const last = lastRuns.get(job.task);

          if (last === undefined) {
            lastRuns.set(job.task, prev);
            if (now - prev <= checkIntervalMs) {
              tasks.push(job.task);
            }
          } else if (prev > last) {
            tasks.push(job.task);
            lastRuns.set(job.task, prev);
          }
        } catch {
          // invalid cron expression — skip
        }
      }

      return tasks.length > 0 ? tasks.join('\n') : null;
    },
  };
}
