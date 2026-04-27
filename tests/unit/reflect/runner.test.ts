import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReflectRunner } from '../../../src/reflect/runner.js';
import type { ReflectModule } from '../../../src/reflect/types.js';

describe('ReflectRunner', () => {
  let runner: ReflectRunner;

  afterEach(() => {
    if (runner) runner.stop();
  });

  it('wraps check() in try/catch — does not crash on module error', async () => {
    const badModule: ReflectModule = {
      name: 'bad',
      interval: 50,
      once: false,
      async check() { throw new Error('boom'); },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runner = new ReflectRunner([badModule]);
    runner.start();
    await new Promise(r => setTimeout(r, 100));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('accumulates tasks from check() results', async () => {
    const mod: ReflectModule = {
      name: 'test',
      interval: 50,
      once: false,
      async check() { return 'do_something'; },
    };
    const tasks: string[] = [];
    runner = new ReflectRunner([mod], (task) => { tasks.push(task); }, 50);
    runner.start();
    await new Promise(r => setTimeout(r, 200));
    expect(tasks.length).toBeGreaterThan(0);
  });
});
