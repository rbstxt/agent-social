import { describe, expect, test } from 'bun:test';
import {
  ffmpegArgs,
  frameOutputName,
  parseTimeToSeconds,
  ytdlpFormat,
} from '../src/frame.ts';

describe('parseTimeToSeconds', () => {
  test('seconds + mm:ss + h:mm:ss + ms', () => {
    expect(parseTimeToSeconds('90')).toBe(90);
    expect(parseTimeToSeconds('7.5')).toBe(7.5);
    expect(parseTimeToSeconds('1:30')).toBe(90);
    expect(parseTimeToSeconds('1:02:03')).toBe(3723);
    expect(parseTimeToSeconds('90000ms')).toBe(90);
  });
  test('rejects junk', () => {
    expect(parseTimeToSeconds('')).toBeNull();
    expect(parseTimeToSeconds('abc')).toBeNull();
    expect(parseTimeToSeconds('-5')).toBeNull();
    expect(parseTimeToSeconds('1:xx')).toBeNull();
  });
});

describe('ytdlpFormat / ffmpegArgs / frameOutputName', () => {
  test('format strings cap height', () => {
    expect(ytdlpFormat(1080)).toContain('height<=1080');
    expect(ytdlpFormat('max')).toBe('bestvideo/best');
  });
  test('ffmpeg seeks before input, jpg gets quality flag', () => {
    const args = ffmpegArgs('http://x', 90, 'out.jpg', 'jpg');
    expect(args.indexOf('-ss') < args.indexOf('-i')).toBe(true);
    expect(args).toContain('-q:v');
    const png = ffmpegArgs('http://x', 90, 'out.png', 'png');
    expect(png).not.toContain('-q:v');
  });
  test('deterministic filenames', () => {
    expect(frameOutputName('abc', 90.4, 'jpg')).toBe('abc-90s.jpg');
  });
});

describe('cookieHeaderToNetscape / writeTempCookieFile', () => {
  test('header pairs become tab-separated netscape lines', async () => {
    const { cookieHeaderToNetscape } = await import('../src/frame.ts');
    const out = cookieHeaderToNetscape('SID=abc123; HSID=xy z; empty=; =junk; solo');
    expect(out.startsWith('# Netscape HTTP Cookie File\n')).toBe(true);
    expect(out).toContain('.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\tabc123');
    expect(out).toContain('\tHSID\txy z');
    expect(out).not.toContain('empty');
    expect(cookieHeaderToNetscape('')).toBe('');
    expect(cookieHeaderToNetscape('  ')).toBe('');
  });
  test('temp file round-trips and cleans up', async () => {
    const { writeTempCookieFile, removeTempCookieFile } = await import('../src/frame.ts');
    const { existsSync } = await import('node:fs');
    expect(writeTempCookieFile('')).toBeNull();
    const p = writeTempCookieFile('SID=abc;');
    expect(p).not.toBeNull();
    expect(existsSync(p as string)).toBe(true);
    removeTempCookieFile(p);
    expect(existsSync(p as string)).toBe(false);
    expect(existsSync((p as string).replace(/\/[^/]+$/, ''))).toBe(false);
  });
});
