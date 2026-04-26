import { readFile, writeFile } from 'fs/promises';
import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createFileEditTool(): Tool {
  return {
    name: 'file_edit',
    description: 'Exact string search-and-replace in an existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        old_string: { type: 'string', description: 'Text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(args): Promise<StepOutcome> {
      const filePath = args.path as string;
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const content = await readFile(filePath, 'utf-8');
      if (!content.includes(oldStr)) {
        return { data: `old_string not found in ${filePath}`, nextPrompt: null, shouldExit: false };
      }
      const updated = content.replace(oldStr, newStr);
      await writeFile(filePath, updated, 'utf-8');
      return { data: `Edited ${filePath}`, nextPrompt: null, shouldExit: false };
    },
  };
}
