import { b } from '../../baml_client/index.js';
import type { ChatResponse } from '../../baml_client/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { StepOutcome, Message, MemoryHit } from '../types.js';
import { turnEndCallback } from './turn-end-callback.js';
import type { CallbackContext } from './turn-end-callback.js';
import { appendJsonl } from '../storage/jsonl.js';
import { buildSystemPrompt, buildDynamicTail } from './prompt.js';
import { checkAndFreeze, checkAndSummarize } from '../storage/summary.js';
import { countMessagesTokens, countTokens } from '../storage/tokens.js';
import type { LmdMcpClient } from '../memory/lmd-client.js';
import type { SkillDefinition } from '../skill-sop/types.js';
import { join } from 'path';
import { config } from '../config.js';
import { logo } from '../lib/logo.js';

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string; call_id: string }
  | { type: 'tool_result'; name: string; call_id: string; result: string }
  | { type: 'warning'; content: string }
  | { type: 'done'; reason: string };

export interface LoopOptions {
  maxRounds?: number;
  isSubAgent?: boolean;
  dataDir?: string;
  agentId?: string;
  threadDir?: string;
  skills?: SkillDefinition[];
  sops?: SkillDefinition[];
  lmdClient?: LmdMcpClient;
}

export class AgentLoop {
  constructor(private registry: ToolRegistry) {}

