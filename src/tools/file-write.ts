import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';
import { isPathWithinRoot } from './path-sandbox.js';

export function createFileWriteTool(): Tool {
  return {
    name: 'file_write',
    description: 'Create or fully overwrite a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
    async execute(args, ctx): Promise<StepOutcome> {
      const filePath = args.path as string;
      if (!isPathWithinRoot(filePath, ctx.workspaceRoot)) {
        return { data: `Access denied: path outside workspace (${filePath})`, nextPrompt: null, shouldExit: false };
      }
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, args.content as string, 'utf-8');
      return { data: `Written to ${filePath}`, nextPrompt: null, shouldExit: false };
    },
  };
}
