import { mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { logo, formatTimestamp } from '../lib/logo.js';
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
import { writeMeta, updateMeta, listThreads, loadThreadHistory, readMeta } from '../storage/thread.js';
import { LmdMcpClient } from '../memory/lmd-client.js';
import { scanSkillDirectory } from '../skill-sop/loader.js';
import { readMultiline } from './input.js';
import select from '@inquirer/select';

export function makeThreadDir(): string {
  const threadsDir = join(config.dataDir, 'threads');
  mkdirSync(threadsDir, { recursive: true });
  let maxNum = 0;
  try {
    const entries = readdirSync(threadsDir);
    for (const entry of entries) {
      const n = parseInt(entry, 10);
      if (!isNaN(n) && String(n) === entry && n > maxNum) maxNum = n;
    }
  } catch {}
  const nextNum = maxNum + 1;
  const name = String(nextNum);
  const dir = join(threadsDir, name);
  mkdirSync(join(dir, 'summaries'), { recursive: true });
  return dir;
}

export async function startChat(options: { initialTask?: string }): Promise<void> {
  logo.init({ console: false });
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

  const lmdClient = new LmdMcpClient({ host: config.lmdHost, port: config.lmdPort });
  const sops = await scanSkillDirectory('sop');
  const skills = await scanSkillDirectory('skills');
  logo.info('Chat initialized', { sops: sops.length, skills: skills.length });

  let activeThreadDir: string | null = null;

  const ensureThread = (preview: string): string => {
    if (activeThreadDir) return activeThreadDir;
    const dir = makeThreadDir();
    writeMeta(dir, {
      id: dir.split('/').pop()!,
      createdAt: formatTimestamp(),
      lastActivityAt: formatTimestamp(),
      messageCount: 0,
      preview: preview.length > 80 ? preview.slice(0, 80) : preview, // 80 chars: fits one terminal line
    });
    activeThreadDir = dir;
    logo.info('New thread created', { dir });
    return dir;
  };

  const loop = new AgentLoop(registry);

  const handleSessions = async () => {
    const threads = await listThreads(config.dataDir);
    if (threads.length === 0) {
      console.log('No previous sessions found.');
      return;
    }
    const choices = threads.map((t, i) => {
      const shortDate = t.lastActivityAt.slice(5, 16).replace('T', ' ');
        const preview = t.preview
          ? (t.preview.length > 50 ? t.preview.slice(0, 50) + '...' : t.preview) // 50 chars: compact display for session list
        : '(empty)';
      return {
        name: `#${i + 1}  ${shortDate}  ${preview}`,
        value: String(i),
      };
    });
    choices.push({ name: '(cancel)', value: 'cancel' });
    const answer = await select({
      message: 'Select a session to resume:',
      choices,
    });
    if (answer !== 'cancel') {
      const idx = parseInt(answer, 10);
      const thread = threads[idx];
      const resumedDir = join(config.dataDir, 'threads', thread.id);
      const history = await loadThreadHistory(resumedDir);
      loop.resumeHistory(history);
      activeThreadDir = resumedDir;
      console.log(`Resumed session: ${thread.preview}\n`);
    }
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

  const prompt = async () => {
    while (true) {
      const input = await readMultiline('\n> ');
      if (input === null) {
        logo.close();
        process.exit(0);
      }
      if (!input.trim()) continue;
      if (input === 'exit' || input === 'quit') { logo.close(); process.exit(0); }
      if (input === '/sessions') { await handleSessions(); continue; }
      if (input.startsWith('/resume')) { await handleResume(input); continue; }

      const threadDir = ensureThread(input);

      let textYielded = false;
      for await (const event of loop.execute(input, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills })) {
        if (event.type === 'text') {
          textYielded = true;
          process.stdout.write(event.content);
        } else if (event.type === 'tool_result') {
          process.stdout.write(`\n[tool: ${event.name}] ${String(event.result).slice(0, 200)}\n`); // 200 chars: enough to see result summary
        } else if (event.type === 'warning') {
          process.stdout.write(`\n[warning] ${event.content}\n`);
        } else if (event.type === 'done') {
          if (!textYielded) {
            logo.warn('Chat loop completed without text output', { reason: event.reason });
          }
          process.stdout.write('\n');
        }
      }

      const meta = await readMeta(threadDir);
      await updateMeta(threadDir, {
        lastActivityAt: formatTimestamp(),
        messageCount: (meta?.messageCount ?? 0) + 1,
      });
    }
  };

  if (options.initialTask) {
    const threadDir = ensureThread(options.initialTask);
    for await (const event of loop.execute(options.initialTask, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills })) {
      if (event.type === 'text') process.stdout.write(event.content);
    }
    process.stdout.write('\n');
  }

  await prompt();
}
