/**
 * youtubei.js (InnerTube) engine wrapper.
 *
 * The ONLY module allowed to import youtubei.js. All shape-translation goes
 * through the exported pure normalizer functions; the network methods are
 * intentionally thin and delegate to those normalizers.
 */
import { Innertube } from 'youtubei.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractChannelRef,
  extractVideoId,
  toChannelUrl,
  toEmbedUrl,
  toWatchUrl,
  type ChannelRef,
} from './ids.ts';
import { parseChapters, parseViewCount } from './parse.ts';
import type {
  ChannelInfo,
  TranscriptResult,
  TranscriptSegment,
  VideoInfo,
  VideoSummary,
} from './types.ts';

export type SearchOpts = {
  limit?: number;
  sort?: 'relevance' | 'date' | 'views' | 'rating';
  uploadDate?: 'all' | 'hour' | 'today' | 'week' | 'month' | 'year';
  duration?: 'any' | 'short' | 'medium' | 'long';
  /** 'cc' (default) restricts to captioned videos; 'all' widens. */
  features?: 'cc' | 'all';
};

export interface Engine {
  search(query: string, opts?: SearchOpts): Promise<VideoSummary[]>;
  getInfo(id: string): Promise<VideoInfo>;
  getChannelInfo(ref: ChannelRef): Promise<ChannelInfo>;
  getTranscript(id: string, lang?: string): Promise<TranscriptResult>;
}

/**
 * Parses a Netscape cookies.txt body into a raw `Cookie` header string
 * (`a=1; b=2`). Skips comments/blank lines and the bare `#HttpOnly` prefix
 * some exporters emit. Returns '' when nothing usable is found.
 */
export function netscapeToHeader(body: string): string {
  const pairs: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 7) continue;
    const name = (fields[5] ?? '').trim();
    const value = (fields[6] ?? '').trim();
    if (!name || !value) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

function dotEnvCandidates(): string[] {
  const candidates = [join(process.cwd(), '.env')];
  // package root: walk up from this module to package.json (works for src/ and dist/)
  try {
    const here = new URL('.', import.meta.url);
    let dir = here.pathname;
    for (let i = 0; i < 4; i++) {
      dir = join(dir, '..');
      if (existsSync(join(dir, 'package.json'))) {
        candidates.push(join(dir, '.env'));
        break;
      }
    }
  } catch {
    // ignore
  }
  return candidates;
}

