import { b } from '../../baml_client/index.js';
import type { ChatResponse } from '../../baml_client/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { StepOutcome, MemoryHit } from '../types.js';
import { turnEndCallback } from './turn-end-callback.js';
import type { CallbackContext } from './turn-end-callback.js';
import { appendMessage } from '../storage/jsonl.js';
import { formatSkillList } from './prompt.js';
import { checkAndFreeze, checkAndSummarize } from '../storage/summary.js';
import { countMessagesTokens, countTokens } from '../storage/tokens.js';
import type { LmdMcpClient } from '../memory/lmd-client.js';
import type { SkillDefinition } from '../skill-sop/types.js';
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

const isParseError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('BamlValidationError');
};

export class AgentLoop {
  private conversationHistory = '';
  constructor(private registry: ToolRegistry) {}

  resumeHistory(history: string): void {
    this.conversationHistory = history;
  }

  private async *callLlm(
    turn: number,
    messages: string,
    toolsDesc: string,
    skillsList: string,
    sopsList: string,
    contextBlock: string,
    relevantMemory: string,
  ): AsyncGenerator<AgentEvent, ChatResponse | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        logo.info('LLM request', { turn, attempt, messages });
        const resp = await b.AgentChat(toolsDesc, messages, skillsList, sopsList, contextBlock, relevantMemory);
        logo.info('LLM response', { turn, text: resp.text ?? '', tool_calls: resp.tool_calls ?? [] });
        return resp;
      } catch (err) {
        if (isParseError(err)) {
          logo.warn('BamlValidationError, silent retry', { turn, attempt });
          continue;
        }
        if (attempt < 1) {
          yield { type: 'warning', content: 'LLM call failed, retrying...' };
          logo.warn('LLM call failed, retrying', { turn });
          continue;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        logo.error('LLM call failed after retries', { turn, errMsg });
        yield { type: 'warning', content: `LLM call failed: ${errMsg}. Please try again.` };
        yield { type: 'done', reason: 'llm_error' };
        return null;
      }
    }
    yield { type: 'done', reason: 'llm_error' };
    return null;
  }

  private async *handleResponse(
    turn: number,
    response: ChatResponse,
    threadDir?: string,
  ): AsyncGenerator<AgentEvent, boolean> {
    if (response.text) {
      yield { type: 'text', content: response.text };
      if (threadDir) {
        const toolCalls = response.tool_calls?.map(tc => {
          let parsedArgs: Record<string, unknown> = {};
          try { parsedArgs = JSON.parse(tc.arguments); } catch {}
          return { name: tc.name, arguments: parsedArgs, id: tc.id };
        });
        await appendMessage(threadDir, 'assistant', response.text, { toolCalls });
      }
    } else {
      logo.warn('LLM returned empty text', { turn, has_tool_calls: !!response.tool_calls?.length });
    }
    return !!(response.tool_calls && response.tool_calls.length > 0);
  }

  private async *executeToolCall(
    turn: number,
    tc: { name: string; arguments: string; id: string },
    threadDir: string | undefined,
    options: LoopOptions,
    isSubAgent: boolean,
    state: { consecutiveFailures: number; lastFailedTool: string | null },
  ): AsyncGenerator<AgentEvent, { shouldExit: boolean; resultStr: string }> {
    yield { type: 'tool_call', name: tc.name, args: tc.arguments, call_id: tc.id };

    let args: Record<string, unknown>;
    try { args = JSON.parse(tc.arguments); } catch { args = {}; }

    const toolCtx = {
      turn, index: 0,
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

    const isFailure = resultStr.includes('Fetch error') ||
      resultStr.includes('not found') ||
      resultStr.includes('Blocked command') ||
      resultStr.includes('not configured') ||
      resultStr.includes('not allowed') ||
      resultStr.startsWith('Search error');

    if (isFailure) {
      if (tc.name === state.lastFailedTool) {
        state.consecutiveFailures++;
      } else {
        state.consecutiveFailures = 1;
        state.lastFailedTool = tc.name;
      }
    } else {
      state.consecutiveFailures = 0;
      state.lastFailedTool = null;
    }

    if (threadDir) {
      await appendMessage(threadDir, 'tool', resultStr, { toolCallId: tc.id });
    }

    if (typeof result !== 'string' && (result as StepOutcome).shouldExit) {
      yield { type: 'done', reason: 'ask_user' };
      return { shouldExit: true, resultStr };
    }
    return { shouldExit: false, resultStr };
  }

  private async *postTurn(
    turn: number,
    response: ChatResponse,
    threadDir: string | undefined,
    consecutiveFailures: number,
    lastFailedTool: string | null,
    messages: string,
  ): AsyncGenerator<AgentEvent, string> {
    const callbackCtx: CallbackContext = {
      planFile: null,
      lastResponse: response.text ?? '',
      dataDir: threadDir ? 'data' : 'data',
      hasVerificationEvidence: response.tool_calls?.some(tc => tc.name === 'spawn_agent') ?? false,
      consecutiveFailures,
      lastFailedTool,
    };
    const warning = turnEndCallback(turn, callbackCtx);
    if (warning) {
      yield { type: 'warning', content: warning };
      messages += `[System]\n${warning}\n\n`;
    }

    if (consecutiveFailures >= 3) {
      const antiLoopMsg = `[Anti-Loop] ${lastFailedTool} failed ${consecutiveFailures} times in a row. Use ask_user to ask for guidance or change strategy entirely.`;
      yield { type: 'warning', content: antiLoopMsg };
      messages += `[System] ${lastFailedTool} has failed ${consecutiveFailures} times. You must change approach NOW. Use a different tool or ask_user.\n\n`;
    }

    if (threadDir) {
      await checkAndFreeze(threadDir, countMessagesTokens);
      await checkAndSummarize(threadDir, async (text) => {
        try {
          logo.info('SummarizeHistory request', { text_len: text.length });
          const summary = (await b.SummarizeHistory(text)).toString();
          logo.info('SummarizeHistory response', { summary });
          return summary;
        } catch { return null as any; }
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

    return messages;
  }

  async *execute(
    userMessage: string,
    options: LoopOptions = {},
  ): AsyncGenerator<AgentEvent> {
    const maxRounds = options.maxRounds ?? 30;
    const isSubAgent = options.isSubAgent ?? false;
    const toolsDesc = this.registry.getToolsDescription();
    const skillsList = formatSkillList(options.skills ?? []);
    const sopsList = formatSkillList(options.sops ?? []);
    const startTime = Date.now();
    // 10 min for sub-agents, 20 min for main agent
    const timeoutMs = isSubAgent ? 10 * 60 * 1000 : 20 * 60 * 1000;
    logo.info('Agent loop started', { agentId: options.agentId ?? 'main', isSubAgent, maxRounds });

    let messages = this.conversationHistory + `[User]\n${userMessage}\n\n`;
    if (options.threadDir) {
      await appendMessage(options.threadDir, 'user', userMessage);
    }

    let lastAssistantText = '';
    const state = { consecutiveFailures: 0, lastFailedTool: null as string | null };

    for (let turn = 1; turn <= maxRounds; turn++) {
      if (Date.now() - startTime > timeoutMs) {
        logo.info('Agent loop done', { reason: 'timeout', turns: turn - 1, elapsed_ms: Date.now() - startTime });
        this.conversationHistory = messages;
        yield { type: 'done', reason: 'timeout' };
        return;
      }

      let memoryHits: MemoryHit[] = [];
      if (options.lmdClient && userMessage) {
        const query = turn === 1 ? userMessage : `${lastAssistantText} ${userMessage}`;
        memoryHits = await options.lmdClient.queryMemory({ query });
      }

      const now = new Date();
      const timeStr = now.toLocaleString('sv-SE', { timeZone: config.timezone, hour12: false });
      const contextBlock = `[Context]\nTime: ${timeStr}\nTurn: ${turn}\n\n[User Message]\n${userMessage}`;
      let relevantMemory = '';
      if (memoryHits.length > 0) {
        relevantMemory = memoryHits.map((m) => `- (${m.type}, score: ${m.score.toFixed(2)}) ${m.content}`).join('\n');
      }

      const response = yield* this.callLlm(turn, messages, toolsDesc, skillsList, sopsList, contextBlock, relevantMemory);
      if (!response) {
        this.conversationHistory = messages;
        return;
      }

      if (response.text) {
        lastAssistantText = response.text;
        messages += `[Assistant]\n${response.text}\n\n`;
      }

      const hasTools = yield* this.handleResponse(turn, response, options.threadDir);
      if (!hasTools) {
        logo.info('Agent loop done', { reason: 'completed', turns: turn, elapsed_ms: Date.now() - startTime });
        this.conversationHistory = messages;
        yield { type: 'done', reason: 'completed' };
        return;
      }

      for (const tc of response.tool_calls!) {
        messages += `[Tool Call: ${tc.name}](${tc.arguments})\n\n`;
        const { shouldExit, resultStr } = yield* this.executeToolCall(turn, tc, options.threadDir, options, isSubAgent, state);
        messages += `[Tool Result: ${tc.name}]\n${resultStr}\n\n`;
        if (shouldExit) {
          logo.info('Agent loop done', { reason: 'ask_user', turns: turn, elapsed_ms: Date.now() - startTime });
          this.conversationHistory = messages;
          return;
        }
      }

      messages = yield* this.postTurn(turn, response, options.threadDir, state.consecutiveFailures, state.lastFailedTool, messages);
    }

    logo.warn('Agent loop done', { reason: 'max_rounds', turns: maxRounds, elapsed_ms: Date.now() - startTime });
    this.conversationHistory = messages;
    yield { type: 'done', reason: 'max_rounds' };
  }
}
