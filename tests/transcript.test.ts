import { describe, expect, test } from 'bun:test';
import type { TranscriptResult } from '../src/types.ts';
import { applyHead, applyMaxChars } from '../src/transcript.ts';

const base: TranscriptResult = {
  id: 'abc',
  lang: 'en',
  source: 'innertube',
  transcript: 'hello\nworld\na-third-line-here',
  segments: [
    { text: 'hello', startMs: 0, durationMs: 1000 },
    { text: 'world', startMs: 61000, durationMs: 1000 },
    { text: 'a-third-line-here', startMs: 121000, durationMs: 1000 },
  ],
};

describe('applyHead', () => {
  test('windows to the opening', () => {
    const r = applyHead(base, 60);
    expect(r.segments?.length).toBe(1);
    expect(r.transcript).toBe('hello');
    expect(r.truncated).toBe(true);
  });
  test('no-op when everything fits', () => {
    const r = applyHead(base, 3600);
    expect(r).toEqual(base);
  });
  test('null transcript passes through', () => {
    const nullRes: TranscriptResult = {
      id: 'x',
      lang: null,
      source: null,
      transcript: null,
      reason: 'no captions',
    };
    expect(applyHead(nullRes, 60)).toEqual(nullRes);
  });
});

describe('applyMaxChars', () => {
  test('caps on segment boundary', () => {
    const r = applyMaxChars(base, 11); // 'hello\nworld' = 11
    expect(r.transcript).toBe('hello\nworld');
    expect(r.segments?.length).toBe(2);
    expect(r.truncated).toBe(true);
  });
  test('slices first segment when budget is tiny', () => {
    const r = applyMaxChars(base, 3);
    expect(r.transcript).toBe('hel');
    expect(r.truncated).toBe(true);
  });
  test('no-op when everything fits', () => {
    const r = applyMaxChars(base, 10000);
    expect(r).toEqual(base);
  });
});