function dotEnvLookup(key: string): string {
  for (const p of dotEnvCandidates()) {
    try {
      const body = readFileSync(p, 'utf-8');
      for (const line of body.split('\n')) {
        const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`));
        if (!m) continue;
        const val = (m[1] ?? '').replace(/^["']|["']$/g, '');
        if (val) return val;
      }
    } catch {
      // no .env here — try next
    }
  }
  return '';
}

/**
 * Resolves the YouTube login cookie as a raw `Cookie` header string.
 * Sources (first hit wins): `YT_COOKIE` env, `YT_COOKIE` in `.env`
 * (cwd, then installed package root), `YT_COOKIES_FILE` env or `.env`
 * (Netscape file path, converted). Optional: enables logged-in access
 * (age-restricted videos, higher rate budget). Returns '' when unset.
 */
export function resolveYtCookie(
  env: NodeJS.ProcessEnv = process.env,
  opts: { readDotEnv?: boolean } = {},
): string {
  const direct = (env['YT_COOKIE'] ?? '').trim();
  if (direct) return direct;
  if (opts.readDotEnv === false) return '';
  const fromDotEnv = dotEnvLookup('YT_COOKIE');
  if (fromDotEnv) return fromDotEnv;
  const file =
    (env['YT_COOKIES_FILE'] ?? '').trim() || dotEnvLookup('YT_COOKIES_FILE');
  if (!file) return '';
  try {
    return netscapeToHeader(readFileSync(file, 'utf-8'));
  } catch {
    return '';
  }
}

/**
 * Resolves a Netscape cookie FILE path for yt-dlp `--cookies`, or null.
 * Prefers an explicit `YT_COOKIES_FILE` (env/`.env`); otherwise null
 * (callers fall back to a temp file converted from the header string).
 */
export function resolveYtCookieFile(
  env: NodeJS.ProcessEnv = process.env,
  opts: { readDotEnv?: boolean } = {},
): string | null {
  const direct = (env['YT_COOKIES_FILE'] ?? '').trim();
  if (direct) return direct;
  if (opts.readDotEnv === false) return null;
  const fromDotEnv = dotEnvLookup('YT_COOKIES_FILE');
  return fromDotEnv || null;
}

export async function createEngine(opts: { cookie?: string } = {}): Promise<Engine> {
  // `generate_session_locally` is REQUIRED for transcripts: it makes the player
  // response return a fully-signed `timedtext` caption URL. Without it the
  // caption URL is unsigned and returns HTTP 200 with an empty body.
  // `cookie` is optional (logged-in session: age-restricted/private access).
  const yt = await Innertube.create({
    generate_session_locally: true,
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
  });

  return {
    async search(query, opts) {
      const limit = opts?.limit ?? 10;
      // biome-ignore lint/suspicious/noExplicitAny: youtubei.js filter typing is loose
      let page: any = await yt.search(query, buildSearchFilters(opts) as any);
      const nodes: unknown[] = [...(page.results ?? [])];
      let guard = 0;
      while (countVideoNodes(nodes) < limit && guard < 6) {
        try {
          page = await page.getContinuation();
        } catch {
          break;
        }
        if (!page?.results?.length) break;
        nodes.push(...page.results);
        guard++;
      }
      return normalizeSearchResults(nodes, limit);
    },

    async getInfo(input) {
      const id = resolveVideoId(input);
      // Full getInfo (NOT getBasicInfo) so captions + chapters are available.
      // biome-ignore lint/suspicious/noExplicitAny: youtubei.js info typing is loose
      const info: any = await yt.getInfo(id);
      const bi = info.basic_info ?? {};
      const description: string =
        info.secondary_info?.description?.toString?.() ?? bi.short_description ?? '';
      const captionLanguages: string[] = (info.captions?.caption_tracks ?? [])
        .map((t: { language_code?: string }) => t.language_code)
        .filter((c: unknown): c is string => typeof c === 'string');
      return normalizeInfo(id, {
        title: bi.title,
        description,
        channel: bi.channel?.name ?? bi.author ?? null,
        durationSeconds: typeof bi.duration === 'number' ? bi.duration : null,
        viewCount: typeof bi.view_count === 'number' ? bi.view_count : null,
        published: info.primary_info?.published?.toString?.() ?? null,
        verified: info.secondary_info?.owner?.author?.is_verified ?? false,
        captionLanguages,
      });
    },

    async getChannelInfo(ref) {
      // Handle refs (@name, /c/, /user/) can't go straight to getChannel —
      // resolve them to a channel ID via a channel-type search first (this
      // also yields a verified signal the PageHeader lacks).
      let id = ref.type === 'id' ? ref.id : null;
      let verified = false;
      if (!id) {
        const resolved = await resolveChannelHandle(
          yt,
          ref.type === 'handle' ? ref.handle : '',
        );
        id = resolved.id;
        verified = resolved.verified;
      }
      // biome-ignore lint/suspicious/noExplicitAny: youtubei.js channel typing is loose
      const channel: any = await yt.getChannel(id);
      const header = channel?.header;
      const metadata = channel?.metadata ?? {};
      // youtubei.js 18 returns a PageHeader/PageHeaderView here (not the
      // C4TabbedHeader of older versions): handle + subs live in
      // content.metadata.metadata_rows. C4TabbedHeader fields are read first
      // so both shapes work.
      const rows = parseHeaderRows(header);
      const title: string | null =
        header?.author?.name ?? metadata.title ?? header?.page_title ?? rows.title ?? null;
      return normalizeChannelInfo(ref, {
        title,
        handle: rows.handle,
        subscriberText: rows.subscriberText,
        description: metadata.description ?? null,
        verified: header?.author?.is_verified ?? verified,
      });
    },

    async getTranscript(input, lang) {
      const id = resolveVideoId(input);
      // Deliberately AVOID `info.getTranscript()` — its `get_transcript`
      // InnerTube endpoint is gated by YouTube and returns HTTP 400. Instead
      // read the signed caption-track URL from the player response and fetch
      // the `json3` timedtext directly.
      const info = await yt.getInfo(id);
      const tracks = (info.captions?.caption_tracks ?? []) as unknown as RawCaptionTrack[];
      const track = pickCaptionTrack(tracks, lang);
      if (!track) return noCaptionsResult(id);

      const url = `${track.base_url}${track.base_url.includes('?') ? '&' : '?'}fmt=json3`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Caption request failed with status ${res.status}`);
      }
      const body = await res.text();
      if (!body) return noCaptionsResult(id);

      return parseJson3Transcript(id, JSON.parse(body), track.language_code ?? lang ?? null);
    },
  };
}

function resolveVideoId(input: string): string {
  const id = extractVideoId(input);
  if (!id) throw new Error(`Cannot resolve a YouTube video ID from: ${JSON.stringify(input)}`);
  return id;
}