  async *execute(
    userMessage: string,
    options: LoopOptions = {},
  ): AsyncGenerator<AgentEvent> {
    const maxRounds = options.maxRounds ?? 30;
    const isSubAgent = options.isSubAgent ?? false;
    const toolsDesc = this.registry.getToolsDescription();
    const startTime = Date.now();
    const timeoutMs = isSubAgent ? 10 * 60 * 1000 : 20 * 60 * 1000;
    logo.info('Agent loop started', { agentId: options.agentId ?? 'main', isSubAgent, maxRounds });

    const systemMsg = buildSystemPrompt(toolsDesc, options.skills ?? [], options.sops ?? []);
    let messages = '';
    let lastAssistantText = '';

    for (let turn = 1; turn <= maxRounds; turn++) {
      if (Date.now() - startTime > timeoutMs) {
        logo.info('Agent loop done', { reason: 'timeout', turns: turn - 1, elapsed_ms: Date.now() - startTime });
        yield { type: 'done', reason: 'timeout' };
        return;
      }

      let memoryHits: MemoryHit[] = [];
      if (options.lmdClient && userMessage) {
        const query = turn === 1 ? userMessage : `${lastAssistantText} ${userMessage}`;
        memoryHits = await options.lmdClient.queryMemory({ query });
      }

      const dynamicTail = buildDynamicTail(userMessage, turn, memoryHits);
      const fullMessages = `${systemMsg}\n\n${messages}\n\n${dynamicTail}`;

      let response: ChatResponse;
      try {
        response = await b.AgentChat(fullMessages, toolsDesc);
        logo.info('LLM response', { turn, text_len: response.text?.length ?? 0, tool_calls: response.tool_calls?.length ?? 0 });
      } catch {
        logo.warn('LLM call failed, retrying', { turn });
        yield { type: 'warning', content: 'LLM call failed, retrying...' };
        try {
          response = await b.AgentChat(fullMessages, toolsDesc);
        } catch {
          logo.error('Agent loop done', { reason: 'llm_error', turns: turn, elapsed_ms: Date.now() - startTime });
          yield { type: 'done', reason: 'llm_error' };
          return;
        }
      }

      if (response.text) {
        lastAssistantText = response.text;
        yield { type: 'text', content: response.text };
        messages += `[Assistant]\n${response.text}\n\n`;

        if (options.threadDir) {
          const toolCalls = response.tool_calls?.map(tc => {
            let parsedArgs: Record<string, unknown> = {};
            try { parsedArgs = JSON.parse(tc.arguments); } catch {}
            return { name: tc.name, arguments: parsedArgs, id: tc.id };
          });
          await appendJsonl(
            join(options.threadDir, 'messages-current.jsonl'),
            { id: `msg_${turn}_a`, role: 'assistant', content: response.text,
              toolCalls, timestamp: new Date().toISOString() } satisfies Message,
          );
        }
      }

      if (!response.tool_calls || response.tool_calls.length === 0) {
        logo.info('Agent loop done', { reason: 'completed', turns: turn, elapsed_ms: Date.now() - startTime });
        yield { type: 'done', reason: 'completed' };
        return;
      }

      for (const tc of response.tool_calls) {
        yield { type: 'tool_call', name: tc.name, args: tc.arguments, call_id: tc.id };
        messages += `[Tool Call: ${tc.name}](${tc.arguments})\n\n`;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }

        const toolCtx = {
          turn,
          index: 0,
          lmdClient: options.lmdClient ?? null as any,
          dataDir: options.dataDir ?? 'data',
          agentId: options.agentId ?? 'main',
          isSubAgent,
          workspaceRoot: config.workspaceRoot,
        };

        const toolStart = Date.now();
        logo.info('Tool call start', { turn, name: tc.name, args_len: tc.arguments.length });
        const result = await this.registry.dispatch(tc.name, args, toolCtx);
        const resultStr = typeof result === 'string' ? result : JSON.stringify((result as StepOutcome).data);
        logo.info('Tool call done', { turn, name: tc.name, latency_ms: Date.now() - toolStart, result_len: resultStr.length });
        yield { type: 'tool_result', name: tc.name, call_id: tc.id, result: resultStr };
        messages += `[Tool Result: ${tc.name}]\n${resultStr}\n\n`;

        if (options.threadDir) {
          await appendJsonl(
            join(options.threadDir, 'messages-current.jsonl'),
            { id: `msg_${turn}_t_${tc.id}`, role: 'tool', content: resultStr,
              toolCallId: tc.id, timestamp: new Date().toISOString() } satisfies Message,
          );
        }

        if (typeof result !== 'string' && (result as StepOutcome).shouldExit) {
          logo.info('Agent loop done', { reason: 'ask_user', turns: turn, elapsed_ms: Date.now() - startTime });
          yield { type: 'done', reason: 'ask_user' };
          return;
        }
      }

      const callbackCtx: CallbackContext = {
        planFile: null,
        lastResponse: response.text ?? '',
        dataDir: options.dataDir ?? 'data',
        hasVerificationEvidence: response.tool_calls?.some(tc => tc.name === 'spawn_agent') ?? false,
      };
      const warning = turnEndCallback(turn, callbackCtx);
      if (warning) {
        yield { type: 'warning', content: warning };
        messages += `[System]\n${warning}\n\n`;
      }

      if (options.threadDir) {
        await checkAndFreeze(options.threadDir, countMessagesTokens);
        await checkAndSummarize(options.threadDir, async (text) => {
          try { return (await b.SummarizeHistory(text)).toString(); }
          catch { return null as any; }
        });
      }

      const msgTokens = await countTokens(messages);
      const budget = Math.floor(config.modelContextWindow * 0.6);
      if (msgTokens > budget) {
        const lines = messages.split('\n');
        const keepCount = Math.max(20, Math.floor(lines.length * 0.3));
        messages = '[...earlier context truncated...]\n\n' + lines.slice(-keepCount).join('\n');
        logo.warn('Context truncated', { removed: lines.length - keepCount, kept: keepCount, tokens: msgTokens });
        yield { type: 'warning', content: `Context truncated: removed ${lines.length - keepCount} lines to stay within token budget` };
      }
    }

    logo.warn('Agent loop done', { reason: 'max_rounds', turns: maxRounds, elapsed_ms: Date.now() - startTime });
    yield { type: 'done', reason: 'max_rounds' };
  }
}
