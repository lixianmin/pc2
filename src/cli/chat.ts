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
import { writeMeta, updateMeta, listThreads, loadThreadHistory } from '../storage/thread.js';

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

  const preview = options.initialTask ?? '';
  await writeMeta(threadDir, {
    id: threadDir.split('/').pop()!,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    messageCount: 0,
    preview: preview.length > 80 ? preview.slice(0, 80) : preview,
  });

  const loop = new AgentLoop(registry);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => { logo.close(); });

  let activeThreadDir = threadDir;

  const handleSessions = async () => {
    const threads = await listThreads(config.dataDir);
    if (threads.length === 0) {
      console.log('No previous sessions found.');
      return;
    }
    console.log('\nRecent sessions:');
    threads.forEach((t, i) => {
      const shortDate = t.lastActivityAt.slice(5, 16).replace('T', ' ');
      const preview = t.preview.length > 50 ? t.preview.slice(0, 50) + '...' : t.preview;
      console.log(`  #${i + 1}  ${shortDate}  (${t.messageCount} msg)  ${preview}`);
    });
    console.log('');
  };

  const handleResume = async (input: string) => {
    const match = input.match(/^\/resume\s+(\d+)$/);
    if (!match) {
      console.log('Usage: /resume <number> (use /sessions to list)');
      return;
    }
    const idx = parseInt(match[1], 10) - 1;
    const threads = await listThreads(config.dataDir);
    if (idx < 0 || idx >= threads.length) {
      console.log(`Invalid session #${match[1]}. Use /sessions to list.`);
      return;
    }
    const thread = threads[idx];
    const resumedDir = join(config.dataDir, 'threads', thread.id);
    const history = await loadThreadHistory(resumedDir);
    loop.resumeHistory(history);
    activeThreadDir = resumedDir;
    console.log(`Resumed session: ${thread.preview}\n`);
  };

  const prompt = () => rl.question('\n> ', async (input) => {
    if (!input.trim()) { prompt(); return; }
    if (input === 'exit' || input === 'quit') { rl.close(); return; }
    if (input === '/sessions') { await handleSessions(); prompt(); return; }
    if (input.startsWith('/resume')) { await handleResume(input); prompt(); return; }

    let textYielded = false;
    for await (const event of loop.execute(input, { threadDir: activeThreadDir, dataDir: config.dataDir })) {
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

    await updateMeta(activeThreadDir, {
      lastActivityAt: new Date().toISOString(),
    });

    prompt();
  });

  if (options.initialTask) {
    for await (const event of loop.execute(options.initialTask, { threadDir: activeThreadDir, dataDir: config.dataDir })) {
      if (event.type === 'text') process.stdout.write(event.content);
    }
    process.stdout.write('\n');
  }

  prompt();
}
