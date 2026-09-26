import { err, ok } from '../output.ts';
import type { Envelope, XProfile, XStatus, XThread, XTweet } from '../types.ts';
import { normalizeTweet, normalizeUser } from '../xnorm.ts';
import { errorMessage } from './_shared.ts';
import { XError } from '../xengine.ts';
import type { XEngine } from '../xengine.ts';

export async function runXSearch(
  engine: XEngine,
  opts: { query: string; limit: number },
): Promise<Envelope<XTweet[]>> {
  const query = opts.query.trim();
  if (!query) return err('search', 'INVALID_INPUT', 'query is required');
  try {
    // NOTE: twscrape 0.20.1 ignores small --limit values on search (yields the
    // whole first page), so the cap is enforced here to protect context.
    const raw = await engine.search(query, opts.limit);
    return ok(
      'search',
      raw
        .map(normalizeTweet)
        .filter((t): t is XTweet => t !== null)
        .slice(0, opts.limit),
    );
  } catch (e) {
    if (e instanceof XError) throw e;
    return err('search', 'FETCH_FAILED', errorMessage(e));
  }
}

export async function runXThread(
  engine: XEngine,
  opts: { tweetId: string; limit: number },
): Promise<Envelope<XThread>> {
  try {
    const raw = await engine.thread(opts.tweetId, opts.limit);
    const tweets = raw
      .map(normalizeTweet)
      .filter((t): t is XTweet => t !== null)
      .slice(0, opts.limit);
    if (tweets.length === 0) {
      return err('thread', 'FETCH_FAILED', `no tweets returned for ${opts.tweetId}`);
    }
    const root = tweets.find((t) => t.id === opts.tweetId) ?? tweets[0]!;
    const replies = tweets.filter((t) => t.id !== root.id);
    return ok('thread', { root, replies, truncated: raw.length >= opts.limit });
  } catch (e) {
    if (e instanceof XError) throw e;
    return err('thread', 'FETCH_FAILED', errorMessage(e));
  }
}

export async function runXProfile(
  engine: XEngine,
  opts: { handle: string; limit: number },
): Promise<Envelope<XProfile>> {
  try {
    const rawUser = await engine.userByLogin(opts.handle);
    const user = normalizeUser(rawUser);
    if (!user) return err('profile', 'FETCH_FAILED', `could not resolve profile @${opts.handle}`);
    const rawTweets = await engine.userTweets(user.id, opts.limit);
    return ok('profile', {
      user,
      recentTweets: rawTweets
        .map(normalizeTweet)
        .filter((t): t is XTweet => t !== null)
        .slice(0, opts.limit),
    });
  } catch (e) {
    if (e instanceof XError) throw e;
    return err('profile', 'FETCH_FAILED', errorMessage(e));
  }
}

/** Lightweight auth check: one cheap user_by_login for the stable @X account. */
export const STATUS_PROBE_HANDLE = 'X';

export async function runXStatus(engine: XEngine): Promise<Envelope<XStatus>> {
  try {
    const [version, rawUser] = await Promise.all([
      engine.version().catch(() => null),
      engine.userByLogin(STATUS_PROBE_HANDLE),
    ]);
    const user = normalizeUser(rawUser);
    if (!user) return err('status', 'FETCH_FAILED', 'auth check returned no user');
    return ok('status', {
      authenticated: true,
      twscrapeVersion: version,
      probe: { handle: user.username, id: user.id },
    });
  } catch (e) {
    if (e instanceof XError) throw e;
    return err('status', 'FETCH_FAILED', errorMessage(e));
  }
}
