import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';
import { config } from '../config.js';

export function createWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description: 'Search the web via local whoogle-search API. Returns top results with title, URL, and snippet.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async execute(args): Promise<StepOutcome> {
      try {
        const url = `${config.webSearchUrl}/search?q=${encodeURIComponent(args.query as string)}&format=json`;
        const resp = await fetch(url);
        if (!resp.ok) {
          return { data: `Search error: HTTP ${resp.status}`, nextPrompt: null, shouldExit: false };
        }
        const data = await resp.json() as { results?: Array<{ title: string; href: string; snippet?: string; content?: string }> };
        if (!data.results || data.results.length === 0) {
          return { data: 'No results found.', nextPrompt: null, shouldExit: false };
        }
        const formatted = data.results.slice(0, 8).map((r, i) => {
          const snippet = r.snippet ?? r.content ?? '';
          const cleanSnippet = snippet.replace(/<[^>]*>/g, '').trim();
          return `${i + 1}. ${r.title}\n   ${r.href}\n   ${cleanSnippet.slice(0, 300)}`;
        }).join('\n\n');
        return { data: formatted, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { data: `Search error: ${msg}`, nextPrompt: null, shouldExit: false };
      }
    },
  };
}
