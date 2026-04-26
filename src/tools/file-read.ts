import { readFile, open } from 'fs/promises';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createFileReadTool(): Tool {
  return {
    name: 'file_read',
    description: 'Read file contents. Supports line range via offset/limit parameters.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        offset: { type: 'number', description: 'Start line (1-indexed)' },
        limit: { type: 'number', description: 'Max lines to read' },
      },
      required: ['path'],
    },
    async execute(args): Promise<StepOutcome> {
      try {
        const content = await readFile(args.path as string, 'utf-8');
        let lines = content.split('\n');
        const offset = (args.offset as number) ?? 1;
        const limit = (args.limit as number) ?? lines.length;
        lines = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = lines.map((l, i) => `${offset + i}: ${l}`).join('\n');
        return { data: numbered, nextPrompt: null, shouldExit: false };
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'ENOENT') {
          return { data: `File not found: ${args.path}`, nextPrompt: null, shouldExit: false };
        }
        const fd = await open(args.path as string, 'r');
        try {
          const buf = Buffer.alloc(8192);
          await fd.read(buf, 0, 8192, 0);
          if (buf.includes(0)) {
            return { data: `Binary file, cannot read: ${args.path}`, nextPrompt: null, shouldExit: false };
          }
          return { data: `Encoding error: file is not UTF-8 (${args.path}). Use bash with iconv to convert.`, nextPrompt: null, shouldExit: false };
        } finally {
          await fd.close();
        }
      }
    },
  };
}
