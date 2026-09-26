/**
 * `asocial` — agent-first CLI for YouTube / X / Reddit.
 *
 * `yt` (YouTube), `x` (X via twscrape), and `r` (Reddit via local Redlib)
 * are implemented (see SKILL.md).
 */
import { createRequire } from 'node:module';
import { err, toJson } from './output.ts';
import { mainR, rUsage } from './r.ts';
import { mainX, xUsage } from './x.ts';
import { mainYt, ytUsage } from './yt.ts';

export const MODULES = ['yt', 'x', 'r'] as const;

function topUsage(version: string): string {
  return [
    `asocial v${version} — agent-first CLI for YouTube / X / Reddit`,
    '',
    'Usage: asocial <module> <command> [options]',
    '',
    'Modules:',
    '  yt          YouTube: search | info | transcript | frames',
    '  x           X / Twitter (twscrape): search | thread | profile | status',
    '  r           Reddit (local Redlib): status | posts | thread | search | user',
    '',
    ytUsage(),
    '',
    xUsage(),
    '',
    rUsage(),
  ].join('\n');
}

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // biome-ignore lint/suspicious/noExplicitAny: dynamic require of package.json
    const pkg = require('../package.json') as any;
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

async function readStdin(): Promise<string> {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

export async function run(
  argv: string[],
  stdin = '',
): Promise<{ stdout: string; exitCode: number }> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    return { stdout: topUsage(getVersion()), exitCode: 0 };
  }
  if (argv[0] === '-v' || argv[0] === '--version') {
    return { stdout: getVersion(), exitCode: 0 };
  }

  const [mod, ...rest] = argv;

  if (mod === 'yt') return mainYt(rest, stdin);

  if (mod === 'r') return mainR(rest);

  if (mod === 'x') return mainX(rest);

  return {
    stdout: toJson(
      err('asocial', 'UNKNOWN_COMMAND', `unknown module: ${mod}`, 'modules: yt | x | r'),
    ),
    exitCode: 2,
  };
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Only touch stdin when explicitly asked (a `-` target), so normal
  // invocations never block waiting on an open pipe.
  const stdin = argv.includes('-') ? await readStdin() : '';
  const { stdout, exitCode } = await run(argv, stdin);
  process.stdout.write(`${stdout}\n`);
  process.exit(exitCode);
}

const isEntry = import.meta.main === true;
if (isEntry) {
  void main();
}
