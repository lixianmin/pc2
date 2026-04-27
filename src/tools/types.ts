import type { StepOutcome } from '../types.js';
import type { LmdMcpClient } from '../memory/lmd-client.js';

export interface ToolContext {
  turn: number;
  index: number;
  lmdClient: LmdMcpClient | null;
  dataDir: string;
  agentId: string;
  isSubAgent: boolean;
  workspaceRoot: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<StepOutcome>;
}
