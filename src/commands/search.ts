import { err, ok } from '../output.ts';
import type { Envelope, VideoSummary } from '../types.ts';
import type { Engine, SearchOpts } from '../youtube.ts';
import { FETCH_FAILED_HINT, errorMessage } from './_shared.ts';

export async function runSearch(
  engine: Engine,
  opts: { query: string } & SearchOpts,
): Promise<Envelope<VideoSummary[]>> {
  const query = opts.query.trim();
  if (!query) return err('search', 'INVALID_INPUT', 'query is required');

  try {
    const { query: _q, ...filters } = opts;
    const results = await engine.search(query, filters);
    return ok('search', results);
  } catch (e) {
    return err('search', 'FETCH_FAILED', errorMessage(e), FETCH_FAILED_HINT);
  }
}
