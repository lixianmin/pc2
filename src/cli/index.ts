import { Command } from 'commander';
import { startChat } from './chat.js';
import { config } from '../config.js';

const program = new Command();

program
  .name('pc2')
  .description('Personal AI Agent')
  .version('0.1.0');

program
  .command('chat')
  .description('Start interactive chat')
  .option('--task <task>', 'Start with initial task')
  .action(async (opts) => {
    await startChat({ initialTask: opts.task });
  });

const reflectCmd = program.command('reflect').description('Reflect system operations');

reflectCmd
  .command('start')
  .description('Start reflect background (scheduler + dream + autonomous)')
  .action(async () => {
    const { ReflectRunner } = await import('../reflect/runner.js');
    const { createAutonomousModule } = await import('../reflect/autonomous.js');
    const { createCronSchedulerModule } = await import('../reflect/scheduler.js');

    const runner = new ReflectRunner(
      [createAutonomousModule(), createCronSchedulerModule([])],
      (task) => console.log(`[reflect] executing: ${task}`),
    );
    runner.start();
    console.log('Reflect started. Press Ctrl+C to stop.');
    process.on('SIGINT', () => {
      runner.stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      runner.stop();
      process.exit(0);
    });
  });

reflectCmd
  .command('status')
  .description('Check reflect status')
  .action(() => {
    console.log('Reflect status: checking...');
  });

const memoryCmd = program.command('memory').description('Memory operations');

memoryCmd
  .command('add <content>')
  .option('--type <type>', 'Memory type: fact, episode, relation', 'episode')
  .action(async (content, opts) => {
    const { LmdMcpClient } = await import('../memory/lmd-client.js');
    const client = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
    const result = await client.addMemory({ content, type: opts.type });
    console.log(`Added memory: ${result.id}`);
  });

memoryCmd
  .command('search <query>')
  .action(async (query) => {
    const { LmdMcpClient } = await import('../memory/lmd-client.js');
    const client = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
    const results = await client.queryMemory({ query });
    for (const r of results) {
      console.log(`[${r.type}] (${r.score.toFixed(2)}) ${r.content}`);
    }
  });

program.parse();
