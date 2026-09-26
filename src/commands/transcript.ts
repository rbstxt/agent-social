import { extractVideoId } from '../ids.ts';
import { err, ok } from '../output.ts';
import { applyHead, applyMaxChars } from '../transcript.ts';
import type { Envelope, TranscriptResult } from '../types.ts';
import type { Engine } from '../youtube.ts';
import { FETCH_FAILED_HINT, errorMessage } from './_shared.ts';

export async function runTranscript(
  engine: Engine,
  opts: {
    target: string;
    lang?: string;
    format?: 'text' | 'json';
    head?: number;
    maxChars?: number;
  },
): Promise<Envelope<TranscriptResult>> {
  const id = extractVideoId(opts.target);
  if (!id) {
    return err('transcript', 'INVALID_INPUT', `could not extract a video id from: ${opts.target}`);
  }

  try {
    let t = await engine.getTranscript(id, opts.lang);

    // Peek tier: window to the opening, then cap length.
    if (opts.head != null) t = applyHead(t, opts.head);
    if (opts.maxChars != null) t = applyMaxChars(t, opts.maxChars);

    if (opts.format === 'text') {
      const { segments: _segments, ...rest } = t;
      return ok('transcript', rest);
    }
    return ok('transcript', t);
  } catch (e) {
    return err('transcript', 'FETCH_FAILED', errorMessage(e), FETCH_FAILED_HINT);
  }
}
