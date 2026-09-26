/**
 * Pure Redlib HTML → data normalizers. No network. Redlib renders server-side
 * templates (see redlib-org/redlib templates/utils.html, comment.html,
 * post.html, search.html, user.html), so these selectors are stable:
 *
 * - listing post: `div.post#<id>` → `.post_subreddit`, `.post_author`,
 *   `.created[title]`, `.post_title a:not(.post_flair)`, `.post_score[title]`,
 *   `.post_body`, `.post_footer .post_comments`
 * - thread post: `div.post.highlighted` (same inner classes)
 * - comment: `div.comment#<id>` → `.comment_author`, `.created[title]`,
 *   `.comment_score[title]`, `.comment_body`, nested `blockquote.replies >
 *   div.comment`, `a.deeper_replies` for truncated branches
 */
import { parse as parseHtml, HTMLElement } from 'node-html-parser';
import type { RedditComment, RedditPost } from './types.ts';

const text = (el: HTMLElement | null): string | null => {
  if (!el) return null;
  const t = el.text.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
};

const numTitle = (el: HTMLElement | null): number | null => {
  if (!el) return null;
  const raw = (el.getAttribute('title') ?? '').replace(/,/g, '');
  const m = raw.match(/-?\d+/);
  return m ? Number(m[0]) : null;
};

const stripPrefix = (s: string | null, prefix: string): string | null => {
  if (s == null) return null;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
};

export function parsePostDiv(el: HTMLElement): RedditPost {
  const id = el.getAttribute('id') ?? '';
  const titleLink = el.querySelector('.post_title a:not(.post_flair)') ?? el.querySelector('.post_title a');
  const title = text(titleLink) ?? text(el.querySelector('.post_title')) ?? '';
  // Listing cards link the title to the permalink; the single-post view
  // (utils::post macro) renders a plain <h1> + `ul#post_links` footer instead.
  const permalink =
    titleLink?.getAttribute('href') ??
    [...el.querySelectorAll('#post_links a')].find((a) => (a.text ?? '').toLowerCase().includes('permalink'))?.getAttribute('href') ??
    '';
  const mediaLink =
    el.querySelector('.post_media_image')?.getAttribute('href') ??
    el.querySelector('.post_media_video')?.getAttribute('src') ??
    el.querySelector('a.post_thumbnail')?.getAttribute('href') ??
    null;
  const scoreEl = el.querySelector('.post_score');
  const commentsEl = el.querySelector('.post_footer .post_comments');
  const commentsTitle = (commentsEl?.getAttribute('title') ?? '').replace(/,/g, '');
  const commentsMatch = commentsTitle.match(/\d+/);
  return {
    id,
    subreddit: stripPrefix(text(el.querySelector('.post_subreddit')), 'r/'),
    title,
    author: stripPrefix(text(el.querySelector('.post_author')), 'u/'),
    score: numTitle(scoreEl),
    scoreText: text(scoreEl),
    created: el.querySelector('.created')?.getAttribute('title') ?? null,
    relTime: text(el.querySelector('.created')),
    permalink,
    url: mediaLink && mediaLink !== permalink ? mediaLink : null,
    commentCount: commentsMatch ? Number(commentsMatch[0]) : null,
    body: text(el.querySelector('.post_body')),
    nsfw: el.querySelector('small.nsfw') !== null,
    spoiler: el.querySelector('small.spoiler') !== null,
    stickied: (el.getAttribute('class') ?? '').split(/\s+/).includes('stickied'),
  };
}

/** All `div.post` cards in a listing page (`#posts`, search results, user page). */
export function parsePostList(html: string): RedditPost[] {
  const root = parseHtml(html);
  return root.querySelectorAll('div.post').map(parsePostDiv);
}

/** The single highlighted post on a thread page, or the first post card. */
export function parseThreadPost(html: string): RedditPost | null {
  const root = parseHtml(html);
  const el =
    root.querySelector('div.post.highlighted') ??
    root.querySelector('#column_one > div.post') ??
    root.querySelector('div.post');
  if (!el) return null;
  const post = parsePostDiv(el);
  if (post.commentCount == null) {
    const m = (text(root.querySelector('#comment_count')) ?? '').replace(/,/g, '').match(/\d+/);
    if (m) post.commentCount = Number(m[0]);
  }
  return post;
}

function parseCommentDiv(el: HTMLElement, postLink: string | null): RedditComment {
  const authorLink = el.querySelector('a.comment_author');
  const id = el.getAttribute('id') ?? '';
  const body = text(el.querySelector('.comment_body')) ?? '';
  const repliesEl = el.querySelector('blockquote.replies');
  const replies = repliesEl
    ? repliesEl.childNodes
        .filter((n): n is HTMLElement => n instanceof HTMLElement)
        .filter((n) => n.tagName === 'DIV' && (n.getAttribute('class') ?? '').split(/\s+/).includes('comment'))
        .map((n) => parseCommentDiv(n, postLink))
    : [];
  const deeper = el.querySelector('a.deeper_replies');
  const moreMatch = deeper ? (deeper.text.match(/\d+/) ?? [])[0] : undefined;
  return {
    id,
    author: stripPrefix(text(authorLink), 'u/'),
    score: numTitle(el.querySelector('.comment_score')),
    scoreText: text(el.querySelector('.comment_score')),
    created: el.querySelector('.created')?.getAttribute('title') ?? null,
    relTime: text(el.querySelector('.created')),
    body,
    permalink: postLink && id ? `${postLink}${id}/` : null,
    replies,
    moreCount: moreMatch !== undefined ? Number(moreMatch) : null,
  };
}

