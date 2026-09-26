import { describe, expect, test } from 'bun:test';
import {
  extractChannelRef,
  extractVideoId,
  toChannelUrl,
  toEmbedUrl,
  toWatchUrl,
} from '../src/ids.ts';

describe('extractVideoId', () => {
  test('bare id', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('watch url with extra params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
  });
  test('youtu.be short link', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('embed + shorts + live', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  test('rejects junk', () => {
    expect(extractVideoId('')).toBeNull();
    expect(extractVideoId('not a video')).toBeNull();
    expect(extractVideoId('https://www.youtube.com/channel/UC1234567890123456789012')).toBeNull();
    expect(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
  test('url builders', () => {
    expect(toWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(toEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });
});

describe('extractChannelRef', () => {
  const UC = 'UC1234567890123456789012';
  test('bare channel id + channel url', () => {
    expect(extractChannelRef(UC)).toEqual({ type: 'id', id: UC });
    expect(extractChannelRef(`https://www.youtube.com/channel/${UC}`)).toEqual({
      type: 'id',
      id: UC,
    });
  });
  test('handles', () => {
    expect(extractChannelRef('@mkbhd')).toEqual({ type: 'handle', handle: '@mkbhd' });
    expect(extractChannelRef('https://www.youtube.com/@mkbhd')).toEqual({
      type: 'handle',
      handle: '@mkbhd',
    });
    expect(extractChannelRef('https://www.youtube.com/c/SomeName')).toEqual({
      type: 'handle',
      handle: '@SomeName',
    });
    expect(extractChannelRef('https://www.youtube.com/user/SomeName')).toEqual({
      type: 'handle',
      handle: '@SomeName',
    });
  });
  test('rejects video refs + junk', () => {
    expect(extractChannelRef('dQw4w9WgXcQ')).toBeNull();
    expect(extractChannelRef('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(extractChannelRef('')).toBeNull();
  });
  test('toChannelUrl', () => {
    expect(toChannelUrl({ type: 'id', id: UC })).toBe(`https://www.youtube.com/channel/${UC}`);
    expect(toChannelUrl({ type: 'handle', handle: '@mkbhd' })).toBe(
      'https://www.youtube.com/@mkbhd',
    );
  });
});
