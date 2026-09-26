/**
 * `asocial x ...` — X/Twitter commands (READ-ONLY) via the external twscrape
 * backend: search | thread | profile | status.
 */
import { errorMessage } from './commands/_shared.ts';
import { runXProfile, runXSearch, runXStatus, runXThread } from './commands/x.ts';
import { err, ok, toJson } from './output.ts';
import type { Envelope } from './types.ts';
import {
  AUTH_HINT,
  CREDS_HINT,
  TWSCRAPE_HINT,
  XError,
  createTwscrapeEngine,
  resolveXCreds,
  type XEngine,
} from './xengine.ts';
import { parseHandle, parseTweetId } from './xnorm.ts';

export const X_COMMANDS = ['search', 'thread', 'profile', 'status'] as const;
export type XCommand = (typeof X_COMMANDS)[number];

export type ParsedXCommand =
  | { kind: 'help' }
  | { kind: 'command'; command: 'search'; opts: { query: string; limit: number } }
  | { kind: 'command'; command: 'thread'; opts: { ref: string; limit: number } }
  | { kind: 'command'; command: 'profile'; opts: { handle: string; limit: number } }
  | { kind: 'command'; command: 'status'; opts: Record<string, never> }
  | { kind: 'unknown'; command: string };

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

export function parseXArgs(argv: string[]): ParsedXCommand {
  if (argv.length === 0) return { kind: 'help' };
  const first = argv[0] ?? '';
  if (first === '-h' || first === '--help') return { kind: 'help' };
  if (!(X_COMMANDS as readonly string[]).includes(first)) {
    return { kind: 'unknown', command: first };
  }
  const { positionals, flags } = tokenize(argv.slice(1));

  if (first === 'status') return { kind: 'command', command: 'status', opts: {} };

  if (first === 'search') {
    return {
      kind: 'command',
      command: 'search',
      opts: { query: positionals.join(' '), limit: numFlag(flags['--limit'], 20) ?? NaN },
    };
  }
  if (first === 'thread') {
    return {
      kind: 'command',
      command: 'thread',
      opts: { ref: positionals[0] ?? '', limit: numFlag(flags['--limit'], 50) ?? NaN },
    };
  }
  return {
    kind: 'command',
    command: 'profile',
    opts: { handle: positionals[0] ?? '', limit: numFlag(flags['--limit'], 20) ?? NaN },
  };
}

export function xUsage(): string {
  return [
    'Usage: asocial x <command> [options]   (needs twscrape + X_AUTH_TOKEN/X_CT0 in .env; read-only)',
    '',
    'Commands:',
    '  search      x search "<query>" [--limit N]   (from:/since: operators pass through)',
    '  thread      x thread <tweet-id|url> [--limit N]',
    '  profile     x profile <handle|url> [--limit N]',
    '  status      x status   (validates cookies against a lightweight probe)',
    '',
    'Examples:',
    '  asocial x search "from:X" --limit 10',
    '  asocial x thread 2103299958007095807 --limit 30',
    '  asocial x profile X --limit 10',
    '  asocial x status',
  ].join('\n');
}

const invalid = (command: string, message: string) => ({
  stdout: toJson(err(command, 'INVALID_INPUT', message)),
  exitCode: 1,
});

function failWithHint(command: string, e: unknown) {
  if (e instanceof XError) {
    if (e.kind === 'missing-creds') {
      return { stdout: toJson(err(command, 'INVALID_INPUT', e.message, CREDS_HINT)), exitCode: 1 };
    }
    if (e.kind === 'missing-binary') {
      return { stdout: toJson(err(command, 'MISSING_DEPENDENCY', e.message, TWSCRAPE_HINT)), exitCode: 1 };
    }
    return { stdout: toJson(err(command, 'FETCH_FAILED', e.message, AUTH_HINT)), exitCode: 1 };
  }
  const msg = errorMessage(e);
  return { stdout: toJson(err(command, 'FETCH_FAILED', msg, AUTH_HINT)), exitCode: 1 };
}

export async function runX(
  argv: string[],
  engine: XEngine,
): Promise<{ stdout: string; exitCode: number }> {
  const parsed = parseXArgs(argv);

  if (parsed.kind === 'help') return { stdout: xUsage(), exitCode: 0 };

  if (parsed.kind === 'unknown') {
    return {
      stdout: toJson(err('x', 'UNKNOWN_COMMAND', `unknown x command: ${parsed.command}`, xUsage())),
      exitCode: 2,
    };
  }

  try {
    if (parsed.command === 'search') {
      const { query, limit } = parsed.opts;
      if (!query.trim()) return invalid('search', 'query is required');
      if (!Number.isInteger(limit) || limit <= 0) {
        return invalid('search', '--limit must be a positive integer');
      }
      const envelope = await runXSearch(engine, { query, limit });
      return withExit(envelope);
    }

    if (parsed.command === 'thread') {
      const { ref, limit } = parsed.opts;
      const tweetId = parseTweetId(ref);
      if (!tweetId) return invalid('thread', 'a tweet id or status URL is required');
      if (!Number.isInteger(limit) || limit <= 0) {
        return invalid('thread', '--limit must be a positive integer');
      }
      const envelope = await runXThread(engine, { tweetId, limit });
      return withExit(envelope);
    }

    if (parsed.command === 'profile') {
      const { handle, limit } = parsed.opts;
      const clean = parseHandle(handle);
      if (!clean) return invalid('profile', 'a handle (e.g. `x profile X`) or profile URL is required');
      if (!Number.isInteger(limit) || limit <= 0) {
        return invalid('profile', '--limit must be a positive integer');
      }
      const envelope = await runXProfile(engine, { handle: clean, limit });
      return withExit(envelope);
    }

    const envelope = await runXStatus(engine);
    if (!envelope.ok) {
      return {
        stdout: toJson(err('status', 'FETCH_FAILED', envelope.error.message, AUTH_HINT)),
        exitCode: 1,
      };
    }
    return { stdout: toJson(ok('status', envelope.data)), exitCode: 0 };
  } catch (e) {
    return failWithHint(parsed.command, e);
  }
}

function withExit(envelope: Envelope<unknown>): { stdout: string; exitCode: number } {
  return { stdout: toJson(envelope), exitCode: envelope.ok ? 0 : 1 };
}

/** Creates the live engine (X_AUTH_TOKEN/X_CT0 env or .env) and runs an x argv. */
export async function mainX(argv: string[]): Promise<{ stdout: string; exitCode: number }> {
  const creds = resolveXCreds();
  if (!creds) {
    return {
      stdout: toJson(err('x', 'INVALID_INPUT', 'X credentials not found.', CREDS_HINT)),
      exitCode: 1,
    };
  }
  const engine = createTwscrapeEngine(creds);
  try {
    return await runX(argv, engine);
  } finally {
    await engine.dispose();
  }
}
