import { describe, it, expect, afterEach } from 'vitest';
import { countTokens, countMessagesTokens, freeEncoder } from '../../../src/storage/tokens.js';
import type { Message } from '../../../src/types.js';

describe('tokens', () => {
  afterEach(() => {
    freeEncoder();
  });

  it('countTokens returns positive number for non-empty string', async () => {
    const count = await countTokens('Hello, world!');
    expect(count).toBeGreaterThan(0);
  });

  it('countTokens returns 0 for empty string', async () => {
    const count = await countTokens('');
    expect(count).toBe(0);
  });

  it('countMessagesTokens sums across messages', async () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: '' },
      { id: '2', role: 'assistant', content: 'Hi there!', timestamp: '' },
    ];
    const count = await countMessagesTokens(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('countMessagesTokens includes structural overhead', async () => {
    const messages: Message[] = [
      {
        id: '3', role: 'assistant', content: '', timestamp: '',
        toolCalls: [{ name: 'file_read', arguments: { path: '/tmp/x' }, id: 'tc1' }],
      },
    ];
    const count = await countMessagesTokens(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('concurrent calls share same encoder safely', async () => {
    freeEncoder();
    const results = await Promise.all([
      countTokens('hello'),
      countTokens('world'),
      countTokens('test'),
    ]);
    expect(results.every(r => r > 0)).toBe(true);
  });
});
