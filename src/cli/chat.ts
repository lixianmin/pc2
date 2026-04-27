import * as readline from 'readline';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { logo, LogLevel } from '../lib/logo.js';
import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { createFileReadTool } from '../tools/file-read.js';
import { createFileWriteTool } from '../tools/file-write.js';
import { createFileEditTool } from '../tools/file-edit.js';
import { createBashTool } from '../tools/bash.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createMemorySearchTool } from '../tools/memory-search.js';
import { createAskUserTool } from '../tools/ask-user.js';
import { createSpawnAgentTool } from '../tools/spawn-agent.js';
import { config } from '../config.js';

export function makeThreadDir(): string {
  const now = new Date();
  const ts = now.toLocaleString('sv-SE', {
    timeZone: config.timezone,
    hour12: false,
  }).replace(/[ :]/g, '-').replace(/--/g, '-');
  const dir = join(config.dataDir, 'threads', ts);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'summaries'), { recursive: true });
  return dir;
}

export async function startChat(options: { initialTask?: string }): Promise<void> {
  logo.init({ console: false, level: LogLevel.Info });
  const registry = new ToolRegistry();
  registry.register(createFileReadTool());
  registry.register(createFileWriteTool());
  registry.register(createFileEditTool());
  registry.register(createBashTool());
  registry.register(createWebSearchTool());
  registry.register(createWebFetchTool());
  registry.register(createMemorySearchTool());
  registry.register(createAskUserTool());
  registry.register(createSpawnAgentTool());

  const threadDir = makeThreadDir();
  logo.info('Chat thread dir', { threadDir });

  const loop = new AgentLoop(registry);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => { logo.close(); });

  const prompt = () => rl.question('\n> ', async (input) => {
    if (!input.trim()) { prompt(); return; }
    if (input === 'exit' || input === 'quit') { rl.close(); return; }

    let textYielded = false;
    for await (const event of loop.execute(input, { threadDir, dataDir: config.dataDir })) {
      if (event.type === 'text') {
        textYielded = true;
        process.stdout.write(event.content);
      } else if (event.type === 'tool_result') {
        process.stdout.write(`\n[tool: ${event.name}] ${String(event.result).slice(0, 200)}\n`);
      } else if (event.type === 'warning') {
        process.stdout.write(`\n[warning] ${event.content}\n`);
      } else if (event.type === 'done') {
        if (!textYielded) {
          logo.warn('Chat loop completed without text output', { reason: event.reason });
        }
        process.stdout.write('\n');
      }
    }
    prompt();
  });

  if (options.initialTask) {
    for await (const event of loop.execute(options.initialTask, { threadDir, dataDir: config.dataDir })) {
      if (event.type === 'text') process.stdout.write(event.content);
    }
    process.stdout.write('\n');
  }

  prompt();
}
