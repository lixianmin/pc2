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

function extractTextFromHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]*>/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  return text.trim();
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
        const contentType = resp.headers.get('content-type') ?? '';
        const text = await resp.text();

        const MAX_JSON = 50000;
        const MAX_HTML = 20000;

        let result: string;
        if (contentType.includes('application/json') || contentType.includes('text/plain') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
          result = text.slice(0, MAX_JSON);
        } else {
          result = extractTextFromHtml(text).slice(0, MAX_HTML);
        }

        return { data: result, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { data: `Fetch error: ${msg}`, nextPrompt: null, shouldExit: false };
      }
    },
  };
}
