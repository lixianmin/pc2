import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createWebFetchTool(): Tool {
  return {
    name: 'web_fetch',
    description: 'Fetch and extract web page content.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
    async execute(args): Promise<StepOutcome> {
      try {
        const resp = await fetch(args.url as string);
        const text = await resp.text();
        const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
        return { data: stripped, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { data: `Fetch error: ${msg}`, nextPrompt: null, shouldExit: false };
      }
    },
  };
}
