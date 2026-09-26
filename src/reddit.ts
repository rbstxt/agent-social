/**
 * Reddit engine: self-hosted Redlib over HTTP (HTML scraping of its stable
 * server-rendered templates) + Arctic Shift fallback for search.
 *
 * Redlib exposes NO `.json` suffix routes (verified against
 * redlib-org/redlib `src/main.rs` — every route renders an Askama template;
 * the upstream reddit `.json` is fetched server-side only). So we consume its
 * clean no-JS HTML via `reddit_parse.ts`.
 */
import {
  parsePageError,
  parsePageTokens,
  parsePostList,
  parseSearchPage,
  parseThreadComments,
  parseThreadPost,
  parseUserPage,
} from './reddit_parse.ts';
import type {
  RedditComment,
  RedditPost,
  RedditSearchResult,
  RedditThread,
  RedditUser,
} from './types.ts';

export const REDLIB_SETUP_HINT =
  'start a local Redlib: `git clone https://github.com/redlib-org/redlib /tmp/redlib-build && ' +
  'cd /tmp/redlib-build && cargo build --release && ./target/release/redlib --address 127.0.0.1 --port 8182` ' +
  '(see README), then set REDLIB_URL (default http://127.0.0.1:8182). ' +
  'Optional macOS launchd: see redlib repo contrib/redlib.plist.';

export type FetchText = (url: string) => Promise<{ status: number; text: string }>;

export const defaultFetchText: FetchText = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'asocial-reddit/0.1 (agent-social CLI)', Accept: 'text/html' },
  });
  return { status: res.status, text: await res.text() };
};

export type RedditEngine = {
  baseUrl: string;
  fetchText: FetchText;
  status(): Promise<{ reachable: boolean; version: string | null; baseUrl: string }>;
  listSubreddit(
    sub: string,
    opts: { sort: string; time: string; limit: number },
  ): Promise<{ posts: RedditPost[]; subreddit: string }>;
  getThread(
    ref: string,
    opts: { limit: number; sort: string; maxChars?: number; maxDepth?: number },
  ): Promise<RedditThread>;
  search(
    query: string,
    opts: { sub?: string; limit: number },
  ): Promise<{ results: RedditSearchResult[]; source: 'redlib' | 'arctic_shift' }>;
  getUser(name: string, opts: { limit: number }): Promise<RedditUser>;
};

export function resolveBaseUrl(env = process.env): string {
  const raw = (env['REDLIB_URL'] ?? '').trim() || 'http://127.0.0.1:8182';
  return raw.replace(/\/+$/, '');
}

const ARCTIC = 'https://arctic-shift.photon-reddit.com';

async function getOrThrow(fetchText: FetchText, url: string, what: string): Promise<string> {
  let res: { status: number; text: string };
  try {
    res = await fetchText(url);
  } catch (e) {
    throw new Error(`${what}: cannot reach Redlib at ${url} (${e instanceof Error ? e.message : String(e)}). ${REDLIB_SETUP_HINT}`);
  }
  if (res.status === 404) throw new Error(`${what}: not found (${url})`);
  if (res.status === 429) throw new Error(`${what}: rate-limited (HTTP 429) — retry later`);
  if (res.status < 200 || res.status >= 300) {
    const pageErr = parsePageError(res.text);
    throw new Error(`${what}: Redlib HTTP ${res.status}${pageErr ? ` — ${pageErr}` : ''}`);
  }
  const pageErr = parsePageError(res.text);
  if (pageErr && !res.text.includes('id="posts"') && !res.text.includes('class="post')) {
    throw new Error(`${what}: ${pageErr}`);
  }
  return res.text;
}

