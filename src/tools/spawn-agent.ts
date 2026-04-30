import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createSpawnAgentTool(): Tool {
  return {
    name: 'spawn_agent',
    description: 'Launch sub-agent for isolated execution. Sub-agents have independent context and cannot spawn further sub-agents.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description for the sub-agent' },
        context: { type: 'string', description: 'Additional context for the sub-agent' },
      },
      required: ['task'],
    },
    async execute(args, ctx): Promise<StepOutcome> {
      if (ctx.isSubAgent) {
        return { data: 'Error: sub-agents cannot spawn further sub-agents.', nextPrompt: null, shouldExit: false, isError: true };
      }
      return {
        data: { task: args.task, context: args.context ?? '' },
        nextPrompt: null,
        shouldExit: false,
      };
    },
  };
}
