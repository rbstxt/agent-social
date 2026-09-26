import { describe, expect, test } from 'bun:test';
import { run } from '../src/cli.ts';
import { parseTweetId, parseHandle, normalizeTweet, normalizeUser } from '../src/xnorm.ts';
import { runX, parseXArgs } from '../src/x.ts';
import { XError, resolveXCreds, type XEngine } from '../src/xengine.ts';

const rawUser = {
  id: 783214,
  id_str: '783214',
  url: 'https://x.com/X',
  username: 'X',
  displayname: 'X',
  rawDescription: "what's happening?!",
  created: '2007-02-20 14:35:54+00:00',
  followersCount: 60734253,
  friendsCount: 1,
  statusesCount: 15720,
  favouritesCount: 5970,
  listedCount: 0,
  mediaCount: 2492,
  location: 'everywhere',
  profileImageUrl: 'https://pbs.twimg.com/profile_images/x_normal.jpg',
  profileBannerUrl: 'https://pbs.twimg.com/profile_banners/783214/1',
  protected: false,
  verified: false,
  blue: true,
  blueType: 'Business',
  descriptionLinks: [],
  pinnedIds: [],
  _type: 'snscrape.modules.twitter.User',
};

const rawTweet = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id: Number(id),
  id_str: id,
  url: `https://x.com/X/status/${id}`,
  date: '2026-09-25 01:46:02+00:00',
  user: rawUser,
  lang: 'en',
  rawContent: text,
  replyCount: 1,
  retweetCount: 2,
  likeCount: 3,
  quoteCount: 0,
  bookmarkedCount: 0,
  conversationId: Number(id),
  conversationIdStr: id,
  hashtags: ['demo'],
  cashtags: [],
  mentionedUsers: [{ username: 'someone' }, 'plainuser'],
  links: [{ url: 'https://example.com', text: 'example', tcourl: 'https://t.co/abc' }],
  media: { photos: [], videos: [] },
  viewCount: 100,
  retweetedTweet: null,
  quotedTweet: null,
  place: null,
  coordinates: null,
  inReplyToTweetId: null,
  inReplyToTweetIdStr: null,
  inReplyToUser: null,
  source: '<a href="http://twitter.com/download/iphone" rel="nofollow">Twitter for iPhone</a>',
  sourceUrl: 'http://twitter.com/download/iphone',
  sourceLabel: 'Twitter for iPhone',
  card: null,
  possibly_sensitive: null,
  isQuoteStatus: false,
  isTranslatable: false,
  displayTextRange: [0, 10],
  inReplyToScreenName: null,
  editControl: null,
  voiceInfo: null,
  _type: 'snscrape.modules.twitter.Tweet',
  ...extra,
});

const fakeEngine: XEngine = {
  search: async (q) => [rawTweet('1111111111111111111', `result for ${q}`)],
  thread: async (id) => [
    rawTweet(id, 'root post'),
    rawTweet('2222222222222222222', 'a reply', {
      inReplyToTweetId: Number(id),
      inReplyToTweetIdStr: id,
      conversationIdStr: id,
    }),
  ],
  userByLogin: async (h) => ({ ...rawUser, username: h.replace(/^@/, '') }),
  userTweets: async () => [rawTweet('3333333333333333333', 'recent one')],
  version: async () => '0.20.1-test',
  dispose: async () => {},
};

describe('xnorm', () => {
  test('normalizeTweet tags source + maps fields', () => {
    const t = normalizeTweet(rawTweet('2103299958007095807', 'hello world'))!;
    expect(t.source).toBe('x-cookie');
    expect(t.id).toBe('2103299958007095807');
    expect(t.text).toBe('hello world');
    expect(t.author?.username).toBe('X');
    expect(t.hashtags).toEqual(['demo']);
    expect(t.mentionedUsers).toEqual(['someone', 'plainuser']);
    expect(t.links).toEqual(['https://example.com']);
    expect(t.quotedTweet).toBeNull();
  });
  test('normalizeTweet maps quoted tweet + media counts', () => {
    const t = normalizeTweet(
      rawTweet('1', 'q', {
        quotedTweet: rawTweet('2', 'inner', { user: { ...rawUser, username: 'inner' } }),
        media: { photos: [{ url: 'p' }], videos: [{ url: 'v' }, { url: 'v2' }] },
      }),
    )!;
    expect(t.quotedTweet?.id).toBe('2');
    expect(t.quotedTweet?.username).toBe('inner');
    expect(t.photoCount).toBe(1);
    expect(t.videoCount).toBe(2);
  });
  test('normalizeTweet rejects junk', () => {
    expect(normalizeTweet(null)).toBeNull();
    expect(normalizeTweet({})).toBeNull();
  });
  test('normalizeUser tags source + maps fields', () => {
    const u = normalizeUser(rawUser)!;
    expect(u.source).toBe('x-cookie');
    expect(u.username).toBe('X');
    expect(u.followersCount).toBe(60734253);
  });
  test('parseTweetId accepts id + status URLs', () => {
    expect(parseTweetId('2103299958007095807')).toBe('2103299958007095807');
    expect(parseTweetId('https://x.com/X/status/2103299958007095807')).toBe('2103299958007095807');
    expect(parseTweetId('https://twitter.com/X/status/123456789')).toBe('123456789');
    expect(parseTweetId('bogus')).toBeNull();
  });
  test('parseHandle accepts @, bare, profile URLs', () => {
    expect(parseHandle('@X')).toBe('X');
    expect(parseHandle('X')).toBe('X');
    expect(parseHandle('https://x.com/X')).toBe('X');
    expect(parseHandle('not a handle!!')).toBeNull();
  });
});

