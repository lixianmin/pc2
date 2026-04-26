import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import type { SkillDefinition } from './types.js';

export function parseSkillFrontmatter(content: string): Omit<SkillDefinition, 'filePath'> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid SKILL.md: missing frontmatter');
  const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
  return {
    name: (frontmatter.name as string) ?? '',
    description: (frontmatter.description as string) ?? '',
    evolvable: (frontmatter.evolvable as boolean) ?? true,
    allowedTools: frontmatter['allowed-tools']
      ? String(frontmatter['allowed-tools']).split(/\s+/)
      : undefined,
    body: match[2].trim(),
  };
}

export async function scanSkillDirectory(dir: string): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const skillPath = join(dir, entry, 'SKILL.md');
    try {
      const fileStat = await stat(skillPath);
      if (!fileStat.isFile()) continue;
      const content = await readFile(skillPath, 'utf-8');
      const parsed = parseSkillFrontmatter(content);
      skills.push({ ...parsed, filePath: skillPath });
    } catch {
      continue;
    }
  }
  return skills;
}
