import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCronSchedulerModule } from '../../../src/reflect/scheduler.js';

describe('cron scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires when scheduled time has passed', async () => {
    const baseTime = new Date('2026-04-27T09:00:00+08:00');
    vi.setSystemTime(baseTime);

    const mod = createCronSchedulerModule([{
      expression: '30 9 * * *',
      task: 'morning_report',
      timezone: 'Asia/Shanghai',
      enabled: true,
    }], 60_000);

    let result = await mod.check();
    expect(result).toBeNull();

    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    result = await mod.check();
    expect(result).toBe('morning_report');
  });

  it('does not fire again immediately after first fire', async () => {
    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    const mod = createCronSchedulerModule([{
      expression: '30 9 * * *',
      task: 'morning_report',
      timezone: 'Asia/Shanghai',
      enabled: true,
    }], 60_000);

    const result1 = await mod.check();
    expect(result1).toBe('morning_report');

    const result2 = await mod.check();
    expect(result2).toBeNull();
  });

  it('skips disabled jobs', async () => {
    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    const mod = createCronSchedulerModule([{
      expression: '30 9 * * *',
      task: 'disabled_task',
      timezone: 'Asia/Shanghai',
      enabled: false,
    }], 60_000);

    const result = await mod.check();
    expect(result).toBeNull();
  });

  it('handles multiple jobs with different schedules', async () => {
    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    const mod = createCronSchedulerModule([
      { expression: '30 9 * * *', task: 'job_a', timezone: 'Asia/Shanghai', enabled: true },
      { expression: '0 10 * * *', task: 'job_b', timezone: 'Asia/Shanghai', enabled: true },
    ], 60_000);

    const result = await mod.check();
    expect(result).toContain('job_a');
    expect(result).not.toContain('job_b');
  });

  it('fires again next day', async () => {
    vi.setSystemTime(new Date('2026-04-27T09:31:00+08:00'));
    const mod = createCronSchedulerModule([{
      expression: '30 9 * * *',
      task: 'daily',
      timezone: 'Asia/Shanghai',
      enabled: true,
    }], 60_000);

    await mod.check();

    vi.setSystemTime(new Date('2026-04-28T09:31:00+08:00'));
    const result = await mod.check();
    expect(result).toBe('daily');
  });
});
