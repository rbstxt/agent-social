/**
 * `asocial yt ...` — YouTube commands: search | info | transcript | frames.
 */
import type { FrameExtractor, ImageFormat, Resolution } from './frame.ts';
import { createFrameExtractor, parseTimeToSeconds } from './frame.ts';
import { err, toJson } from './output.ts';
import type { Envelope } from './types.ts';
import type { Engine, SearchOpts } from './youtube.ts';
import { createEngine } from './youtube.ts';
import { runFrames } from './commands/frames.ts';
import { runInfo } from './commands/info.ts';
import { runSearch } from './commands/search.ts';
import { runTranscript } from './commands/transcript.ts';

export const YT_COMMANDS = ['search', 'info', 'transcript', 'frames'] as const;
export type YtCommand = (typeof YT_COMMANDS)[number];

type SearchCmdOpts = {
  query: string;
  limit?: number;
  sort?: SearchOpts['sort'];
  uploadDate?: SearchOpts['uploadDate'];
  duration?: SearchOpts['duration'];
  features?: SearchOpts['features'];
};
type InfoOpts = { targets: string[] };
type TranscriptOpts = {
  targets: string[];
  lang?: string;
  format?: string;
  head?: number;
  maxChars?: number;
};
type FramesCmdOpts = {
  target: string;
  ats: string[];
  res?: Resolution;
  format?: ImageFormat;
  outDir?: string;
};

export type ParsedYtCommand =
  | { kind: 'help' }
  | { kind: 'command'; command: 'search'; opts: SearchCmdOpts }
  | { kind: 'command'; command: 'info'; opts: InfoOpts }
  | { kind: 'command'; command: 'transcript'; opts: TranscriptOpts }
  | { kind: 'command'; command: 'frames'; opts: FramesCmdOpts }
  | { kind: 'unknown'; command: string };

function parseRes(v: string | undefined): Resolution | undefined {
  if (v === 'max') return 'max';
  const n = Number(v);
  return n === 720 || n === 1080 || n === 1440 || n === 2160 ? (n as Resolution) : undefined;
}

const numFlag = (v: string | undefined): number | undefined =>
  v !== undefined && v !== '' ? Number(v) : undefined;

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

export function parseYtArgs(argv: string[]): ParsedYtCommand {
  if (argv.length === 0) return { kind: 'help' };
  const first = argv[0] ?? '';
  if (first === '-h' || first === '--help') return { kind: 'help' };
  if (!(YT_COMMANDS as readonly string[]).includes(first)) {
    return { kind: 'unknown', command: first };
  }

  const rest = argv.slice(1);

  if (first === 'frames') {
    const ats: string[] = [];
    const fpos: string[] = [];
    const fflags: Record<string, string> = {};
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t === '--at') {
        const v = rest[++i];
        if (v !== undefined) ats.push(v);
      } else if (t?.startsWith('--')) {
        const v = rest[i + 1];
        if (v !== undefined && !v.startsWith('--')) {
          fflags[t] = v;
          i++;
        } else {
          fflags[t] = '';
        }
      } else if (t !== undefined) {
        fpos.push(t);
      }
    }
    return {
      kind: 'command',
      command: 'frames',
      opts: {
        target: fpos[0] ?? '',
        ats,
        res: parseRes(fflags['--res']),
        format:
          fflags['--format'] === 'png' ? 'png' : fflags['--format'] === 'jpg' ? 'jpg' : undefined,
        outDir: fflags['--out'] || undefined,
      },
    };
  }

  const { positionals, flags } = tokenize(rest);

  if (first === 'search') {
    return {
      kind: 'command',
      command: 'search',
      opts: {
        query: positionals.join(' '),
        limit: numFlag(flags['--limit']),
        sort: (flags['--sort'] as SearchOpts['sort']) || undefined,
        uploadDate: (flags['--upload-date'] as SearchOpts['uploadDate']) || undefined,
        duration: (flags['--duration'] as SearchOpts['duration']) || undefined,
        features: (flags['--features'] as SearchOpts['features']) || undefined,
      },
    };
  }

  if (first === 'info') {
    return { kind: 'command', command: 'info', opts: { targets: positionals } };
  }

  return {
    kind: 'command',
    command: 'transcript',
    opts: {
      targets: positionals,
      lang: flags['--lang'] || undefined,
      format: flags['--format'],
      head: numFlag(flags['--head']),
      maxChars: numFlag(flags['--max-chars']),
    },
  };
}

export function ytUsage(): string {
  return [
    'Usage: asocial yt <command> [options]',
    '',
    'Commands:',
    '  search      Search YouTube (captioned-only by default) --limit N --sort relevance|date|views|rating --upload-date ... --duration ... --features cc|all',
    '  info        Video detail or channel metadata; batch ok, `-` reads ids from stdin',
    '  transcript  Transcript with peek tier --head SECS --max-chars N --lang xx --format text|json',
    '  frames      Still frame(s) at --at t (repeatable) --res 720|1080|...|max --format jpg|png --out DIR',
    '',
    'Examples:',
    '  asocial yt search "agentic engineering" --limit 30 --sort views',
    '  asocial yt info <id|url|channel> [<id> ...]',
    '  asocial yt transcript <id|url> --head 120',
    '  asocial yt frames <id|url> --at 1:30 --at 2:00 --res 1080 --out ./frames',
  ].join('\n');
}

