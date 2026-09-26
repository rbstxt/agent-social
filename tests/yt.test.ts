import { describe, expect, test } from 'bun:test';
import type { FrameExtractor } from '../src/frame.ts';
import { run } from '../src/cli.ts';
import type { Engine } from '../src/youtube.ts';
import { parseYtArgs, runYt } from '../src/yt.ts';

const fakeEngine: Engine = {
  search: async (q) => [{ id: 'dQw4w9WgXcQ', title: q } as never],
  getInfo: async (id) => ({ kind: 'video', id }) as never,
  getChannelInfo: async (ref) => ({ kind: 'channel', id: 'x', ref }) as never,
  getTranscript: async (id) => ({ id, transcript: 'hi', segments: [] }) as never,
};

const fakeExtractor: FrameExtractor = {
  depsAvailable: async () => ({ ffmpeg: true, ytdlp: true }),
  resolveStreamUrl: async () => 'http://stream',
  grabFrame: async () => ({ width: 1920, height: 1080 }),
};

describe('parseYtArgs', () => {
  test('search joins positionals as query', () => {
    const p = parseYtArgs(['search', 'foo', 'bar', '--limit', '5']);
    expect(p).toMatchObject({ kind: 'command', command: 'search' });
    if (p.kind === 'command' && p.command === 'search') expect(p.opts.query).toBe('foo bar');
  });
  test('frames collects repeatable --at', () => {
    const p = parseYtArgs(['frames', 'dQw4w9WgXcQ', '--at', '1:30', '--at', '90']);
    if (p.kind === 'command' && p.command === 'frames') expect(p.opts.ats).toEqual(['1:30', '90']);
    else throw new Error('parse failed');
  });
  test('unknown yt command', () => {
    expect(parseYtArgs(['download'])).toMatchObject({ kind: 'unknown' });
  });
});

describe('runYt validation (no network)', () => {
  test('search rejects bad limit/sort/features', async () => {
    for (const args of [
      ['search', 'q', '--limit', '0'],
      ['search', 'q', '--sort', 'bogus'],
      ['search', 'q', '--features', 'bogus'],
    ]) {
      const r = await runYt(args, fakeEngine, '', fakeExtractor);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
    }
  });
  test('transcript rejects bad format', async () => {
    const r = await runYt(['transcript', 'dQw4w9WgXcQ', '--format', 'xml'], fakeEngine);
    expect(r.exitCode).toBe(1);
  });
  test('frames requires --at and valid res', async () => {
    const r1 = await runYt(['frames', 'dQw4w9WgXcQ'], fakeEngine, '', fakeExtractor);
    expect(r1.exitCode).toBe(1);
    const r2 = await runYt(
      ['frames', 'dQw4w9WgXcQ', '--at', '10', '--res', '999'],
      fakeEngine,
      '',
      fakeExtractor,
    );
    expect(r2.exitCode).toBe(1);
  });
  test('frames happy path uses extractor', async () => {
    const r = await runYt(
      ['frames', 'dQw4w9WgXcQ', '--at', '1:30', '--at', '90', '--out', '/tmp/x'],
      fakeEngine,
      '',
      fakeExtractor,
    );
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.frames.length).toBe(2);
    expect(env.data.frames[0].at).toBe(90);
  });
  test('info batch returns array; stdin - expands', async () => {
    const r = await runYt(['info', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ'], fakeEngine);
    expect(Array.isArray(JSON.parse(r.stdout))).toBe(true);
    const r2 = await runYt(['info', '-'], fakeEngine, 'dQw4w9WgXcQ dQw4w9WgXcQ');
    expect(Array.isArray(JSON.parse(r2.stdout))).toBe(true);
  });
  test('frames MISSING_DEPENDENCY when binaries absent', async () => {
    const noDeps: FrameExtractor = {
      ...fakeExtractor,
      depsAvailable: async () => ({ ffmpeg: false, ytdlp: true }),
    };
    const r = await runYt(['frames', 'dQw4w9WgXcQ', '--at', '5'], fakeEngine, '', noDeps);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('MISSING_DEPENDENCY');
  });
  test('FETCH_FAILED hint tells agent to update deps', async () => {
    const failing: Engine = {
      ...fakeEngine,
      search: async () => {
        throw new Error('blocked');
      },
    };
    const r = await runYt(['search', 'q'], failing);
    const env = JSON.parse(r.stdout);
    expect(env.error.code).toBe('FETCH_FAILED');
    expect(env.error.hint).toContain('youtubei.js@latest');
    expect(env.error.hint).toContain('yt-dlp');
  });
});

describe('top-level routing', () => {
  test('x routes to the X module (no network on bad input)', async () => {
    const r = await run(['x', 'search', 'q', '--limit', '0']);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
  });
  test('r routes to the reddit module (no network on bad input)', async () => {
    const r = await run(['r', 'posts', 'x', '--sort', 'bogus']);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('INVALID_INPUT');
  });
  test('unknown module exit 2', async () => {
    const r = await run(['zzz']);
    expect(r.exitCode).toBe(2);
  });
  test('help + version', async () => {
    expect((await run([])).exitCode).toBe(0);
    expect((await run(['-v'])).stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