/**
 * Resolves a @handle to a channel ID via a channel-type search. Prefers a
 * node whose @handle (or @name) matches exactly, else the first Channel node.
 */
// biome-ignore lint/suspicious/noExplicitAny: youtubei.js search typing is loose
async function resolveChannelHandle(yt: any, handle: string): Promise<{ id: string; verified: boolean }> {
  // biome-ignore lint/suspicious/noExplicitAny: youtubei.js filter typing is loose
  const res: any = await yt.search(handle, { type: 'channel' } as any);
  const nodes: any[] = ((res.results ?? []) as any[]).filter((n) => n?.type === 'Channel');
  const want = handle.toLowerCase();
  const match =
    nodes.find((n) => {
      const h = (n.subscriber_count?.toString?.() ?? '').toLowerCase();
      const name = `@${(n.short_byline?.toString?.().trim() ?? '').toLowerCase()}`;
      return h === want || name === want;
    }) ?? nodes[0];
  if (!match?.id) throw new Error(`no channel found for ${handle}`);
  return { id: match.id as string, verified: match.author?.is_verified ?? false };
}

export function resolveTargetKind(input: string): 'video' | 'channel' | null {
  if (extractVideoId(input)) return 'video';
  if (extractChannelRef(input)) return 'channel';
  return null;
}

// ---------------------------------------------------------------------------
// Pure normalizers (exported for testing)
// ---------------------------------------------------------------------------

type RawVideoNode = {
  type: string;
  video_id: string;
  title: { toString(): string };
  author?: { name?: string; is_verified?: boolean } | null;
  duration?: { text?: string } | null;
  view_count?: unknown;
  short_view_count?: unknown;
  published?: unknown;
  snippets?: Array<{ text?: unknown }> | null;
  badges?: Array<{ label?: string }> | null;
};

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  const s = (v as { toString?: () => string }).toString?.();
  return s && s !== '[object Object]' ? s.trim() || null : null;
}

/** Maps search result nodes to VideoSummary[], skipping non-Video nodes. */
export function normalizeSearchResults(raw: unknown[], limit: number): VideoSummary[] {
  const out: VideoSummary[] = [];
  for (const node of raw) {
    if (out.length >= limit) break;
    if (!isVideoNode(node)) continue;
    const fullViews = asText(node.view_count);
    const shortViews = asText(node.short_view_count);
    out.push({
      id: node.video_id,
      title: node.title.toString(),
      channel: node.author?.name ?? null,
      duration: node.duration?.text ?? null,
      url: toWatchUrl(node.video_id),
      embedUrl: toEmbedUrl(node.video_id),
      viewCount: parseViewCount(fullViews ?? shortViews),
      viewCountText: shortViews ?? fullViews,
      published: asText(node.published),
      verified: node.author?.is_verified ?? false,
      descriptionSnippet: asText(node.snippets?.[0]?.text),
      badges: (node.badges ?? [])
        .map((b) => b.label)
        .filter((l): l is string => typeof l === 'string'),
    });
  }
  return out;
}

function isVideoNode(node: unknown): node is RawVideoNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as Record<string, unknown>).type === 'Video' &&
    typeof (node as Record<string, unknown>).video_id === 'string'
  );
}

function countVideoNodes(nodes: unknown[]): number {
  return nodes.filter(isVideoNode).length;
}

/**
 * Maps SearchOpts to a youtubei.js search-filters object. Captioned-only
 * (`features: ['subtitles']`) unless `features: 'all'`.
 */
export function buildSearchFilters(opts?: SearchOpts): {
  sort_by?: string;
  upload_date?: string;
  duration?: string;
  features?: string[];
} {
  const sortMap = {
    relevance: 'relevance',
    date: 'upload_date',
    views: 'view_count',
    rating: 'rating',
  } as const;
  const filters: {
    sort_by?: string;
    upload_date?: string;
    duration?: string;
    features?: string[];
  } = {};
  if (opts?.sort) filters.sort_by = sortMap[opts.sort];
  if (opts?.uploadDate && opts.uploadDate !== 'all') filters.upload_date = opts.uploadDate;
  if (opts?.duration && opts.duration !== 'any') filters.duration = opts.duration;
  if (opts?.features !== 'all') filters.features = ['subtitles'];
  return filters;
}

type RawInfo = {
  title?: string;
  description?: string;
  channel?: string | null;
  durationSeconds?: number | null;
  viewCount?: number | null;
  published?: string | null;
  verified?: boolean;
  captionLanguages?: string[];
};

