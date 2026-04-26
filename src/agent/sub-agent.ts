import { AgentLoop } from './loop.js';
import type { ToolRegistry } from '../tools/registry.js';
import { config } from '../config.js';

export async function runSubAgent(
  registry: ToolRegistry,
  task: string,
  context?: string,
): Promise<string> {
  const loop = new AgentLoop(registry);
  const prompt = context ? `${task}\n\nContext: ${context}` : task;
  const results: string[] = [];

  for await (const event of loop.execute(prompt, {
    maxRounds: config.subAgentMaxRounds,
    isSubAgent: true,
  })) {
    if (event.type === 'text') {
      results.push(event.content);
    }
  }

  return results.join('\n');
}
