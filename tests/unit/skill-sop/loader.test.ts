import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { scanSkillDirectory, parseSkillFrontmatter } from '../../../src/skill-sop/loader.js';

const TEST_DIR = path.join(__dirname, 'tmp-skills');

describe('skill-sop loader', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(TEST_DIR, 'test-skill'), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'test-skill', 'SKILL.md'),
      '---\nname: Test Skill\ndescription: A test skill\nevolvable: true\n---\n\n# Test\n\nDo the thing.',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('scanSkillDirectory discovers skills with SKILL.md', async () => {
    const skills = await scanSkillDirectory(TEST_DIR);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Test Skill');
  });

  it('parseSkillFrontmatter extracts frontmatter fields', () => {
    const content = '---\nname: Foo\ndescription: Bar\nevolvable: false\n---\n\nBody';
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('Foo');
    expect(result.description).toBe('Bar');
    expect(result.evolvable).toBe(false);
  });

  it('parseSkillFrontmatter defaults evolvable to true', () => {
    const content = '---\nname: Foo\ndescription: Bar\n---\n\nBody';
    const result = parseSkillFrontmatter(content);
    expect(result.evolvable).toBe(true);
  });
});
