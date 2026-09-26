import { extractChannelRef, extractVideoId } from '../ids.ts';
import { err, ok } from '../output.ts';
import type { ChannelInfo, Envelope, VideoInfo } from '../types.ts';
import type { Engine } from '../youtube.ts';
import { FETCH_FAILED_HINT, errorMessage } from './_shared.ts';

export async function runInfo(
  engine: Engine,
  opts: { target: string },
): Promise<Envelope<VideoInfo | ChannelInfo>> {
  const videoId = extractVideoId(opts.target);
  if (videoId) {
    try {
      return ok('info', await engine.getInfo(videoId));
    } catch (e) {
      return err('info', 'FETCH_FAILED', errorMessage(e), FETCH_FAILED_HINT);
    }
  }

  const ref = extractChannelRef(opts.target);
  if (ref) {
    try {
      return ok('info', await engine.getChannelInfo(ref));
    } catch (e) {
      return err('info', 'FETCH_FAILED', errorMessage(e), FETCH_FAILED_HINT);
    }
  }

  return err(
    'info',
    'INVALID_INPUT',
    `could not extract a video id or channel ref from: ${opts.target}`,
  );
}
