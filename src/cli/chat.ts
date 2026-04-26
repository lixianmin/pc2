import * as readline from 'readline';
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

export async function startChat(options: { initialTask?: string }): Promise<void> {
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

  const loop = new AgentLoop(registry);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => rl.question('\n> ', async (input) => {
    if (!input.trim()) { prompt(); return; }
    if (input === 'exit' || input === 'quit') { rl.close(); return; }

    for await (const event of loop.execute(input)) {
      if (event.type === 'text') {
        process.stdout.write(event.content);
      } else if (event.type === 'tool_result') {
        process.stdout.write(`\n[tool: ${event.name}] ${String(event.result).slice(0, 200)}\n`);
      } else if (event.type === 'warning') {
        process.stdout.write(`\n[warning] ${event.content}\n`);
      } else if (event.type === 'done') {
        process.stdout.write('\n');
      }
    }
    prompt();
  });

  if (options.initialTask) {
    for await (const event of loop.execute(options.initialTask)) {
      if (event.type === 'text') process.stdout.write(event.content);
    }
    process.stdout.write('\n');
  }

  prompt();
}
