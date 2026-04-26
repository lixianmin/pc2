import type { Tool, ToolContext } from './types.js';
import type { StepOutcome } from '../types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<StepOutcome | string> {
    const tool = this.tools.get(name);
    if (!tool) return `Unknown tool: ${name}`;
    try {
      return await tool.execute(args, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Tool error (${name}): ${msg}`;
    }
  }

  getToolsDescription(): string {
    const parts: string[] = [];
    for (const tool of this.tools.values()) {
      parts.push(
        `## ${tool.name}\n${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`,
      );
    }
    return parts.join('\n\n');
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
