import { Command } from 'commander';
import { startChat } from './chat.js';
import { config } from '../config.js';
import { logo } from '../lib/logo.js';

const program = new Command();

program
  .name('pc2')
  .description('Personal AI Agent')
  .version('1.0.0');

program
  .command('chat')
  .description('Start interactive chat')
  .option('--task <task>', 'Start with initial task')
  .action(async (opts) => {
    logo.info('pc2 chat starting');
    await startChat({ initialTask: opts.task });
  });

const reflectCmd = program.command('reflect').description('Reflect system operations');

reflectCmd
  .command('start')
  .description('Start reflect background (scheduler + dream + autonomous)')
  .action(async () => {
    logo.init({ console: true });
    const { ReflectRunner } = await import('../reflect/runner.js');
    const { createAutonomousModule } = await import('../reflect/autonomous.js');
    const { createCronSchedulerModule } = await import('../reflect/scheduler.js');

    const runner = new ReflectRunner(
      [createAutonomousModule(), createCronSchedulerModule([])],
      (task) => { logo.info('Reflect executing', { task }); },
    );
    runner.start();
    logo.info('Reflect started');
    console.log('Reflect started. Press Ctrl+C to stop.');
    process.on('SIGINT', () => {
      runner.stop();
      logo.close();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      runner.stop();
      logo.close();
      process.exit(0);
    });
  });

const memoryCmd = program.command('memory').description('Memory operations');

memoryCmd
  .command('add <content>')
  .option('--type <type>', 'Memory type: fact, episode, relation', 'episode')
  .action(async (content, opts) => {
    const { LmdMcpClient } = await import('../memory/lmd-client.js');
    const client = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
    const result = await client.addMemory({ content, type: opts.type });
    logo.info('Memory added', { id: result.id });
    console.log(`Added memory: ${result.id}`);
  });

memoryCmd
  .command('search <query>')
  .action(async (query) => {
    const { LmdMcpClient } = await import('../memory/lmd-client.js');
    const client = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
    const results = await client.queryMemory({ query });
    logo.info('Memory search results', { count: results.length });
    for (const r of results) {
      console.log(`[${r.type}] (${r.score.toFixed(2)}) ${r.content}`);
    }
  });

program.parse();
