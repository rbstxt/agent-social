/**
 * `asocial r ...` — Reddit commands via self-hosted Redlib (no credentials):
 * status | posts | thread | search | user.
 */
import { errorMessage } from './commands/_shared.ts';
import { err, ok, toJson } from './output.ts';
import { REDLIB_SETUP_HINT, createRedditEngine, ensureRedlib, resolveBaseUrl, touchRedlibUse, type RedditEngine } from './reddit.ts';
import type { Envelope } from './types.ts';

export const R_COMMANDS = ['status', 'posts', 'thread', 'search', 'user'] as const;
export type RCommand = (typeof R_COMMANDS)[number];

export type ParsedRCommand =
  | { kind: 'help' }
  | { kind: 'command'; command: 'status'; opts: Record<string, never> }
  | { kind: 'command'; command: 'posts'; opts: { sub: string; sort: string; limit: number; time: string } }
  | {
      kind: 'command';
      command: 'thread';
      opts: { ref: string; limit: number; sort: string; maxChars?: number };
    }
  | { kind: 'command'; command: 'search'; opts: { query: string; sub?: string; limit: number } }
  | { kind: 'command'; command: 'user'; opts: { name: string; limit: number } }
  | { kind: 'unknown'; command: string };

const POST_SORTS = ['hot', 'new', 'top', 'rising'];
const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'];
const THREAD_SORTS = ['confidence', 'top', 'new', 'controversial', 'old'];

function tokenize(argv: string[]): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok?.startsWith('--')) {
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        flags[tok] = val;
        i += 2;
      } else {
        flags[tok] = '';
        i += 1;
      }
    } else {
      if (tok !== undefined) positionals.push(tok);
      i += 1;
    }
  }
  return { positionals, flags };
}

const numFlag = (v: string | undefined, def: number): number | undefined => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
};

export function parseRArgs(argv: string[]): ParsedRCommand {
  if (argv.length === 0) return { kind: 'help' };
  const first = argv[0] ?? '';
  if (first === '-h' || first === '--help') return { kind: 'help' };
  if (!(R_COMMANDS as readonly string[]).includes(first)) {
    return { kind: 'unknown', command: first };
  }
  const { positionals, flags } = tokenize(argv.slice(1));

  if (first === 'status') return { kind: 'command', command: 'status', opts: {} };

  if (first === 'posts') {
    return {
      kind: 'command',
      command: 'posts',
      opts: {
        sub: positionals[0] ?? '',
        sort: flags['--sort'] || 'hot',
        limit: numFlag(flags['--limit'], 20) ?? NaN,
        time: flags['--time'] || 'day',
      },
    };
  }

  if (first === 'thread') {
    const maxCharsRaw = flags['--max-chars'];
    return {
      kind: 'command',
      command: 'thread',
      opts: {
        ref: positionals[0] ?? '',
        limit: numFlag(flags['--limit'], 50) ?? NaN,
        sort: flags['--sort'] || 'confidence',
        maxChars: maxCharsRaw === undefined || maxCharsRaw === '' ? undefined : Number(maxCharsRaw),
      },
    };
  }

  if (first === 'search') {
    return {
      kind: 'command',
      command: 'search',
      opts: {
        query: positionals.join(' '),
        sub: flags['--sub'] || undefined,
        limit: numFlag(flags['--limit'], 20) ?? NaN,
      },
    };
  }

  return {
    kind: 'command',
    command: 'user',
    opts: { name: positionals[0] ?? '', limit: numFlag(flags['--limit'], 20) ?? NaN },
  };
}

export function rUsage(): string {
  return [
    'Usage: asocial r <command> [options]   (needs local Redlib; REDLIB_URL, default http://127.0.0.1:8182)',
    '',
    'Commands:',
    '  status      Ping local Redlib (reachability + version)',
    '  posts       r posts <subreddit> [--sort hot|new|top|rising] [--limit N] [--time hour|day|week|month|year|all]',
    '  thread      r thread <post-id|url> [--limit N] [--sort confidence|top|new|controversial|old] [--max-chars N]',
    '  search      r search "<query>" [--sub NAME] [--limit N]   (Arctic Shift fallback, `source` marked)',
    '  user        r user <name> [--limit N]',
    '',
    'Examples:',
    '  asocial r status',
    '  asocial r posts cli --sort hot --limit 20',
    '  asocial r thread 1a2b3c --limit 50 --max-chars 1500',
    '  asocial r search "mechanical keyboard" --sub BuyItForLife --limit 20',
    '  asocial r user spez --limit 20',
  ].join('\n');
}

