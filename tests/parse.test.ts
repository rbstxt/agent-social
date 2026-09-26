import { describe, expect, test } from 'bun:test';
import { parseChapters, parseViewCount } from '../src/parse.ts';

describe('parseViewCount', () => {
  test('full + compact counts', () => {
    expect(parseViewCount('1,819,130 views')).toBe(1819130);
    expect(parseViewCount('1.8M views')).toBe(1800000);
    expect(parseViewCount('2.3K subscribers')).toBe(2300);
    expect(parseViewCount('3B views')).toBe(3000000000);
  });
  test('null on missing input', () => {
    expect(parseViewCount(null)).toBeNull();
    expect(parseViewCount(undefined)).toBeNull();
    expect(parseViewCount('no views yet')).toBeNull();
  });
});

describe('parseChapters', () => {
  test('parses timestamped lines', () => {
    const desc = 'Intro talk\n0:00 Intro\n12:42 Deep dive\n1:02:03 Outro';
    const chapters = parseChapters(desc);
    expect(chapters).toEqual([
      { title: 'Intro', start: '0:00', startMs: 0 },
      { title: 'Deep dive', start: '12:42', startMs: 762000 },
      { title: 'Outro', start: '1:02:03', startMs: 3723000 },
    ]);
  });
  test('empty when no chapters', () => {
    expect(parseChapters('just a description')).toEqual([]);
    expect(parseChapters(null)).toEqual([]);
  });
});
