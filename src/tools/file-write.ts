import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

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
    async execute(args): Promise<StepOutcome> {
      const filePath = args.path as string;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, args.content as string, 'utf-8');
      return { data: `Written to ${filePath}`, nextPrompt: null, shouldExit: false };
    },
  };
}
