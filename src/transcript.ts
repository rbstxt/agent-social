import type { TranscriptResult } from './types.ts';

/**
 * Keeps only transcript segments starting before `seconds` (a cheap opening
 * peek). Rebuilds text from kept segments, sets `truncated` when anything was
 * dropped. A null transcript passes through untouched.
 */
export function applyHead(result: TranscriptResult, seconds: number): TranscriptResult {
  if (!result.segments || result.transcript == null) return result;
  const cutoff = seconds * 1000;
  const kept = result.segments.filter((s) => s.startMs < cutoff);
  if (kept.length === result.segments.length) return result;
  return {
    ...result,
    transcript: kept.map((s) => s.text).join('\n'),
    segments: kept,
    truncated: true,
  };
}

/**
 * Caps the transcript to roughly `maxChars` characters, keeping whole segments
 * so text and segments stay consistent (slices the first segment when the
 * budget is smaller than it). Sets `truncated` when anything was dropped.
 */
export function applyMaxChars(result: TranscriptResult, maxChars: number): TranscriptResult {
  if (result.transcript == null) return result;

  if (!result.segments) {
    if (result.transcript.length <= maxChars) return result;
    return { ...result, transcript: result.transcript.slice(0, maxChars), truncated: true };
  }

  const kept: TranscriptResult['segments'] = [];
  let len = 0;
  for (const s of result.segments) {
    const add = (kept.length > 0 ? 1 : 0) + s.text.length;
    if (len + add > maxChars) break;
    kept.push(s);
    len += add;
  }
  if (kept.length === result.segments.length) return result;

  if (kept.length === 0) {
    const first = result.segments[0];
    const text = first ? first.text.slice(0, maxChars) : '';
    return {
      ...result,
      transcript: text,
      segments: first ? [{ ...first, text }] : [],
      truncated: true,
    };
  }

  return {
    ...result,
    transcript: kept.map((s) => s.text).join('\n'),
    segments: kept,
    truncated: true,
  };
}
