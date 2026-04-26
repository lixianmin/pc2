import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, serializeMessages, buildDynamicTail } from '../../../src/agent/prompt.js';
import type { SkillDefinition } from '../../../src/skill-sop/types.js';
import type { Message, MemoryHit } from '../../../src/types.js';

const makeMessage = (overrides: Partial<Message> & Pick<Message, 'role' | 'content'>): Message => ({
  id: 'msg-1',
  timestamp: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('buildSystemPrompt', () => {
  it('includes tools description', () => {
    const result = buildSystemPrompt('You have a hammer tool.', [], []);
    expect(result).toContain('You have a hammer tool.');
  });

  it('includes skills formatted as name: description', () => {
    const skills: SkillDefinition[] = [
      { name: 'Search', description: 'Search the web', evolvable: false, filePath: '/a' },
      { name: 'Code', description: 'Write code', evolvable: true, filePath: '/b' },
    ];
    const result = buildSystemPrompt('', skills, []);
    expect(result).toContain('- Search: Search the web');
    expect(result).toContain('- Code: Write code');
  });

  it('includes SOPs formatted as name: description', () => {
    const sops: SkillDefinition[] = [
      { name: 'Debug', description: 'Systematic debugging', evolvable: false, filePath: '/c' },
    ];
    const result = buildSystemPrompt('', [], sops);
    expect(result).toContain('- Debug: Systematic debugging');
  });

  it('omits skill/SOP sections when empty', () => {
    const result = buildSystemPrompt('tools here', [], []);
    expect(result).toContain('tools here');
    expect(result).not.toContain('## Skills');
    expect(result).not.toContain('## SOPs');
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

describe('buildDynamicTail', () => {
  it('includes turn number and user message', () => {
    const result = buildDynamicTail('what is 2+2?', 3, []);
    expect(result).toContain('Turn: 3');
    expect(result).toContain('what is 2+2?');
  });

  it('includes relevant memory entries', () => {
    const memories: MemoryHit[] = [
      { id: 'm1', content: 'likes python', type: 'fact', score: 0.9, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const result = buildDynamicTail('code please', 1, memories);
    expect(result).toContain('likes python');
    expect(result).toContain('[Relevant Memory]');
  });

  it('omits memory section when no memories', () => {
    const result = buildDynamicTail('hello', 1, []);
    expect(result).not.toContain('[Relevant Memory]');
  });

  it('uses sv-SE locale format for time', () => {
    const result = buildDynamicTail('hi', 1, [], 'Asia/Shanghai');
    // sv-SE format: YYYY-MM-DD HH:MM:SS
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});
