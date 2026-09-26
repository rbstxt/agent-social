export const FETCH_FAILED_HINT =
  'YouTube request failed — YouTube may have changed its InnerTube API or blocked this IP: ' +
  'update youtubei.js (npm i youtubei.js@latest) and yt-dlp (brew upgrade yt-dlp) then retry. ' +
  'Datacenter/cloud IPs are often blocked — prefer a residential network.';

export const DEPS_HINT =
  'frames needs ffmpeg + yt-dlp on PATH — install e.g. `brew install ffmpeg yt-dlp`.';

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
