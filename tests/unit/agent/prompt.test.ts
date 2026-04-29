import { describe, it, expect } from 'vitest';
import { formatSkillList, serializeMessages } from '../../../src/agent/prompt.js';
import type { SkillDefinition } from '../../../src/skill-sop/types.js';
import type { Message } from '../../../src/types.js';

const makeMessage = (overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({
  id: 'msg-1',
  timestamp: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('formatSkillList', () => {
  it('formats skills as name: description', () => {
    const skills: SkillDefinition[] = [
      { name: 'search', description: 'Search the web', evolvable: false, filePath: '/a' },
      { name: 'code-gen', description: 'Write code', evolvable: true, filePath: '/b' },
    ];
    const result = formatSkillList(skills);
    expect(result).toContain('- search: Search the web');
    expect(result).toContain('- code-gen: Write code');
  });

  it('returns empty string for empty list', () => {
    expect(formatSkillList([])).toBe('');
  });
});

describe('serializeMessages', () => {
  it('formats user message', () => {
    const messages: Message[] = [makeMessage({ role: 'user', content: 'Hello' })];
    const result = serializeMessages(messages);
    expect(result).toBe('[User]\nHello');
  });

  it('formats system message', () => {
    const messages: Message[] = [makeMessage({ role: 'system', content: 'Be helpful' })];
    const result = serializeMessages(messages);
    expect(result).toBe('[System]\nBe helpful');
  });

  it('formats assistant message with tool calls', () => {
    const messages: Message[] = [
      makeMessage({
        role: 'assistant',
        content: 'Let me check.',
        toolCalls: [{ name: 'search', arguments: { query: 'test' } }],
      }),
    ];
    const result = serializeMessages(messages);
    expect(result).toContain('[Assistant]\nLet me check.');
    expect(result).toContain('[Tool Call: search]({"query":"test"})');
  });

  it('formats tool result message by looking up toolCallId', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'msg-a',
        role: 'assistant',
        content: '',
        toolCalls: [{ name: 'search', arguments: { q: 'x' } }],
      }),
      makeMessage({
        id: 'msg-b',
        role: 'tool',
        content: 'found it',
        toolCallId: 'msg-a',
      }),
    ];
    const result = serializeMessages(messages);
    expect(result).toContain('[Tool Result: search]\nfound it');
  });

  it('formats all four message types together', () => {
    const messages: Message[] = [
      makeMessage({ id: 's1', role: 'system', content: 'init' }),
      makeMessage({ id: 'u1', role: 'user', content: 'hi' }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'thinking',
        toolCalls: [{ name: 'bash', arguments: { cmd: 'ls' } }],
      }),
      makeMessage({ id: 't1', role: 'tool', content: 'file.txt', toolCallId: 'a1' }),
    ];
    const result = serializeMessages(messages);
    expect(result).toContain('[System]\ninit');
    expect(result).toContain('[User]\nhi');
    expect(result).toContain('[Assistant]\nthinking');
    expect(result).toContain('[Tool Call: bash]({"cmd":"ls"})');
    expect(result).toContain('[Tool Result: bash]\nfile.txt');
  });
});
