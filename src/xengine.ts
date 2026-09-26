/**
 * twscrape backend bridge. Our TS CLI shells out to the external `twscrape`
 * binary (same pattern as yt-dlp for yt frames) — X GraphQL is NOT
 * reimplemented here.
 *
 * Per CLI invocation the engine creates ONE ephemeral sqlite db in the OS
 * temp dir, loads the single cookie account (`auth_token`/`ct0` from env,
 * passed via stdin so secrets never appear in argv/`ps`), reuses it for all
 * queries, then deletes the dir. Nothing is persisted.
 *
 * Credentials are NEVER logged: all error text is scrubbed before it leaves
 * this module.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export type XErrorKind = 'missing-creds' | 'missing-binary' | 'auth' | 'fetch' | 'timeout';

export class XError extends Error {
  kind: XErrorKind;
  constructor(kind: XErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export const AUTH_HINT =
  'X auth failed — re-extract the auth_token/ct0 cookies from a logged-in browser session, ' +
  'update .env (never commit it), and retry.';

export const TWSCRAPE_HINT =
  'twscrape (the X backend) is required — install it with `pip install twscrape` ' +
  '(or `pipx install twscrape`) and ensure `twscrape` is on PATH. See README.';

export const CREDS_HINT =
  'X credentials are missing — set X_AUTH_TOKEN and X_CT0 in .env (copy .env.example; never commit .env).';

export interface XEngine {
  search(query: string, limit: number): Promise<any[]>;
  thread(tweetId: string, limit: number): Promise<any[]>;
  userByLogin(handle: string): Promise<any>;
  userTweets(userId: string, limit: number): Promise<any[]>;
  version(): Promise<string>;
  dispose(): Promise<void>;
}

export type XEngineOpts = {
  timeoutMs?: number;
  accountName?: string;
};

/** .env search order: $CWD first, then the installed package root (global use). */
function dotEnvPaths(): string[] {
  const paths = [join(process.cwd(), '.env')];
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      if (existsSync(join(dir, 'package.json'))) {
        paths.push(join(dir, '.env'));
        break;
      }
      dir = dirname(dir);
    }
  } catch {
    // ignore — cwd fallback already present
  }
  return paths;
}

/** Reads X_AUTH_TOKEN / X_CT0 from env, falling back to `.env` (cwd, then package root). */
export function resolveXCreds(
  env: NodeJS.ProcessEnv = process.env,
  opts: { readDotEnv?: boolean } = {},
): {
  authToken: string;
  ct0: string;
} | null {
  let authToken = (env['X_AUTH_TOKEN'] ?? '').trim();
  let ct0 = (env['X_CT0'] ?? '').trim();
  if (authToken && ct0) return { authToken, ct0 };
  if (opts.readDotEnv === false) return null;
  for (const p of dotEnvPaths()) {
    try {
      const body = readFileSync(p, 'utf-8');
      for (const line of body.split('\n')) {
        const m = line.match(/^\s*(X_AUTH_TOKEN|X_CT0)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const val = (m[2] ?? '').replace(/^["']|["']$/g, '');
        if (m[1] === 'X_AUTH_TOKEN' && !authToken) authToken = val;
        if (m[1] === 'X_CT0' && !ct0) ct0 = val;
      }
    } catch {
      // no .env here — try next
    }
    if (authToken && ct0) break;
  }
  return authToken && ct0 ? { authToken, ct0 } : null;
}

type ProcResult = { code: number; stdout: string; stderr: string };

function runProc(
  cmd: string,
  args: string[],
  opts: { stdin?: string; timeoutMs: number },
): Promise<ProcResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: ProcResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    let proc;
    try {
      proc = spawn(cmd, args);
    } catch {
      finish({ code: 127, stdout, stderr: 'spawn error (binary missing?)' });
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish({ code: 124, stdout, stderr: `${stderr}\n(timed out after ${opts.timeoutMs}ms)` });
    }, opts.timeoutMs);
    proc.stdout.on('data', (d) => {
      stdout += d;
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
    });
    proc.on('error', () => {
      clearTimeout(timer);
      finish({ code: 127, stdout, stderr: 'spawn error (binary missing?)' });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      finish({ code: code ?? 1, stdout, stderr });
    });
    if (opts.stdin !== undefined) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }
  });
}

const AUTH_PATTERNS =
  /401|403|unauthori|forbidden|login required|invalid.*cookie|expired.*cookie|challenge|account.*locked|account.*suspend|authenticate/i;

