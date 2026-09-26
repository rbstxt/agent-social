import type { Chapter } from './types.ts';

/**
 * Parses a YouTube view/subscriber-count string into a number.
 * Handles comma-grouped counts ("1,819,130 views") and compact K/M/B forms
 * ("1.8M views", "2.3K subscribers"). Null when no number is present.
 */
export function parseViewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase()] ?? 1;
  return Math.round(n * mult);
}

/** Converts a "h:mm:ss" / "m:ss" timestamp into milliseconds. */
function timestampToMs(ts: string): number {
  const parts = ts.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000;
}

const CHAPTER_LINE = /^\s*((?:\d{1,2}:)?\d{1,3}:\d{2})\s+(\S.*)$/;

/**
 * Parses chapters from a video description: lines that begin with a timestamp
 * (e.g. "0:00 Intro", "12:42 Deep dive"). Returns [] when there are none.
 */
export function parseChapters(description: string | null | undefined): Chapter[] {
  if (!description) return [];
  const out: Chapter[] = [];
  for (const line of description.split('\n')) {
    const m = line.match(CHAPTER_LINE);
    if (!m?.[1] || !m[2]) continue;
    out.push({ title: m[2].trim(), start: m[1], startMs: timestampToMs(m[1]) });
  }
  return out;
}
