import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '169.254.169.254',
];

export function isUrlAllowed(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;
    if (BLOCKED_HOSTS.includes(host)) return false;
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

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
      if (!isUrlAllowed(args.url as string)) {
        return { data: `URL not allowed: ${args.url}`, nextPrompt: null, shouldExit: false };
      }
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
