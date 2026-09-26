export type VideoSummary = {
  id: string;
  title: string;
  channel: string | null;
  duration: string | null;
  url: string;
  embedUrl: string;
  viewCount: number | null;
  viewCountText: string | null;
  published: string | null;
  verified: boolean;
  descriptionSnippet: string | null;
  badges: string[];
};

export type Chapter = {
  title: string;
  start: string;
  startMs: number;
};

export type VideoInfo = {
  kind: 'video';
  id: string;
  title: string;
  description: string;
  channel: string | null;
  duration: string | null;
  url: string;
  embedUrl: string;
  viewCount: number | null;
  published: string | null;
  verified: boolean;
  hasCaptions: boolean;
  captionLanguages: string[];
  chapters: Chapter[];
};

export type ChannelInfo = {
  kind: 'channel';
  id: string;
  url: string;
  title: string | null;
  handle: string | null;
  subscriberCount: number | null;
  subscriberText: string | null;
  description: string | null;
  verified: boolean;
};

export type TranscriptSegment = {
  text: string;
  startMs: number;
  durationMs: number;
};

export type TranscriptResult = {
  id: string;
  lang: string | null;
  source: 'innertube' | null;
  transcript: string | null;
  segments?: TranscriptSegment[];
  reason?: string;
  truncated?: boolean;
};

export type Frame = { at: number; path: string; width: number; height: number };
export type FrameError = { at: number; error: string };
export type FrameResult = { id: string; frames: Array<Frame | FrameError> };

export type Ok<T> = { ok: true; command: string; data: T };
export type Err = {
  ok: false;
  command: string;
  error: { code: string; message: string; hint?: string };
};
export type Envelope<T> = Ok<T> | Err;
