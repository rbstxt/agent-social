/**
 * Pure twscrape JSON → envelope normalizers. No network, no credentials.
 * twscrape prints one JSON object per line (snscrape-model shape); these
 * mappers shrink each object to the agent-useful subset and tag
 * `source: "x-cookie"` so provenance is visible downstream.
 */
import type { XAuthor, XQuotedTweet, XTweet, XUser } from './types.ts';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const mentionedList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const u of v) {
    if (typeof u === 'string') out.push(u);
    else if (u && typeof u === 'object') {
      const name = str((u as any).username);
      if (name) out.push(name);
    }
  }
  return out;
};

export function normalizeAuthor(raw: any): XAuthor | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = idStr(raw.id_str ?? raw.id);
  const username = str(raw.username);
  if (!id || !username) return null;
  return {
    id,
    username,
    displayname: str(raw.displayname),
    verified: raw.verified === true,
    protected: raw.protected === true,
    followersCount: num(raw.followersCount),
    profileImageUrl: str(raw.profileImageUrl),
  };
}

function normalizeQuoted(raw: any): XQuotedTweet | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = idStr(raw.id_str ?? raw.id);
  if (!id) return null;
  return {
    id,
    url: str(raw.url) ?? `https://x.com/i/status/${id}`,
    username: str(raw.user?.username) ?? null,
    text: str(raw.rawContent) ?? '',
  };
}

export function normalizeTweet(raw: any): XTweet | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = idStr(raw.id_str ?? raw.id);
  if (!id) return null;
  const media = raw.media && typeof raw.media === 'object' ? raw.media : {};
  const photos = Array.isArray(media.photos) ? media.photos : [];
  const videos = Array.isArray(media.videos) ? media.videos : [];
  return {
    source: 'x-cookie',
    id,
    url: str(raw.url) ?? `https://x.com/i/status/${id}`,
    date: str(raw.date),
    text: str(raw.rawContent) ?? '',
    lang: str(raw.lang),
    author: normalizeAuthor(raw.user),
    replyCount: num(raw.replyCount),
    retweetCount: num(raw.retweetCount),
    likeCount: num(raw.likeCount),
    quoteCount: num(raw.quoteCount),
    viewCount: num(raw.viewCount),
    conversationId: idStr(raw.conversationIdStr ?? raw.conversationId),
    inReplyToTweetId: idStr(raw.inReplyToTweetIdStr ?? raw.inReplyToTweetId),
    hashtags: strList(raw.hashtags),
    mentionedUsers: mentionedList(raw.mentionedUsers),
    links: Array.isArray(raw.links)
      ? raw.links
          .map((l: any) => (typeof l === 'string' ? l : str(l?.url)))
          .filter((x: string | null): x is string => x !== null)
      : [],
    photoCount: photos.length,
    videoCount: videos.length,
    quotedTweet: normalizeQuoted(raw.quotedTweet),
  };
}

export function normalizeUser(raw: any): XUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = idStr(raw.id_str ?? raw.id);
  const username = str(raw.username);
  if (!id || !username) return null;
  return {
    source: 'x-cookie',
    id,
    url: str(raw.url) ?? `https://x.com/${username}`,
    username,
    displayname: str(raw.displayname),
    description: str(raw.rawDescription),
    created: str(raw.created),
    followersCount: num(raw.followersCount),
    friendsCount: num(raw.friendsCount),
    statusesCount: num(raw.statusesCount),
    location: str(raw.location),
    profileImageUrl: str(raw.profileImageUrl),
    protected: raw.protected === true,
    verified: raw.verified === true,
  };
}

/** Accepts a bare numeric id or any x.com/twitter.com status URL. */
export function parseTweetId(ref: string): string | null {
  const s = ref.trim();
  if (/^\d{5,}$/.test(s)) return s;
  const m = s.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/i);
  return m?.[1] ?? null;
}

/** Accepts `@handle`, bare handle, or an x.com profile URL. */
export function parseHandle(ref: string): string | null {
  const s = ref.trim().replace(/^@/, '');
  if (/^[A-Za-z0-9_]{1,15}$/.test(s)) return s;
  const m = s.match(/(?:x\.com|twitter\.com)\/@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  return m?.[1] ?? null;
}
