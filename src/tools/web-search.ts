import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description: 'Search the web via local whoogle-search API.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async execute(args): Promise<StepOutcome> {
      return { data: `Web search not yet configured for: ${args.query}`, nextPrompt: null, shouldExit: false };
    },
  };
}