/** Top-level comment threads on a thread page (`div.thread > div.comment`). */
export function parseThreadComments(html: string): RedditComment[] {
  const root = parseHtml(html);
  const postLink =
    root.querySelector('div.post.highlighted .post_footer .post_comments')?.getAttribute('href') ??
    root.querySelector('div.post .post_footer .post_comments')?.getAttribute('href') ??
    null;
  const out: RedditComment[] = [];
  for (const thread of root.querySelectorAll('div.thread')) {
    const direct = thread.childNodes
      .filter((n): n is HTMLElement => n instanceof HTMLElement)
      .filter((n) => n.tagName === 'DIV' && (n.getAttribute('class') ?? '').split(/\s+/).includes('comment'));
    for (const d of direct) out.push(parseCommentDiv(d, postLink));
  }
  // Fallback: some pages render comments without the .thread wrapper.
  if (out.length === 0) {
    for (const c of root.querySelectorAll('#column_one > div.comment')) {
      out.push(parseCommentDiv(c, postLink));
    }
  }
  return out;
}

/** Redlib footer `?after=`/`?before=` tokens for pagination. */
export function parsePageTokens(html: string): { after: string | null; before: string | null } {
  const root = parseHtml(html);
  const pick = (accesskey: string): string | null => {
    const a = root.querySelector(`footer a[accesskey="${accesskey}"]`);
    if (!a) return null;
    const href = a.getAttribute('href') ?? '';
    const m = href.match(/[?&](after|before)=([^&]*)/);
    return m?.[2] ? decodeURIComponent(m[2]) : null;
  };
  return { after: pick('N'), before: pick('P') };
}

/** Redlib search pages render posts as cards and comments as flat `.comment` divs. */
export function parseSearchPage(html: string): {
  posts: RedditPost[];
  comments: Array<RedditComment & { subreddit: null; linkTitle: null }>;
} {
  const root = parseHtml(html);
  const posts = root.querySelectorAll('div.post').map(parsePostDiv);
  const comments = root
    .querySelectorAll('div.comment')
    .filter((c) => !c.querySelector('blockquote.replies'))
    .map((c) => {
      const base = parseCommentDiv(c, null);
      const link = c.querySelector('a.comment_link')?.getAttribute('href') ?? null;
      return { ...base, permalink: link, subreddit: null as null, linkTitle: null as null };
    });
  return { posts, comments };
}

/** User page: profile panel + mixed post cards / `.user-comment` divs. */
export function parseUserPage(html: string): {
  profile: { title: string | null; name: string | null; description: string | null; karma: number | null; created: string | null };
  posts: RedditPost[];
  comments: Array<RedditComment & { subreddit: string | null; linkTitle: string | null }>;
} {
  const root = parseHtml(html);
  const name = stripPrefix(text(root.querySelector('#user_name')), 'u/');
  // #user_details holds all <label>s first, then all value <div>s in order:
  // Karma / Created / <n> / <date>.
  let karma: number | null = null;
  let created: string | null = null;
  const detailsEl = root.querySelector('#user_details');
  const labels = detailsEl?.querySelectorAll('label').map((l) => l.text.trim().toLowerCase()) ?? [];
  const values = detailsEl?.querySelectorAll(':scope > div').map((d) => d.text.trim()) ?? [];
  labels.forEach((label, i) => {
    const value = values[i] ?? '';
    if (label.includes('karma')) {
      const m = value.replace(/,/g, '').match(/-?\d+/);
      karma = m ? Number(m[0]) : null;
    } else if (label.includes('created')) {
      created = value || null;
    }
  });
  const profile = {
    title: text(root.querySelector('#user_title')),
    name,
    description: text(root.querySelector('#user_description')),
    karma,
    created,
  };
  const posts = root.querySelectorAll('div.post').map(parsePostDiv);
  const comments = root.querySelectorAll('div.comment.user-comment').map((c) => {
    const base = parseCommentDiv(c, null);
    const link = c.querySelector('a.comment_link');
    return {
      ...base,
      permalink: link?.getAttribute('href') ?? null,
      linkTitle: link?.getAttribute('title') ?? text(link),
      subreddit: stripPrefix(text(c.querySelector('.comment_subreddit')), 'r/'),
    };
  });
  return { profile, posts, comments };
}

/** Redlib renders errors as `#error` panel / `h1` on error.html. */
export function parsePageError(html: string): string | null {
  const root = parseHtml(html);
  const errPanel = root.querySelector('#error');
  if (errPanel) {
    const t = text(errPanel);
    if (t) return t;
  }
  const title = root.querySelector('title')?.text.trim() ?? '';
  if (/error|not found|banned|private|quarantined/i.test(title)) return title;
  return null;
}