const invalid = (command: string, message: string) => ({
  stdout: toJson(err(command, 'INVALID_INPUT', message)),
  exitCode: 1,
});

const REDLIB_DOWN = 'cannot reach Redlib';

function fetchFailed(command: string, e: unknown) {
  const msg = errorMessage(e);
  if (msg.includes(REDLIB_DOWN)) {
    return { stdout: toJson(err(command, 'MISSING_DEPENDENCY', msg, REDLIB_SETUP_HINT)), exitCode: 1 };
  }
  return { stdout: toJson(err(command, 'FETCH_FAILED', msg)), exitCode: 1 };
}

export async function runR(
  argv: string[],
  engine: RedditEngine,
): Promise<{ stdout: string; exitCode: number }> {
  const parsed = parseRArgs(argv);

  if (parsed.kind === 'help') return { stdout: rUsage(), exitCode: 0 };

  if (parsed.kind === 'unknown') {
    return {
      stdout: toJson(err('r', 'UNKNOWN_COMMAND', `unknown r command: ${parsed.command}`, rUsage())),
      exitCode: 2,
    };
  }

  try {
    if (parsed.command === 'status') {
      const s = await engine.status();
      if (!s.reachable) {
        return {
          stdout: toJson(
            err('status', 'MISSING_DEPENDENCY', `Redlib not reachable at ${s.baseUrl}`, REDLIB_SETUP_HINT),
          ),
          exitCode: 1,
        };
      }
      return { stdout: toJson(ok('status', s)), exitCode: 0 };
    }

    if (parsed.command === 'posts') {
      const { sub, sort, limit, time } = parsed.opts;
      if (!sub.trim()) return invalid('posts', 'subreddit is required (e.g. `r posts cli`)');
      if (!POST_SORTS.includes(sort)) return invalid('posts', '--sort must be hot|new|top|rising');
      if (!Number.isInteger(limit) || limit <= 0) return invalid('posts', '--limit must be a positive integer');
      if (!TIMES.includes(time)) return invalid('posts', '--time must be hour|day|week|month|year|all');
      const data = await engine.listSubreddit(sub, { sort, time, limit });
      const envelope: Envelope<unknown> = ok('posts', data);
      return { stdout: toJson(envelope), exitCode: 0 };
    }

    if (parsed.command === 'thread') {
      const { ref, limit, sort, maxChars } = parsed.opts;
      if (!ref.trim()) return invalid('thread', 'post id or URL is required');
      if (!Number.isInteger(limit) || limit <= 0) return invalid('thread', '--limit must be a positive integer');
      if (!THREAD_SORTS.includes(sort)) {
        return invalid('thread', '--sort must be confidence|top|new|controversial|old');
      }
      if (maxChars !== undefined && !(maxChars > 0)) {
        return invalid('thread', '--max-chars must be positive');
      }
      const data = await engine.getThread(ref, { limit, sort, maxChars });
      return { stdout: toJson(ok('thread', data)), exitCode: 0 };
    }

    if (parsed.command === 'search') {
      const { query, sub, limit } = parsed.opts;
      if (!query.trim()) return invalid('search', 'query is required');
      if (!Number.isInteger(limit) || limit <= 0) return invalid('search', '--limit must be a positive integer');
      const data = await engine.search(query, { sub, limit });
      return { stdout: toJson(ok('search', data)), exitCode: 0 };
    }

    // user
    const { name, limit } = parsed.opts;
    if (!name.trim()) return invalid('user', 'username is required (e.g. `r user spez`)');
    if (!Number.isInteger(limit) || limit <= 0) return invalid('user', '--limit must be a positive integer');
    const data = await engine.getUser(name, { limit });
    return { stdout: toJson(ok('user', data)), exitCode: 0 };
  } catch (e) {
    return fetchFailed(parsed.command, e);
  }
}

/** Creates the live engine (REDLIB_URL env), auto-starting local Redlib on demand, and runs an r argv. */
export async function mainR(argv: string[]): Promise<{ stdout: string; exitCode: number }> {
  const baseUrl = resolveBaseUrl();
  const ensured = await ensureRedlib(baseUrl).catch(() => ({ started: false }));
  touchRedlibUse();
  const out = await runR(argv, createRedditEngine(baseUrl));
  if (argv[0] === 'status' && out.exitCode === 0) {
    try {
      const env = JSON.parse(out.stdout) as { ok: boolean; data?: Record<string, unknown> };
      if (env.ok && env.data && typeof env.data === 'object') {
        return {
          stdout: toJson({ ...env, data: { ...env.data, autostarted: ensured.started } }),
          exitCode: 0,
        };
      }
    } catch {
      // fall through with the original output
    }
  }
  return out;
}
