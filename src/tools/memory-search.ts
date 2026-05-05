import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createMemorySearchTool(): Tool {
  return {
    name: 'memory_search',
    description: 'Search long-term memory via LMD. Proactively query for specific knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
    async execute(args, ctx): Promise<StepOutcome> {
      if (!ctx.lmdClient) {
        return { data: 'Memory not available (LMD not connected).', nextPrompt: null, shouldExit: false, isError: true };
      }
      const results = await ctx.lmdClient.queryMemory({
        query: args.query as string,
        limit: (args.limit as number) ?? 5,
      });
      const formatted = results
        .map((r: any) => {
          const scoreStr = typeof r.score === 'number' ? r.score.toFixed(2) : '0.00';
          return `[${r.collection}] (score: ${scoreStr}) ${r.snippet}`;
        })
        .join('\n');
      return { data: formatted || 'No results found.', nextPrompt: null, shouldExit: false };
    },
  };
}
