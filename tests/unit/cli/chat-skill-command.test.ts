import { describe, it, expect } from 'vitest';

describe('skill slash command matching', () => {
  const skills = [
    { name: 'pdf-process', description: 'PDF', evolvable: true, filePath: '/fake' },
    { name: 'other-skill', description: 'Other', evolvable: true, filePath: '/fake2' },
  ];

  function matchSkill(input: string) {
    return skills.find(s => input.startsWith('/' + s.name + ' ') || input === '/' + s.name);
  }

  it('matches skill with args', () => {
    const matched = matchSkill('/pdf-process path/to/paper.pdf');
    expect(matched?.name).toBe('pdf-process');
  });

  it('matches skill without args', () => {
    const matched = matchSkill('/pdf-process');
    expect(matched?.name).toBe('pdf-process');
  });

  it('does not match partial name', () => {
    const matched = matchSkill('/pdf-pro path/to/paper.pdf');
    expect(matched).toBeUndefined();
  });

  it('does not match unrelated input', () => {
    const matched = matchSkill('please help with pdf');
    expect(matched).toBeUndefined();
  });

  it('extracts args correctly', () => {
    const input = '/pdf-process path/to/paper.pdf';
    const skill = matchSkill(input)!;
    const args = input.slice(('/' + skill.name).length).trim();
    expect(args).toBe('path/to/paper.pdf');
  });

  it('returns empty string for no args', () => {
    const input = '/pdf-process';
    const skill = matchSkill(input)!;
    const args = input.slice(('/' + skill.name).length).trim();
    expect(args).toBe('');
  });
});
