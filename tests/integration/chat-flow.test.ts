import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { createFileReadTool } from '../../src/tools/file-read.js';
import { createFileWriteTool } from '../../src/tools/file-write.js';
import { createAskUserTool } from '../../src/tools/ask-user.js';
import { scanSkillDirectory } from '../../src/skill-sop/loader.js';

describe('integration: basic setup', () => {
  it('registers all tools and scans skills', () => {
    const registry = new ToolRegistry();
    registry.register(createFileReadTool());
    registry.register(createFileWriteTool());
    registry.register(createAskUserTool());
    expect(registry.list()).toHaveLength(3);
  });

  it('skill scanner handles missing directory gracefully', async () => {
    const skills = await scanSkillDirectory('/nonexistent/path');
    expect(skills).toEqual([]);
  });
});