const invalid = (command: string, message: string) => ({
  stdout: toJson(err(command, 'INVALID_INPUT', message)),
  exitCode: 1,
});

/**
 * Runs a yt subcommand. `stdin` is raw stdin contents; a literal `-` target
 * in a batch command expands to whitespace-separated ids from it.
 */
export async function runYt(
  argv: string[],
  engine: Engine,
  stdin = '',
  frameExtractor?: FrameExtractor,
): Promise<{ stdout: string; exitCode: number }> {
  const parsed = parseYtArgs(argv);

  if (parsed.kind === 'help') return { stdout: ytUsage(), exitCode: 0 };

  if (parsed.kind === 'unknown') {
    return {
      stdout: toJson(
        err('yt', 'UNKNOWN_COMMAND', `unknown yt command: ${parsed.command}`, ytUsage()),
      ),
      exitCode: 2,
    };
  }

  if (parsed.command === 'search') {
    const { limit, sort, uploadDate, duration, features } = parsed.opts;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return invalid('search', '--limit must be a positive integer');
    }
    if (sort !== undefined && !['relevance', 'date', 'views', 'rating'].includes(sort)) {
      return invalid('search', '--sort must be relevance|date|views|rating');
    }
    if (
      uploadDate !== undefined &&
      !['all', 'hour', 'today', 'week', 'month', 'year'].includes(uploadDate)
    ) {
      return invalid('search', '--upload-date must be all|hour|today|week|month|year');
    }
    if (duration !== undefined && !['any', 'short', 'medium', 'long'].includes(duration)) {
      return invalid('search', '--duration must be any|short|medium|long');
    }
    if (features !== undefined && !['cc', 'all'].includes(features)) {
      return invalid('search', '--features must be cc|all');
    }
    const envelope = await runSearch(engine, parsed.opts);
    return { stdout: toJson(envelope), exitCode: envelope.ok ? 0 : 1 };
  }

  if (parsed.command === 'frames') {
    if (parsed.opts.res === undefined && hasFlag(argv, '--res')) {
      return invalid('frames', '--res must be 720|1080|1440|2160|max');
    }
    if (parsed.opts.format === undefined && hasFlag(argv, '--format')) {
      return invalid('frames', '--format must be jpg|png');
    }
    const ats: number[] = [];
    for (const a of parsed.opts.ats) {
      const seconds = parseTimeToSeconds(a);
      if (seconds === null) return invalid('frames', `invalid --at value: ${a}`);
      ats.push(seconds);
    }
    if (ats.length === 0) {
      return invalid('frames', 'at least one --at timestamp is required (e.g. --at 1:30)');
    }
    const envelope = await runFrames(frameExtractor ?? createFrameExtractor(), {
      target: parsed.opts.target,
      ats,
      res: parsed.opts.res,
      format: parsed.opts.format,
      outDir: parsed.opts.outDir,
    });
    return { stdout: toJson(envelope), exitCode: envelope.ok ? 0 : 1 };
  }

  if (parsed.command === 'transcript') {
    const { format, head, maxChars } = parsed.opts;
    if (format !== undefined && format !== 'text' && format !== 'json') {
      return invalid('transcript', '--format must be text or json');
    }
    if (head !== undefined && !(head > 0)) return invalid('transcript', '--head must be positive');
    if (maxChars !== undefined && !(maxChars > 0)) {
      return invalid('transcript', '--max-chars must be positive');
    }
  }

  const targets = parsed.opts.targets.flatMap((t) =>
    t === '-' ? stdin.trim().split(/\s+/).filter(Boolean) : [t],
  );

  const callOne = (target: string): Promise<Envelope<unknown>> => {
    if (parsed.command === 'info') return runInfo(engine, { target });
    return runTranscript(engine, {
      target,
      lang: parsed.opts.lang,
      format: parsed.opts.format as 'text' | 'json' | undefined,
      head: parsed.opts.head,
      maxChars: parsed.opts.maxChars,
    });
  };

  if (targets.length <= 1) {
    const envelope = await callOne(targets[0] ?? '');
    return { stdout: toJson(envelope), exitCode: envelope.ok ? 0 : 1 };
  }
  const results = await Promise.all(targets.map(callOne));
  return { stdout: toJson(results), exitCode: results.every((e) => e.ok) ? 0 : 1 };
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

/** Creates the live engine and runs a yt argv (used by the top-level CLI). */
export async function mainYt(argv: string[], stdin: string): Promise<{ stdout: string; exitCode: number }> {
  const engine = await createEngine();
  return runYt(argv, engine, stdin);
}
