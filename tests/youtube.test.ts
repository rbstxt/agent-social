import { describe, expect, test } from 'bun:test';
import {
  buildSearchFilters,
  formatDuration,
  noCaptionsResult,
  normalizeChannelInfo,
  normalizeInfo,
  normalizeSearchResults,
  parseHeaderRows,
  parseJson3Transcript,
  pickCaptionTrack,
  resolveTargetKind,
} from '../src/youtube.ts';

const videoNode = (over: Record<string, unknown> = {}) => ({
  type: 'Video',
  video_id: 'dQw4w9WgXcQ',
  title: { toString: () => 'Some Title' },
  author: { name: 'Some Channel', is_verified: true },
  duration: { text: '3:33' },
  view_count: '1,000 views',
  short_view_count: '1K views',
  published: '2 years ago',
  snippets: [{ text: 'a snippet' }],
  badges: [{ label: 'New' }],
  ...over,
});

describe('normalizeSearchResults', () => {
  test('maps signals, skips non-video nodes, respects limit', () => {
    const raw = [videoNode(), { type: 'Channel', video_id: 'x' }, videoNode({ video_id: 'AAAAAAAAAAA' })];
    const out = normalizeSearchResults(raw, 1);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      id: 'dQw4w9WgXcQ',
      title: 'Some Title',
      channel: 'Some Channel',
      verified: true,
      viewCount: 1000,
      viewCountText: '1K views',
      embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    });
  });
  test('null-safe on missing fields', () => {
    const out = normalizeSearchResults([videoNode({ author: null, snippets: null })], 5);
    expect(out[0]?.channel).toBeNull();
    expect(out[0]?.descriptionSnippet).toBeNull();
  });
});

describe('buildSearchFilters', () => {
  test('captioned-only by default', () => {
    expect(buildSearchFilters(undefined)).toEqual({ features: ['subtitles'] });
    expect(buildSearchFilters({ features: 'all' })).toEqual({});
  });
  test('maps sort + filters', () => {
    expect(buildSearchFilters({ sort: 'views', uploadDate: 'month', duration: 'long' })).toEqual({
      sort_by: 'view_count',
      upload_date: 'month',
      duration: 'long',
      features: ['subtitles'],
    });
  });
});

describe('normalizeInfo / normalizeChannelInfo / formatDuration', () => {
  test('video info with chapters + captions', () => {
    const info = normalizeInfo('dQw4w9WgXcQ', {
      title: 'T',
      description: '0:00 Intro\n1:00 Main',
      channel: 'C',
      durationSeconds: 3723,
      viewCount: 5,
      published: 'yesterday',
      verified: true,
      captionLanguages: ['en'],
    });
    expect(info.kind).toBe('video');
    expect(info.duration).toBe('1:02:03');
    expect(info.hasCaptions).toBe(true);
    expect(info.chapters.length).toBe(2);
  });
  test('channel info parses subs', () => {
    const c = normalizeChannelInfo({ type: 'handle', handle: '@mkbhd' }, {
      title: 'MKBHD',
      handle: '@mkbhd',
      subscriberText: '19.8M subscribers',
      description: 'tech',
      verified: true,
    });
    expect(c).toMatchObject({
      kind: 'channel',
      url: 'https://www.youtube.com/@mkbhd',
      subscriberCount: 19800000,
    });
  });
  test('formatDuration', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('pickCaptionTrack / parseJson3Transcript / noCaptionsResult', () => {
  const tracks = [
    { base_url: 'u1', language_code: 'es', kind: 'asr' },
    { base_url: 'u2', language_code: 'en-US' },
  ];
  test('exact lang, base-lang fallback, manual-over-asr', () => {
    expect(pickCaptionTrack(tracks, 'es')?.base_url).toBe('u1');
    expect(pickCaptionTrack(tracks, 'en')?.base_url).toBe('u2');
    expect(pickCaptionTrack(tracks)?.base_url).toBe('u2');
    expect(pickCaptionTrack([])).toBeUndefined();
  });
  test('parses json3, skips blank events', () => {
    const r = parseJson3Transcript('id1', {
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hi ' }, { utf8: 'there' }] },
        { tStartMs: 1000, dDurationMs: 500 },
        { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: '  ' }] },
      ],
    }, 'en');
    expect(r.transcript).toBe('hi there');
    expect(r.segments?.length).toBe(1);
    expect(r.source).toBe('innertube');
  });
  test('noCaptionsResult shape', () => {
    expect(noCaptionsResult('x').transcript).toBeNull();
  });
});

describe('resolveTargetKind', () => {
  test('video vs channel vs null', () => {
    expect(resolveTargetKind('dQw4w9WgXcQ')).toBe('video');
    expect(resolveTargetKind('https://www.youtube.com/@mkbhd')).toBe('channel');
    expect(resolveTargetKind('garbage!!!')).toBeNull();
  });
});

describe('parseHeaderRows', () => {
  test('PageHeaderView metadata rows', () => {
    const header = {
      type: 'PageHeader',
      page_title: 'Marques Brownlee',
      content: {
        metadata: {
          metadata_rows: [
            { metadata_parts: [{ text: '@mkbhd' }] },
            { metadata_parts: [{ text: '21.3M subscribers' }, { text: '1.8K videos' }] },
          ],
        },
      },
    };
    expect(parseHeaderRows(header)).toEqual({
      title: 'Marques Brownlee',
      handle: '@mkbhd',
      subscriberText: '21.3M subscribers',
    });
  });
  test('legacy C4TabbedHeader fields', () => {
    const header = {
      author: { name: 'C' },
      subscribers: '5M subscribers',
      channel_handle: '@c',
    };
    expect(parseHeaderRows(header)).toEqual({
      title: 'C',
      handle: '@c',
      subscriberText: '5M subscribers',
    });
  });
  test('null-safe', () => {
    expect(parseHeaderRows(null)).toEqual({ title: null, handle: null, subscriberText: null });
  });
});

describe('resolveYtCookie (no secrets)', () => {
  test('env direct; empty without sources', async () => {
    const { resolveYtCookie } = await import('../src/youtube.ts');
    expect(resolveYtCookie({ YT_COOKIE: 'SID=x' } as NodeJS.ProcessEnv)).toBe('SID=x');
    expect(resolveYtCookie({} as NodeJS.ProcessEnv, { readDotEnv: false })).toBe('');
  });
});