/** Maps extracted info fields to VideoInfo, parsing chapters + captions. */
export function normalizeInfo(id: string, raw: RawInfo): VideoInfo {
  const captionLanguages = raw.captionLanguages ?? [];
  const description = raw.description ?? '';
  return {
    kind: 'video',
    id,
    title: raw.title ?? '',
    description,
    channel: raw.channel ?? null,
    duration: raw.durationSeconds != null ? formatDuration(raw.durationSeconds) : null,
    url: toWatchUrl(id),
    embedUrl: toEmbedUrl(id),
    viewCount: raw.viewCount ?? null,
    published: raw.published ?? null,
    verified: raw.verified ?? false,
    hasCaptions: captionLanguages.length > 0,
    captionLanguages,
    chapters: parseChapters(description),
  };
}

type RawChannel = {
  title?: string | null;
  handle?: string | null;
  subscriberText?: string | null;
  description?: string | null;
  verified?: boolean;
};

/**
 * Extracts handle / subscriber text / title from a channel header node.
 * Handles both the legacy C4TabbedHeader shape (author, subscribers,
 * channel_handle) and the PageHeader/PageHeaderView shape of newer
 * youtubei.js (handle + "N subscribers" rows under
 * content.metadata.metadata_rows).
 */
export function parseHeaderRows(header: unknown): {
  title: string | null;
  handle: string | null;
  subscriberText: string | null;
} {
  const h = (header ?? {}) as Record<string, unknown>;
  const content = (h.content ?? {}) as Record<string, unknown>;
  const rows = (content.metadata as Record<string, unknown> | undefined)?.metadata_rows;
  let handle = asText(h.channel_handle);
  let subscriberText = asText(h.subscribers);
  if (Array.isArray(rows)) {
    for (const row of rows as Array<Record<string, unknown>>) {
      const parts = row.metadata_parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts as Array<Record<string, unknown>>) {
        const text = asText(part.text);
        if (!text) continue;
        if (!handle && text.startsWith('@')) handle = text.split(/\s/)[0] ?? null;
        if (!subscriberText && /subscriber/i.test(text)) subscriberText = text;
      }
    }
  }
  return {
    title: asText((h.author as Record<string, unknown> | undefined)?.name) ?? asText(h.page_title),
    handle,
    subscriberText,
  };
}

/** Maps extracted channel fields to ChannelInfo. */
export function normalizeChannelInfo(ref: ChannelRef, raw: RawChannel): ChannelInfo {
  return {
    kind: 'channel',
    id: ref.type === 'id' ? ref.id : ref.handle,
    url: toChannelUrl(ref),
    title: raw.title ?? null,
    handle: ref.type === 'handle' ? ref.handle : (raw.handle ?? null),
    subscriberCount: parseViewCount(raw.subscriberText),
    subscriberText: raw.subscriberText ?? null,
    description: raw.description ?? null,
    verified: raw.verified ?? false,
  };
}

export type RawCaptionTrack = {
  base_url: string;
  language_code?: string;
  kind?: string;
};

/**
 * Picks the best caption track: exact lang match, else base-language match
 * (e.g. 'en' matches 'en-US'); otherwise prefer manually authored over
 * auto-generated ('asr'), else the first track. Undefined when no tracks.
 */
export function pickCaptionTrack(
  tracks: RawCaptionTrack[],
  lang?: string,
): RawCaptionTrack | undefined {
  if (tracks.length === 0) return undefined;
  if (lang) {
    const want = lang.toLowerCase();
    const base = want.split('-')[0] ?? want;
    const match = tracks.find((t) => {
      const code = (t.language_code ?? '').toLowerCase();
      return code === want || (code.split('-')[0] ?? code) === base;
    });
    if (match) return match;
  }
  return tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
}

type Json3 = {
  events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
};

/** Parses a json3 timedtext payload, skipping segment-less/blank events. */
export function parseJson3Transcript(
  id: string,
  json3: Json3,
  lang: string | null,
): TranscriptResult {
  const segments: TranscriptSegment[] = [];
  for (const ev of json3.events ?? []) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .trim();
    if (!text) continue;
    segments.push({ text, startMs: ev.tStartMs ?? 0, durationMs: ev.dDurationMs ?? 0 });
  }
  return {
    id,
    lang,
    source: 'innertube',
    transcript: segments.map((s) => s.text).join('\n'),
    segments,
  };
}

/** Formats totalSeconds as h:mm:ss (when >= 3600) or m:ss. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const secs = s % 60;
  const mins = Math.floor(s / 60) % 60;
  const hours = Math.floor(s / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
  return `${mins}:${pad(secs)}`;
}

/** Null+reason shape for a video that genuinely has no captions. */
export function noCaptionsResult(id: string): TranscriptResult {
  return { id, lang: null, source: null, transcript: null, reason: 'no captions' };
}
