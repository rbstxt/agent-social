/**
 * High-res frame extraction. The ONLY module that shells out to external
 * binaries (yt-dlp + ffmpeg/ffprobe); everything else is pure TypeScript.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Converts a raw `Cookie` header string (`a=1; b=2`) to Netscape cookies.txt
 * for yt-dlp `--cookies`. Domain-scoped to `.youtube.com` with a far-future
 * expiry (session cookies work fine). Returns '' for empty input.
 */
export function cookieHeaderToNetscape(header: string): string {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !value) continue;
    lines.push(['.youtube.com', 'TRUE', '/', 'TRUE', '2147483647', name, value].join('\t'));
  }
  return lines.length > 1 ? `${lines.join('\n')}\n` : '';
}

/**
 * Writes a temp Netscape cookie file for one yt-dlp invocation. Returns the
 * path, or null when no cookie was given. Callers delete it in a finally.
 */
export function writeTempCookieFile(cookieHeader: string): string | null {
  const body = cookieHeaderToNetscape(cookieHeader);
  if (!body) return null;
  const dir = mkdtempSync(join(tmpdir(), 'asocial-cookies-'));
  const path = join(dir, 'cookies.txt');
  writeFileSync(path, body);
  return path;
}

export function removeTempCookieFile(path: string | null): void {
  if (!path) return;
  try {
    rmSync(join(path, '..'), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Parses a time expression to seconds. Accepts plain seconds ("90", "7.5"),
 * "mm:ss" / "h:mm:ss", or a millisecond suffix ("90000ms" — drops straight
 * from a transcript segment's startMs). Null for junk or negatives.
 */
export function parseTimeToSeconds(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  if (/^\d+ms$/.test(s)) return Number.parseInt(s, 10) / 1000;

  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  const n = Number(s);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
}

export type Resolution = 720 | 1080 | 1440 | 2160 | 'max';

/** Builds the yt-dlp `-f` format string, capping height unless 'max'. */
export function ytdlpFormat(res: Resolution): string {
  if (res === 'max') return 'bestvideo/best';
  return `bestvideo[height<=${res}]/best[height<=${res}]/bestvideo/best`;
}

export type ImageFormat = 'jpg' | 'png';

/**
 * Builds ffmpeg args to grab ONE frame at `seconds`. `-ss` precedes `-i` so
 * ffmpeg range-seeks the remote stream instead of downloading it.
 */
export function ffmpegArgs(
  url: string,
  seconds: number,
  outPath: string,
  format: ImageFormat,
): string[] {
  const args = ['-ss', String(seconds), '-i', url, '-frames:v', '1', '-an', '-sn'];
  if (format === 'jpg') args.push('-q:v', '2');
  args.push('-y', outPath);
  return args;
}

/** Deterministic output filename: `<id>-<seconds>s.<ext>` (seconds rounded). */
export function frameOutputName(id: string, seconds: number, format: ImageFormat): string {
  return `${id}-${Math.round(seconds)}s.${format}`;
}

/**
 * Abstraction over the external binaries, injected into the command layer so
 * command logic is testable without yt-dlp/ffmpeg installed.
 */
export interface FrameExtractor {
  depsAvailable(): Promise<{ ffmpeg: boolean; ytdlp: boolean }>;
  resolveStreamUrl(id: string, res: Resolution): Promise<string>;
  grabFrame(
    url: string,
    seconds: number,
    outPath: string,
    format: ImageFormat,
  ): Promise<{ width: number; height: number }>;
}

/** Spawns a binary, resolving its exit code + captured output (never rejects). */
function exec(
  cmd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(cmd, args);
    proc.stdout.on('data', (d) => {
      stdout += d;
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
    });
    proc.on('error', () => resolve({ code: 127, stdout, stderr: 'spawn error (binary missing?)' }));
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Real extractor backed by yt-dlp (URL resolution) + ffmpeg/ffprobe. Pass a raw `Cookie` header string to resolve age-restricted videos. */
export function createFrameExtractor(cookieHeader = ''): FrameExtractor {
  return {
    async depsAvailable() {
      const [ff, yd] = await Promise.all([
        exec('ffmpeg', ['-version']),
        exec('yt-dlp', ['--version']),
      ]);
      return { ffmpeg: ff.code === 0, ytdlp: yd.code === 0 };
    },

    async resolveStreamUrl(id, res) {
      const watch = `https://www.youtube.com/watch?v=${id}`;
      const cookieFile = writeTempCookieFile(cookieHeader);
      try {
        const args = cookieFile
          ? ['--cookies', cookieFile, '-f', ytdlpFormat(res), '-g', watch]
          : ['-f', ytdlpFormat(res), '-g', watch];
        const r = await exec('yt-dlp', args);
        const url = r.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)[0];
        if (r.code !== 0 || !url) {
          throw new Error(`yt-dlp could not resolve a stream URL (exit ${r.code})`);
        }
        return url;
      } finally {
        removeTempCookieFile(cookieFile);
      }
    },

    async grabFrame(url, seconds, outPath, format) {
      const r = await exec('ffmpeg', ffmpegArgs(url, seconds, outPath, format));
      if (r.code !== 0) throw new Error(`ffmpeg failed (exit ${r.code})`);
      const probe = await exec('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        outPath,
      ]);
      const [w, h] = probe.stdout
        .trim()
        .split(',')
        .map((n) => Number.parseInt(n, 10));
      return { width: w || 0, height: h || 0 };
    },
  };
}
