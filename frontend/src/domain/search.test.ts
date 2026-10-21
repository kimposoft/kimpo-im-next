import { describe, expect, it } from 'vitest';
import { highlightParts } from './search';

describe('safe search highlighting', () => {
  it('returns plain segments and never interprets matching text as HTML', () => {
    const parts = highlightParts('<img src=x onerror=alert(1)> Alpha', 'alpha');
    expect(parts).toEqual([
      { text: '<img src=x onerror=alert(1)> ', match: false },
      { text: 'Alpha', match: true }
    ]);
  });
});
