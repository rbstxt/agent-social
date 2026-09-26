import { describe, expect, test } from 'bun:test';
import { run } from '../src/cli.ts';
import { parseRArgs, runR } from '../src/r.ts';
import { createRedditEngine, ensureRedlib, findRedlibBin, parseThreadRef, type RedditEngine } from '../src/reddit.ts';
import {
  parsePageTokens,
  parsePostList,
  parseSearchPage,
  parseThreadComments,
  parseThreadPost,
  parseUserPage,
} from '../src/reddit_parse.ts';

const subHtml = await Bun.file(new URL('./fixtures/reddit_subreddit.html', import.meta.url)).text();
const threadHtml = await Bun.file(new URL('./fixtures/reddit_thread.html', import.meta.url)).text();
const searchHtml = await Bun.file(new URL('./fixtures/reddit_search.html', import.meta.url)).text();
const userHtml = await Bun.file(new URL('./fixtures/reddit_user.html', import.meta.url)).text();

describe('parsePostList (Redlib subreddit fixture)', () => {
  test('two posts with exact fields', () => {
    const posts = parsePostList(subHtml);
    expect(posts.length).toBe(2);
    const [a, b] = posts as [NonNullable<(typeof posts)[number]>, NonNullable<(typeof posts)[number]>];
    expect(a.id).toBe('abc123');
    expect(a.subreddit).toBe('testsub');
    expect(a.title).toBe('First test post'); // flair link excluded
    expect(a.author).toBe('testuser');
    expect(a.score).toBe(1234); // exact from title attr, not "1.2k"
    expect(a.commentCount).toBe(56);
    expect(a.permalink).toBe('/r/testsub/comments/abc123/first_test_post/');
    expect(a.body).toContain('Hello world');
    expect(a.nsfw).toBe(false);
    expect(a.stickied).toBe(false);
    expect(b?.stickied).toBe(true);
    expect(b?.nsfw).toBe(true);
    expect(b?.url).toBe('https://example.com/article');
  });
  test('footer after-token', () => {
    expect(parsePageTokens(subHtml)).toMatchObject({ after: 't3_def456', before: null });
  });
});

describe('thread fixture', () => {
  test('post + nested comment tree', () => {
    const post = parseThreadPost(threadHtml);
    expect(post?.title).toBe('First test post');
    expect(post?.body).toContain('Full post body');
    expect(post?.permalink).toBe('/r/testsub/comments/abc123/first_test_post/');
    expect(post?.commentCount).toBe(3); // from #comment_count
    const cs = parseThreadComments(threadHtml);
    expect(cs.length).toBe(2);
    expect(cs[0]?.replies.length).toBe(1);
    expect(cs[0]?.replies[0]?.author).toBe('testuser');
    expect(cs[1]?.author).toBeNull(); // [deleted] renders as span, no link
    expect(cs[1]?.moreCount).toBe(7);
  });
});

describe('search + user fixtures', () => {
  test('mixed post/comment search results', () => {
    const { posts, comments } = parseSearchPage(searchHtml);
    expect(posts.length).toBe(1);
    expect(comments.length).toBe(1);
    expect(comments[0]?.permalink).toBe('/r/gadgets/comments/sea002/_/cmt010/');
    expect(comments[0]?.body).toContain('fictional review');
  });
  test('user profile + posts + comments', () => {
    const { profile, posts, comments } = parseUserPage(userHtml);
    expect(profile.name).toBe('testuser');
    expect(profile.title).toBe('Test User');
    expect(profile.karma).toBe(1234);
    expect(profile.created).toContain('21');
    expect(posts.length).toBe(1);
    expect(comments.length).toBe(1);
    expect(comments[0]?.subreddit).toBe('othersub');
    expect(comments[0]?.linkTitle).toBe('Some other thread');
  });
});

describe('parseThreadRef', () => {
  test('bare id, full url, redd.it, garbage', () => {
    expect(parseThreadRef('abc123')).toMatchObject({ id: 'abc123', sub: null });
    expect(parseThreadRef('https://www.reddit.com/r/testsub/comments/abc123/title/')).toMatchObject({
      id: 'abc123',
      sub: 'testsub',
    });
    expect(parseThreadRef('https://redd.it/abc123')).toMatchObject({ id: 'abc123' });
    expect(() => parseThreadRef('not a url!!!')).toThrow();
  });
});

const fixtureEngine = (overrides: Partial<RedditEngine> = {}): RedditEngine =>
  Object.assign(
    createRedditEngine('http://127.0.0.1:8182', async (url) => {
      if (url.includes('/comments/') || url.includes('/comments?')) return { status: 200, text: threadHtml };
      if (url.includes('/search')) return { status: 200, text: searchHtml };
      if (url.includes('/user/')) return { status: 200, text: userHtml };
      return { status: 200, text: subHtml };
    }),
    overrides,
  );

describe('parseRArgs', () => {
  test('posts defaults + thread max-chars', () => {
    const p = parseRArgs(['posts', 'cli', '--sort', 'top']);
    expect(p).toMatchObject({ kind: 'command', command: 'posts' });
    const t = parseRArgs(['thread', 'abc123', '--max-chars', '1500']);
    if (t.kind === 'command' && t.command === 'thread') expect(t.opts.maxChars).toBe(1500);
    else throw new Error('parse failed');
  });
  test('unknown r command', () => {
    expect(parseRArgs(['download'])).toMatchObject({ kind: 'unknown' });
  });
});

