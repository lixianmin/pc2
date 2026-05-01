import { b } from '../../baml_client/index.js';
import type { ChatResponse } from '../../baml_client/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { StepOutcome, MemoryHit } from '../types.js';
import { turnEndCallback } from './turn-end-callback.js';
import type { CallbackContext } from './turn-end-callback.js';
import { appendMessage } from '../storage/jsonl.js';
import { formatSkillList } from './prompt.js';
import { checkAndFreeze, checkAndSummarize } from '../storage/summary.js';
import { assembleContext } from '../storage/context.js';
import { countMessagesTokens } from '../storage/tokens.js';
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
  threadDir: string;
  skills?: SkillDefinition[];
  sops?: SkillDefinition[];
  allowedTools?: string[];
  lmdClient?: LmdMcpClient;
}

const isParseError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('BamlValidationError');
};

export class AgentLoop {
  constructor(private registry: ToolRegistry) {}

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
        if (attempt < 2) {
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
    threadDir: string,
  ): AsyncGenerator<AgentEvent, boolean> {
    if (response.text) {
      yield { type: 'text', content: response.text };
    } else {
      logo.warn('LLM returned empty text', { turn, has_tool_calls: !!response.tool_calls?.length });
    }
    const toolCalls = response.tool_calls?.map(tc => {
      let parsedArgs: Record<string, unknown> = {};
      try { parsedArgs = JSON.parse(tc.arguments); } catch {}
      return { name: tc.name, arguments: parsedArgs, id: tc.id };
    });
    await appendMessage(threadDir, 'assistant', response.text ?? '', { toolCalls });
    return !!(response.tool_calls && response.tool_calls.length > 0);
  }

  private async *executeToolCall(
    turn: number,
    tc: { name: string; arguments: string; id: string },
    threadDir: string,
    options: LoopOptions,
    isSubAgent: boolean,
    state: { consecutiveFailures: number; lastFailedTool: string | null },
  ): AsyncGenerator<AgentEvent, { shouldExit: boolean; resultStr: string }> {
    yield { type: 'tool_call', name: tc.name, args: tc.arguments, call_id: tc.id };

    let args: Record<string, unknown>;
    try { args = JSON.parse(tc.arguments); } catch { args = {}; }

    const toolCtx = {
      turn, index: 0,
      lmdClient: options.lmdClient ?? null,
      dataDir: options.dataDir ?? config.dataDir,
      agentId: options.agentId ?? 'main',
      isSubAgent,
      workspaceRoot: config.workspaceRoot,
      allowedTools: options.allowedTools,
    };

    const toolStart = Date.now();
    logo.info('Tool call start', { turn, name: tc.name, args_len: tc.arguments.length });
    const result = await this.registry.dispatch(tc.name, args, toolCtx);
    const resultStr = typeof result === 'string' ? result : JSON.stringify((result as StepOutcome).data);
    logo.info('Tool call done', { turn, name: tc.name, latency_ms: Date.now() - toolStart, result_len: resultStr.length });

    yield { type: 'tool_result', name: tc.name, call_id: tc.id, result: resultStr };

    const isFailure = typeof result !== 'string' && (result as StepOutcome).isError === true;

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

    await appendMessage(threadDir, 'tool', resultStr, { toolCallId: tc.id });

    if (typeof result !== 'string' && (result as StepOutcome).shouldExit) {
      yield { type: 'done', reason: 'ask_user' };
      return { shouldExit: true, resultStr };
    }
    return { shouldExit: false, resultStr };
  }

  private async *postTurn(
    turn: number,
    response: ChatResponse,
    threadDir: string,
    consecutiveFailures: number,
    lastFailedTool: string | null,
  ): AsyncGenerator<AgentEvent, void> {
    const callbackCtx: CallbackContext = {
      planFile: null,
      lastResponse: response.text ?? '',
      dataDir: config.dataDir,
      hasVerificationEvidence: response.tool_calls?.some(tc => tc.name === 'spawn_agent') ?? false,
      consecutiveFailures,
      lastFailedTool,
    };
    const warning = turnEndCallback(turn, callbackCtx);
    if (warning) {
      yield { type: 'warning', content: warning };
    }

    await checkAndFreeze(threadDir, countMessagesTokens);
    await checkAndSummarize(threadDir, async (text) => {
      try {
        logo.info('SummarizeHistory request', { text_len: text.length });
        const summary = (await b.SummarizeHistory(text)).toString();
        logo.info('SummarizeHistory response', { summary });
        return summary;
      } catch { return ''; }
    });
  }

  async *execute(
    userMessage: string,
    options: LoopOptions,
  ): AsyncGenerator<AgentEvent> {
    const maxRounds = options.maxRounds ?? config.maxRounds;
    const isSubAgent = options.isSubAgent ?? false;
    const threadDir = options.threadDir;
    const toolsDesc = this.registry.getToolsDescription();
    const skillsList = formatSkillList(options.skills ?? []);
    const sopsList = formatSkillList(options.sops ?? []);
    const startTime = Date.now();
    const timeoutMs = isSubAgent ? config.subAgentTimeoutMs : config.agentTimeoutMs;
    logo.info('Agent loop started', { agentId: options.agentId ?? 'main', isSubAgent, maxRounds });

    await appendMessage(threadDir, 'user', userMessage);

    let inMemory = '';
    let lastAssistantText = '';
    const state = { consecutiveFailures: 0, lastFailedTool: null as string | null };

    for (let turn = 1; turn <= maxRounds; turn++) {
      if (Date.now() - startTime > timeoutMs) {
        logo.info('Agent loop done', { reason: 'timeout', turns: turn - 1, elapsed_ms: Date.now() - startTime });
        yield { type: 'done', reason: 'timeout' };
        return;
      }

      const diskContext = await assembleContext(threadDir, inMemory);
      const messages = diskContext + inMemory;

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
      if (!response) return;

      if (response.text) {
        lastAssistantText = response.text;
        inMemory += `[Assistant]\n${response.text}\n\n`;
      }

      const hasTools = yield* this.handleResponse(turn, response, threadDir);
      if (!hasTools) {
        logo.info('Agent loop done', { reason: 'completed', turns: turn, elapsed_ms: Date.now() - startTime });
        yield { type: 'done', reason: 'completed' };
        return;
      }

      for (const tc of response.tool_calls!) {
        inMemory += `[Tool Call: ${tc.name}](${tc.arguments})\n\n`;
        const { shouldExit, resultStr } = yield* this.executeToolCall(turn, tc, threadDir, options, isSubAgent, state);
        inMemory += `[Tool Result: ${tc.name}]\n${resultStr}\n\n`;
        if (shouldExit) {
          logo.info('Agent loop done', { reason: 'ask_user', turns: turn, elapsed_ms: Date.now() - startTime });
          return;
        }
      }

      yield* this.postTurn(turn, response, threadDir, state.consecutiveFailures, state.lastFailedTool);
      inMemory = '';
    }

    logo.warn('Agent loop done', { reason: 'max_rounds', turns: maxRounds, elapsed_ms: Date.now() - startTime });
    yield { type: 'done', reason: 'max_rounds' };
  }
}
