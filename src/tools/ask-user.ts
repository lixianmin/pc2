import type { Tool } from './types.js';
import type { StepOutcome } from '../types.js';

export function createAskUserTool(): Tool {
  return {
    name: 'ask_user',
    description: 'Interrupt loop and wait for user input.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
      },
      required: ['question'],
    },
    async execute(args): Promise<StepOutcome> {
      return {
        data: null,
        nextPrompt: args.question as string,
        shouldExit: true,
      };
    },
  };
}