export function parseThreadRef(ref: string): { id: string; sub: string | null } {
  const t = ref.trim();
  const m =
    t.match(/\/comments\/([A-Za-z0-9]+)/) ??
    t.match(/redd\.it\/([A-Za-z0-9]+)/) ??
    (/^[A-Za-z0-9]{4,10}$/.test(t) ? [t, t] : null);
  if (!m?.[1]) throw new Error(`cannot parse post id from: ${ref}`);
  const sub = t.match(/\/r\/([^/]+)\/comments\//)?.[1] ?? null;
  return { id: m[1].toLowerCase(), sub };
}

function countComments(cs: RedditComment[]): number {
  return cs.reduce((n, c) => n + 1 + countComments(c.replies), 0);
}

function capDepth(cs: RedditComment[], depth: number, maxDepth: number): RedditComment[] {
  if (depth >= maxDepth) return cs.map((c) => ({ ...c, replies: [] }));
  return cs.map((c) => ({ ...c, replies: capDepth(c.replies, depth + 1, maxDepth) }));
}

function takeN(cs: RedditComment[], budget: number): { out: RedditComment[]; left: number } {
  const out: RedditComment[] = [];
  let left = budget;
  for (const c of cs) {
    if (left <= 0) break;
    left -= 1;
    const kids = takeN(c.replies, left);
    left = kids.left;
    out.push({ ...c, replies: kids.out });
  }
  return { out, left };
}

function truncateBodies(cs: RedditComment[], maxChars: number): RedditComment[] {
  return cs.map((c) => ({
    ...c,
    body: c.body.length > maxChars ? `${c.body.slice(0, maxChars)}…` : c.body,
    replies: truncateBodies(c.replies, maxChars),
  }));
}

type ArcticPost = {
  author?: string;
  subreddit?: string;
  title?: string;
  selftext?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  permalink?: string;
  id?: string;
};

async function arcticSearch(
  query: string,
  sub: string | undefined,
  limit: number,
): Promise<RedditSearchResult[]> {
  // Arctic Shift full-text `query` requires an author/subreddit scope and is
  // slow under load (frequent "Timeout. Maybe slow down a bit"). Without a
  // --sub scope there is no usable fallback — fail fast with a clear error.
  if (!sub) {
    throw new Error('no --sub scope for the Arctic Shift fallback (its full-text query requires a subreddit)');
  }
  const params = new URLSearchParams({
    query,
    subreddit: sub,
    limit: String(Math.min(Math.max(limit, 1), 100)),
    sort: 'desc',
    fields: 'author,subreddit,title,selftext,score,num_comments,created_utc,id',
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(`${ARCTIC}/api/posts/search?${params}`, {
      headers: { 'User-Agent': 'asocial-reddit/0.1' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Arctic Shift HTTP ${res.status}`);
    const json = (await res.json()) as { data?: ArcticPost[] | null; error?: string };
    if (json.error || !Array.isArray(json.data)) {
      throw new Error(`Arctic Shift: ${json.error ?? 'empty response'} (multi-week lag; try again later)`);
    }
    return json.data.slice(0, limit).map((p) => ({
      kind: 'post' as const,
      id: String(p.id ?? ''),
      subreddit: p.subreddit ?? sub,
      title: p.title ?? '',
      author: p.author ?? null,
      score: typeof p.score === 'number' ? p.score : null,
      scoreText: typeof p.score === 'number' ? String(p.score) : null,
      created: typeof p.created_utc === 'number' ? new Date(p.created_utc * 1000).toISOString() : null,
      relTime: null,
      permalink: p.id ? `/r/${p.subreddit ?? sub}/comments/${p.id}/` : '',
      url: null,
      commentCount: typeof p.num_comments === 'number' ? p.num_comments : null,
      body: p.selftext || null,
      nsfw: false,
      spoiler: false,
      stickied: false,
    }));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Arctic Shift timed out after 30s (it is slow under load; multi-week lag)');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function createRedditEngine(baseUrl: string, fetchText: FetchText = defaultFetchText): RedditEngine {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    baseUrl: base,
    fetchText,

    async status() {
      try {
        const res = await fetchText(`${base}/`);
        if (res.status < 200 || res.status >= 300) return { reachable: false, version: null, baseUrl: base };
        const m = res.text.match(/<span id="version">\s*v([^<&\s]+)/);
        return { reachable: true, version: m?.[1] ?? null, baseUrl: base };
      } catch {
        return { reachable: false, version: null, baseUrl: base };
      }
    },

    async listSubreddit(sub, { sort, time, limit }) {
      const clean = sub.replace(/^r\//i, '').trim();
      const posts: RedditPost[] = [];
      let after: string | null = null;
      let guard = 0;
      while (posts.length < limit && guard++ < 10) {
        const q = new URLSearchParams({ sort, t: time, limit: '100' });
        if (after) q.set('after', after);
        const url = `${base}/r/${encodeURIComponent(clean)}/${encodeURIComponent(sort)}?${q}`;
        const html = await getOrThrow(fetchText, url, `r/${clean}`);
        for (const p of parsePostList(html)) {
          if (posts.length >= limit) break;
          if (!posts.some((x) => x.id === p.id)) posts.push(p);
        }
        const next = parsePageTokens(html).after;
        if (!next || next === after) break; // no forward progress
        after = next;
      }
      return { posts, subreddit: clean };
    },

    async getThread(ref, { limit, sort, maxChars, maxDepth = 8 }) {
      const { id, sub } = parseThreadRef(ref);
      const path = sub ? `/r/${encodeURIComponent(sub)}/comments/${id}` : `/comments/${id}`;
      const url = `${base}${path}?sort=${encodeURIComponent(sort)}&limit=100`;
      const html = await getOrThrow(fetchText, url, `thread ${id}`);
      const post = parseThreadPost(html);
      if (!post) throw new Error(`thread ${id}: no post found`);
      // The single-post template carries no id/permalink anchors — backfill
      // from the request ref so downstream consumers always get them.
      if (!post.id) post.id = id;
      if (!post.permalink) {
        const subPart = post.subreddit ? `/r/${post.subreddit}` : sub ? `/r/${sub}` : '';
        post.permalink = `${subPart}/comments/${id}/`;
      }
      const backfillLinks = (cs: RedditComment[]): void => {
        for (const c of cs) {
          if (!c.permalink && c.id) c.permalink = `${post.permalink}${c.id}/`;
          backfillLinks(c.replies);
        }
      };
      let comments = capDepth(parseThreadComments(html), 0, maxDepth);
      backfillLinks(comments);
      if (maxChars !== undefined) {
        comments = truncateBodies(comments, maxChars);
        if (post.body && post.body.length > maxChars) post.body = `${post.body.slice(0, maxChars)}…`;
      }
      const total = countComments(comments);
      const taken = takeN(comments, Math.max(limit, 1));
      return {
        post,
        comments: taken.out,
        truncated: total > countComments(taken.out),
      };
    },

    async search(query, { sub, limit }) {
      const cleanSub = sub?.replace(/^r\//i, '').trim() || undefined;
      const results: RedditSearchResult[] = [];
      let after: string | null = null;
      let guard = 0;
      let redlibFailed = false;
      while (results.length < limit && guard++ < 10) {
        const q = new URLSearchParams({
          q: query,
          sort: 'relevance',
          t: 'all',
          restrict_sr: cleanSub ? 'on' : '',
          limit: '100',
        });
        if (after) q.set('after', after);
        const path = cleanSub ? `/r/${encodeURIComponent(cleanSub)}/search` : '/search';
        try {
          const html = await getOrThrow(fetchText, `${base}${path}?${q}`, 'search');
          const page = parseSearchPage(html);
          for (const p of page.posts) {
            if (results.length >= limit) break;
            if (!results.some((x) => x.kind === 'post' && x.id === p.id)) results.push({ kind: 'post', ...p });
          }
          for (const c of page.comments) {
            if (results.length >= limit) break;
            if (!results.some((x) => x.kind === 'comment' && x.permalink === c.permalink)) {
              results.push({ kind: 'comment', ...c });
            }
          }
          const tokens = parsePageTokens(html);
          if (!tokens.after || tokens.after === after) break; // no forward progress
          after = tokens.after;
        } catch {
          redlibFailed = true;
          break;
        }
      }
      if (results.length === 0 && redlibFailed) {
        try {
          const fb = await arcticSearch(query, cleanSub, limit);
          return { results: fb.slice(0, limit), source: 'arctic_shift' as const };
        } catch (e) {
          throw new Error(
            `search failed on local Redlib and Arctic Shift fallback failed (${e instanceof Error ? e.message : String(e)}). ${REDLIB_SETUP_HINT}`,
          );
        }
      }
      return { results: results.slice(0, limit), source: 'redlib' as const };
    },

    async getUser(name, { limit }) {
      const clean = name.replace(/^u\//i, '').trim();
      const first = await getOrThrow(fetchText, `${base}/user/${encodeURIComponent(clean)}/overview?sort=new&limit=100`, `u/${clean}`);
      const parsed = parseUserPage(first);
      const posts: RedditPost[] = [...parsed.posts];
      const comments: RedditUser['comments'] = [...parsed.comments];
      let after = parsePageTokens(first).after;
      let guard = 0;
      while (posts.length + comments.length < limit && after && guard++ < 10) {
        const html = await getOrThrow(
          fetchText,
          `${base}/user/${encodeURIComponent(clean)}/overview?sort=new&limit=100&after=${encodeURIComponent(after)}`,
          `u/${clean}`,
        );
        const pg = parseUserPage(html);
        for (const p of pg.posts) {
          if (posts.length + comments.length >= limit) break;
          if (!posts.some((x) => x.id === p.id)) posts.push(p);
        }
        for (const c of pg.comments) {
          if (posts.length + comments.length >= limit) break;
          if (!comments.some((x) => x.permalink === c.permalink)) comments.push(c);
        }
        const next = parsePageTokens(html).after;
        if (!next || next === after) break; // no forward progress
        after = next;
      }
      return {
        name: parsed.profile.name ?? clean,
        title: parsed.profile.title,
        description: parsed.profile.description,
        karma: parsed.profile.karma,
        created: parsed.profile.created,
        posts: posts.slice(0, limit),
        comments: comments.slice(0, Math.max(0, limit - posts.length)),
      };
    },
  };
}