describe('runR validation (no network — fixture fetch)', () => {
  test('posts happy path', async () => {
    const r = await runR(['posts', 'testsub', '--limit', '2'], fixtureEngine());
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.posts.length).toBe(2);
    expect(env.data.subreddit).toBe('testsub');
  });
  test('posts rejects bad sort/limit/time', async () => {
    for (const args of [
      ['posts', 'x', '--sort', 'bogus'],
      ['posts', 'x', '--limit', '0'],
      ['posts', 'x', '--time', 'forever'],
      ['posts', ''],
    ]) {
      const r = await runR(args, fixtureEngine());
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
    }
  });
  test('thread happy path with truncation + limit', async () => {
    const r = await runR(['thread', 'abc123', '--limit', '1', '--max-chars', '10'], fixtureEngine());
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.post.title).toBe('First test post');
    expect(env.data.post.id).toBe('abc123'); // backfilled: single-post template has no id anchor
    expect(env.data.post.commentCount).toBe(3);
    expect(env.data.comments.length).toBe(1);
    expect(env.data.truncated).toBe(true);
    expect(env.data.comments[0].body.length).toBeLessThanOrEqual(11);
    expect(env.data.comments[0].permalink).toContain('abc123');
  });
  test('thread rejects bad sort', async () => {
    const r = await runR(['thread', 'abc123', '--sort', 'bogus'], fixtureEngine());
    expect(r.exitCode).toBe(1);
  });
  test('search happy path marks source', async () => {
    const r = await runR(['search', 'widget', '--limit', '5'], fixtureEngine());
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.source).toBe('redlib');
    expect(env.data.results.length).toBe(2);
  });
  test('user happy path', async () => {
    const r = await runR(['user', 'testuser'], fixtureEngine());
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.name).toBe('testuser');
    expect(env.data.posts.length + env.data.comments.length).toBeGreaterThan(0);
  });
  test('Redlib down → MISSING_DEPENDENCY', async () => {
    const down = createRedditEngine('http://127.0.0.1:8182', async () => {
      throw new Error('fetch failed');
    });
    const r = await runR(['posts', 'x'], down);
    expect(r.exitCode).toBe(1);
    const env = JSON.parse(r.stdout);
    expect(env.error.code).toBe('MISSING_DEPENDENCY');
    expect(env.error.hint).toContain('cargo build --release');
  });
  test('status down → MISSING_DEPENDENCY; up → ok', async () => {
    const down = createRedditEngine('http://127.0.0.1:8182', async () => {
      throw new Error('nope');
    });
    expect(JSON.parse((await runR(['status'], down)).stdout).error.code).toBe('MISSING_DEPENDENCY');
    const up = createRedditEngine('http://127.0.0.1:9', async () => ({
      status: 200,
      text: '<html><span id="version">v0.35.0&emsp;</span></html>',
    }));
    const r = await runR(['status'], up);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).data.version).toBe('0.35.0');
  });
  test('unknown r command exit 2', async () => {
    const r = await runR(['frobnicate'], fixtureEngine());
    expect(r.exitCode).toBe(2);
  });
});

describe('top-level routing', () => {
  test('r routes to the reddit module (no network on --help)', async () => {
    const r = await run(['r', '--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('asocial r');
  });
});

describe('ensureRedlib (on-demand start, injected fakes)', () => {
  test('already up → no spawn', async () => {
    let spawned = 0;
    const r = await ensureRedlib('http://127.0.0.1:8182', {
      fetchText: async () => ({ status: 200, text: 'ok' }),
      spawnFn: () => {
        spawned++;
      },
    });
    expect(r).toMatchObject({ started: false });
    expect(spawned).toBe(0);
  });
  test('down loopback → spawn with host/port args, poll to ready', async () => {
    let calls = 0;
    const seen: Array<{ bin: string; args: string[] }> = [];
    const r = await ensureRedlib('http://127.0.0.1:8182', {
      fetchText: async () => (++calls < 3 ? { status: 500, text: '' } : { status: 200, text: 'ok' }),
      spawnFn: (bin, args) => {
        seen.push({ bin, args });
      },
    });
    expect(r).toMatchObject({ started: true });
    expect(seen.length).toBe(1);
    expect(seen[0]?.args).toEqual(['--address', '127.0.0.1', '--port', '8182']);
    expect(typeof seen[0]?.bin).toBe('string');
  });
  test('remote host down → never spawn', async () => {
    let spawned = 0;
    const r = await ensureRedlib('http://example.com:8182', {
      fetchText: async () => {
        throw new Error('refused');
      },
      spawnFn: () => {
        spawned++;
      },
    });
    expect(r).toMatchObject({ started: false });
    expect(spawned).toBe(0);
  });
  test('spawn throws → started false', async () => {
    const r = await ensureRedlib('http://127.0.0.1:8182', {
      fetchText: async () => {
        throw new Error('refused');
      },
      spawnFn: () => {
        throw new Error('no bin');
      },
    });
    expect(r).toMatchObject({ started: false });
  });
  test('findRedlibBin honors REDLIB_BIN', () => {
    expect(findRedlibBin({ REDLIB_BIN: '/bin/echo', PATH: '' } as NodeJS.ProcessEnv)).toBe(
      '/bin/echo',
    );
  });
});
