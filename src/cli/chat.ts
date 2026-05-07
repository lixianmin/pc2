import { mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { logo, formatTimestamp } from '../lib/logo.js';
import { AgentLoop, type AgentEvent } from '../agent/loop.js';
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
import { writeMeta, updateMeta, listThreads, readMeta } from '../storage/thread.js';
import { LmdMcpClient } from '../memory/lmd-client.js';
import { scanSkillDirectory } from '../skill-sop/loader.js';
import { readMultiline, DEFAULT_SLASH_COMMANDS } from './input.js';
import { ModeManager, MODE_LABELS } from '../tools/mode.js';
import select from '@inquirer/select';

const G = '\x1b[90m'; // dim gray
const C = '\x1b[96m'; // cyan
const Y = '\x1b[93m'; // yellow
const R = '\x1b[91m'; // red
const Gn = '\x1b[92m'; // green
const N = '\x1b[0m';  // reset

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerState {
  msg: string;
  active: boolean;
}

function createSpinner(initialMsg: string) {
  const state: SpinnerState = { msg: initialMsg, active: true };
  let idx = 0;
  const interval = setInterval(() => {
    if (!state.active) return;
    process.stderr.write(`\r\x1b[K${SPINNER[idx]} ${state.msg}`);
    idx = (idx + 1) % SPINNER.length;
  }, 80);
  return {
    update: (msg: string) => { state.msg = msg; },
    stop: (finalMsg?: string) => {
      state.active = false;
      clearInterval(interval);
      if (finalMsg) process.stderr.write(`\r\x1b[K${finalMsg}\n`);
      else process.stderr.write('\r\x1b[K');
    },
  };
}

function formatDuration(ms: number): string {
  const s = (ms / 1000).toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) + 's' : s + 's';
}

let turnNum = 0;
let agentStartMs = 0;

function renderEvent(event: AgentEvent, spinner: ReturnType<typeof createSpinner>) {
  switch (event.type) {
    case 'text':
      turnNum++;
      spinner.update(`${G}Turn ${turnNum}${N}`);
      process.stdout.write(event.content);
      break;

    case 'tool_call':
      spinner.update(`${C}⏳ ${event.name}...${N}`);
      break;

    case 'tool_result': {
      const r = String(event.result);
      const isErr = r.length < 200 && (r.includes('Error') || r.includes('error') || r.includes('denied') || r.includes('not found') || r.includes('failed'));
      const symbol = isErr ? `${R}✗${N}` : `${Gn}✓${N}`;
      process.stderr.write(`\r\x1b[K${G}  ${symbol} ${event.name}${N}\n`);
      if (isErr) {
        process.stdout.write(`\n${R}[tool: ${event.name}]${N} `);
      }
      process.stdout.write(r.slice(0, 200));
      if (r.length > 200) process.stdout.write(`${G}...${N}`);
      process.stdout.write('\n');
      break;
    }

    case 'warning':
      process.stdout.write(`\n${Y}[!] ${event.content}${N}\n`);
      break;

    case 'done': {
      const elapsed = formatDuration(Date.now() - agentStartMs);
      spinner.stop(`${G}[${event.reason}] ${elapsed}, ${turnNum} turns${N}`);
      break;
    }
  }
}

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
  let attempt = maxNum + 1;
  while (true) {
    const dir = join(threadsDir, String(attempt));
    try {
      mkdirSync(join(dir, 'summaries'), { recursive: true });
      return dir;
    } catch (e: any) {
      if (e.code === 'EEXIST') { attempt++; continue; }
      throw e;
    }
  }
}

export async function startChat(options: { initialTask?: string }): Promise<void> {
  logo.init({ console: false });
  const modeManager = new ModeManager(config.mode);
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
    activeThreadDir = resumedDir;
    console.log(`Resumed session: ${thread.preview}\n`);
  };

  const shutdown = (): never => {
    logo.close();
    process.exit(0);
  };

  const prompt = async () => {
    while (true) {
      const skillCommands = skills.map(s => '/' + s.name);
      const input = await readMultiline('\n> ', { slashCommands: [...DEFAULT_SLASH_COMMANDS, ...skillCommands], mode: MODE_LABELS[modeManager.get()] });
      if (input === null) {
        shutdown();
        return;
      }
      if (input === '__OP_MODE_SWITCH__') {
        modeManager.next();
        continue;
      }
      if (!input.trim()) continue;
      if (input === 'exit' || input === 'quit') { shutdown(); }
      if (input === '/sessions') { await handleSessions(); continue; }
      if (input.startsWith('/resume')) { await handleResume(input); continue; }
      if (input === '/mode') { console.log(`Current mode: ${MODE_LABELS[modeManager.get()]}`); continue; }
      if (input === '/mode default') { modeManager.set('default'); continue; }
      if (input === '/mode yolo') { modeManager.set('yolo'); continue; }
      if (input === '/mode plan') { modeManager.set('plan'); continue; }
      if (input.startsWith('/mode ')) { console.log('Usage: /mode [default|yolo|plan]'); continue; }

      const matchedSkill = skills.find(s => input.startsWith('/' + s.name + ' ') || input === '/' + s.name);
      if (matchedSkill) {
        const args = input.slice(('/' + matchedSkill.name).length).trim();
        const skillBody = matchedSkill.body ?? '';
        const agentInput = `${skillBody}\n\n---\n\n用户要求: ${args || '请帮我处理文件'}`;
        const threadDir = ensureThread(agentInput);
        turnNum = 0;
        agentStartMs = Date.now();
        const spinner = createSpinner(modeManager.get() === 'default' ? `${G}Thinking...${N}` : `${G}[${MODE_LABELS[modeManager.get()]}] Thinking...${N}`);
        for await (const event of loop.execute(agentInput, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills, allowedTools: matchedSkill.allowedTools })) {
          renderEvent(event, spinner);
        }
        const meta = await readMeta(threadDir);
        await updateMeta(threadDir, {
          lastActivityAt: formatTimestamp(),
          messageCount: (meta?.messageCount ?? 0) + 1,
        });
        continue;
      }

      const threadDir = ensureThread(input);

      turnNum = 0;
      agentStartMs = Date.now();
      const spinner = createSpinner(modeManager.get() === 'default' ? `${G}Thinking...${N}` : `${G}[${MODE_LABELS[modeManager.get()]}] Thinking...${N}`);
      for await (const event of loop.execute(input, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills })) {
        renderEvent(event, spinner);
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
    turnNum = 0;
    agentStartMs = Date.now();
    const spinner = createSpinner(modeManager.get() === 'default' ? `${G}Thinking...${N}` : `${G}[${MODE_LABELS[modeManager.get()]}] Thinking...${N}`);
    for await (const event of loop.execute(options.initialTask, { threadDir, dataDir: config.dataDir, lmdClient, sops, skills })) {
      renderEvent(event, spinner);
    }
  }

  await prompt();
}