/** Live engine backed by the external `twscrape` CLI. */
export function createTwscrapeEngine(
  creds: { authToken: string; ct0: string } | null,
  opts: XEngineOpts = {},
): XEngine {
  const timeoutMs = opts.timeoutMs ?? 90000;
  const accountName = opts.accountName ?? 'asocial';
  let dir: string | null = null;
  let db: string | null = null;
  let ready: Promise<void> | null = null;

  const scrub = (s: string): string => {
    let out = s;
    if (creds) {
      for (const secret of [creds.authToken, creds.ct0]) {
        if (secret && secret.length >= 4) out = out.split(secret).join('***');
      }
    }
    return out.length > 2000 ? `${out.slice(0, 2000)}…` : out;
  };

  const fail = (code: number, stderr: string, what: string): never => {
    const detail = scrub(stderr.trim().split('\n').slice(-6).join(' '));
    if (code === 127) throw new XError('missing-binary', `twscrape binary not found. ${TWSCRAPE_HINT}`);
    if (code === 124) {
      throw new XError(
        'timeout',
        `${what} timed out after ${Math.round(timeoutMs / 1000)}s (bad/expired cookies make twscrape retry-hang). ${AUTH_HINT}`,
      );
    }
    if (AUTH_PATTERNS.test(detail)) throw new XError('auth', `${what} failed: ${detail} ${AUTH_HINT}`);
    throw new XError('fetch', `${what} failed (exit ${code}): ${detail}`);
  };

  const ensureReady = (): Promise<void> => {
    if (!ready) {
      ready = (async () => {
        if (!creds) throw new XError('missing-creds', `X credentials not found. ${CREDS_HINT}`);
        dir = mkdtempSync(join(tmpdir(), 'asocial-x-'));
        db = join(dir, 'accounts.db');
        // Probe the binary first for a clean MISSING_DEPENDENCY signal.
        const probe = await runProc('twscrape', ['version'], { timeoutMs: 15000 });
        if (probe.code === 127) throw new XError('missing-binary', `twscrape binary not found. ${TWSCRAPE_HINT}`);
        const cookieStr = `auth_token=${creds.authToken}; ct0=${creds.ct0}`;
        const add = await runProc('twscrape', ['--db', db, 'add_cookie', accountName], {
          stdin: cookieStr,
          timeoutMs: 30000,
        });
        if (add.code !== 0) fail(add.code, add.stderr, 'twscrape add_cookie');
      })();
    }
    return ready;
  };

  const lines = async (args: string[], what: string): Promise<any[]> => {
    await ensureReady();
    const r = await runProc('twscrape', ['--db', db as string, ...args], { timeoutMs });
    if (r.code !== 0) fail(r.code, r.stderr, what);
    const out: any[] = [];
    for (const line of r.stdout.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        // twscrape may print a stray non-JSON line; ignore it
      }
    }
    return out;
  };

  const one = async (args: string[], what: string): Promise<any> => {
    await ensureReady();
    const r = await runProc('twscrape', ['--db', db as string, ...args], { timeoutMs });
    if (r.code !== 0) fail(r.code, r.stderr, what);
    const t = r.stdout.trim();
    if (!t || t.startsWith('Not Found')) {
      throw new XError('fetch', `${what}: not found`);
    }
    try {
      return JSON.parse(t);
    } catch {
      throw new XError('fetch', `${what}: unexpected output: ${scrub(t.slice(0, 300))}`);
    }
  };

  return {
    search: (query, limit) => lines(['search', query, '--limit', String(limit)], `x search "${query}"`),
    thread: (tweetId, limit) =>
      lines(['tweet_thread', tweetId, '--limit', String(limit)], `x thread ${tweetId}`),
    userByLogin: (handle) => one(['user_by_login', handle], `x profile ${handle}`),
    userTweets: (userId, limit) =>
      lines(['user_tweets', userId, '--limit', String(limit)], `x profile ${userId} tweets`),
    version: async () => {
      const r = await runProc('twscrape', ['version'], { timeoutMs: 15000 });
      if (r.code === 127) throw new XError('missing-binary', `twscrape binary not found. ${TWSCRAPE_HINT}`);
      const m = r.stdout.match(/twscrape:\s*(\S+)/);
      return m?.[1] ?? 'unknown';
    },
    dispose: async () => {
      const d = dir;
      dir = null;
      db = null;
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          // best effort
        }
      }
    },
  };
}