describe('parseXArgs', () => {
  test('search joins positionals, default limit 20', () => {
    const p = parseXArgs(['search', 'from:X', 'hello', '--limit', '5']);
    expect(p).toMatchObject({ kind: 'command', command: 'search' });
    if (p.kind === 'command' && p.command === 'search') {
      expect(p.opts.query).toBe('from:X hello');
      expect(p.opts.limit).toBe(5);
    } else throw new Error('parse failed');
  });
  test('thread/profile defaults + unknown', () => {
    const t = parseXArgs(['thread', '123456789']);
    if (t.kind === 'command' && t.command === 'thread') expect(t.opts.limit).toBe(50);
    else throw new Error('parse failed');
    expect(parseXArgs(['post'])).toMatchObject({ kind: 'unknown' });
  });
});

describe('runX validation (no network)', () => {
  test('search requires query + valid limit', async () => {
    for (const args of [['search', ''], ['search', 'q', '--limit', '0'], ['search', 'q', '--limit', 'x']]) {
      const r = await runX(args, fakeEngine);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
    }
  });
  test('thread requires tweet id/url', async () => {
    const r = await runX(['thread', 'bogus'], fakeEngine);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
  });
  test('profile requires handle', async () => {
    const r = await runX(['profile', 'not a handle!!'], fakeEngine);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
  });
  test('search happy path returns tagged tweets', async () => {
    const r = await runX(['search', 'from:X', '--limit', '5'], fakeEngine);
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.data[0].source).toBe('x-cookie');
  });
  test('thread splits root + replies', async () => {
    const r = await runX(['thread', '1111111111111111111', '--limit', '10'], fakeEngine);
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.root.id).toBe('1111111111111111111');
    expect(env.data.replies.length).toBe(1);
  });
  test('profile returns user + recent tweets', async () => {
    const r = await runX(['profile', '@X', '--limit', '5'], fakeEngine);
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.user.source).toBe('x-cookie');
    expect(env.data.recentTweets.length).toBe(1);
  });
  test('status happy path', async () => {
    const r = await runX(['status'], fakeEngine);
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.authenticated).toBe(true);
    expect(env.data.twscrapeVersion).toBe('0.20.1-test');
  });
  test('auth error maps to FETCH_FAILED with re-extract hint', async () => {
    const bad: XEngine = {
      ...fakeEngine,
      search: async () => {
        throw new XError('auth', '401 unauthorized');
      },
    };
    const r = await runX(['search', 'q'], bad);
    expect(r.exitCode).toBe(1);
    const env = JSON.parse(r.stdout);
    expect(env.error.code).toBe('FETCH_FAILED');
    expect(env.error.hint).toContain('auth_token/ct0');
  });
  test('missing binary maps to MISSING_DEPENDENCY', async () => {
    const bad: XEngine = {
      ...fakeEngine,
      search: async () => {
        throw new XError('missing-binary', 'no twscrape');
      },
    };
    const r = await runX(['search', 'q'], bad);
    expect(JSON.parse(r.stdout).error.code).toBe('MISSING_DEPENDENCY');
  });
  test('unknown x command exit 2', async () => {
    const r = await runX(['post'], fakeEngine);
    expect(r.exitCode).toBe(2);
  });
});

describe('resolveXCreds (no secrets)', () => {
  test('reads from env', () => {
    const c = resolveXCreds({ X_AUTH_TOKEN: 'a', X_CT0: 'b' } as NodeJS.ProcessEnv);
    expect(c).toEqual({ authToken: 'a', ct0: 'b' });
  });
  test('null when incomplete (no .env fallback)', () => {
    expect(
      resolveXCreds({ X_AUTH_TOKEN: 'a' } as NodeJS.ProcessEnv, { readDotEnv: false }),
    ).toBeNull();
    expect(resolveXCreds({} as NodeJS.ProcessEnv, { readDotEnv: false })).toBeNull();
  });
});

describe('top-level x routing', () => {
  test('x help exits 0', async () => {
    const r = await run(['x']);
    expect(r.exitCode).toBe(0);
  });
});
