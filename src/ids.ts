const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Extract the canonical 11-char YouTube video ID from a bare ID or any common
 * URL form (watch, youtu.be, embed, shorts). Null when not recognisable.
 */
export function extractVideoId(input: string): string | null {
  if (!input) return null;
  if (VIDEO_ID_RE.test(input)) return input;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const { hostname, pathname, searchParams } = url;
  const isYouTube =
    hostname === 'www.youtube.com' ||
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com';
  const isShortLink = hostname === 'youtu.be';

  if (isShortLink) {
    const id = pathname.slice(1).split('/')[0] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  if (isYouTube) {
    if (pathname === '/watch') {
      const v = searchParams.get('v');
      return v && VIDEO_ID_RE.test(v) ? v : null;
    }
    if (pathname.startsWith('/embed/')) {
      const id = pathname.slice('/embed/'.length).split('/')[0] ?? '';
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (pathname.startsWith('/shorts/')) {
      const id = pathname.slice('/shorts/'.length).split('/')[0] ?? '';
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (pathname.startsWith('/live/')) {
      const id = pathname.slice('/live/'.length).split('/')[0] ?? '';
      return VIDEO_ID_RE.test(id) ? id : null;
    }
  }

  return null;
}

export type ChannelRef =
  | { type: 'id'; id: string }
  | { type: 'handle'; handle: string };

/**
 * Extract a channel reference from a bare channel ID (UC…), a bare @handle,
 * or a channel URL (/channel/<id>, /@<handle>, /c/<name>, /user/<name>).
 * Null when the input is not recognisably a channel reference.
 */
export function extractChannelRef(input: string): ChannelRef | null {
  if (!input) return null;
  const trimmed = input.trim();

  if (CHANNEL_ID_RE.test(trimmed)) return { type: 'id', id: trimmed };
  if (/^@[A-Za-z0-9._-]{1,30}$/.test(trimmed)) return { type: 'handle', handle: trimmed };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const { hostname, pathname } = url;
  const isYouTube =
    hostname === 'www.youtube.com' ||
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com';
  if (!isYouTube) return null;

  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'channel' && parts[1] && CHANNEL_ID_RE.test(parts[1])) {
    return { type: 'id', id: parts[1] };
  }
  if (parts[0]?.startsWith('@')) return { type: 'handle', handle: parts[0] as string };
  if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) {
    return { type: 'handle', handle: `@${parts[1]}` };
  }
  return null;
}

export function toWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function toEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

export function toChannelUrl(ref: ChannelRef): string {
  return ref.type === 'id'
    ? `https://www.youtube.com/channel/${ref.id}`
    : `https://www.youtube.com/${ref.handle}`;
}
